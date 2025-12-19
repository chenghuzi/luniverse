# Agent Notes (luniverse)

本文档用于记录在本仓库内做过的关键交互/实现约定，方便后续开发与接入真实能力（例如实时 ASR）。  
注意：代码、注释、UI 文案保持 **English-only**；这里作为补充说明使用中文。

## Voice Chat Overlay (Hold-to-talk)

### 目标

- 用户在详情页打开 Chat Overlay 后，可以按住 `Hold to talk` 开始录音，松开结束。
- 录音中显示实时波形（幅度经过归一化/增益处理，保证“看起来有变化”）。
- 松开后，如果录音时长达到阈值，会自动发送一条 message bubble（未来接入 ASR 后改为转录完成再发送）。

### 关键实现位置

- `src/features/chat/components/VoiceChatOverlay.tsx`
  - `startHoldToTalk(...)`：在用户手势触发的 `pointerdown` 内请求麦克风并开始 session。
  - `stopHoldToTalk(...)`：在 `pointerup`/`pointercancel` 停止 session，并按时长阈值自动发送一条消息。
- `src/features/chat/hooks/useMicrophoneSession.ts`
  - 管理 `getUserMedia`、WebAudio graph、波形采样与状态机。
  - 预留 `onPcmChunk` 回调用于未来实时 ASR（PCM 流式上送）。
- `src/features/chat/components/VoiceWaveform.tsx`
  - 将 bars 映射为 UI bar 的 `scaleY(...)`。

### 波形“幅度过小”的处理策略

在 `useMicrophoneSession` 内对 raw amplitude 做了自适应归一化与轻量 AGC：

- `noiseFloor`：噪声底线，低于此幅度会被压掉，避免环境噪声一直抖动。
- `peakDecay`：rolling peak 衰减系数，使得“最近的最大音量”作为动态标尺。
- `gamma`：非线性 shaping（`pow(x, gamma)`），用于增强小信号的视觉变化。
- `boost`：整体增益（最终仍会 clamp 到 `[0, 1]`）。
- `smoothing`：UI 层的 EMA 平滑，减小抖动但不让波形“发粘”。

这些参数当前通过 `StartOptions.waveform` 可覆盖，默认值在 `useMicrophoneSession` 内集中定义，方便后续调参。

### 自动发送策略（松开即发送）

- 当用户松开时计算 `durationMs`。
- 若 `durationMs < MIN_VOICE_SEND_MS`，认为录音过短，直接丢弃不发送。
- 若未来接入 ASR：
  - 推荐松开后进入 `transcribing` 状态，等 final transcript 返回后再发送 bubble；
  - 或先发一个 placeholder bubble，再用同一个 message id 更新成最终 transcript。

### 为实时 ASR 预留的接入点

`useMicrophoneSession.start(...)` 支持传入 `onPcmChunk`，用于把 PCM chunk（`Float32Array`）与 `sampleRate` 交给 ASR 引擎。

建议后续新增一个小的 ASR 抽象层（例如 `AsrEngine` interface），并在 Overlay 内把：

- partial transcript：实时展示在 overlay 的 recognized line
- final transcript：在 stop 后触发发送（替换 placeholder 或直接发送）

这样可以保持 UI 与 ASR 解耦，避免后续改动扩散。

## Tencent Real-time ASR (Front-end demo)

当前已实现一个“前端签名 + WebSocket 直连腾讯云实时 ASR”的 demo 版本，重点是把结构拆开，方便后续改成“后端下发预签名 URL / 走服务端代理”。

### 关键文件

- `src/features/asr/types.ts`
  - 抽象接口：`AsrEngine` / `AsrCallbacks` / `AsrStatus`。
- `src/features/asr/credentials.ts`
  - 仅负责从 `import.meta.env` 读取 `VITE_*` 配置（demo 阶段）。
- `src/features/asr/tencent/signature.ts`
  - 负责按腾讯文档生成签名并拼出 `wss://...` URL（HMAC-SHA1 + Base64）。
- `src/features/asr/tencent/TencentRtAsrEngine.ts`
  - WebSocket 生命周期、音频上送节奏、回包解析与 partial/final 文本聚合。
- `src/features/asr/audio/*`
  - 音频管道：重采样（线性插值 demo 版）、Float32->PCM16LE、40ms 分帧。
- `src/features/asr/hooks/useTencentRtAsrSession.ts`
  - React hook：向上提供 `start/pushAudio/stop` 与状态。
- `src/features/chat/components/VoiceChatOverlay.tsx`
  - 按住录音时启动 ASR，并用 `recognizedText` 实时显示；松开后等待 final transcript 再自动发 bubble。

### 配置方式（不要把密钥提交到仓库）

仓库内提供了 `.env.example` 作为模板（实际文件已被 `.gitignore` 忽略）。

你需要在本地创建 `.env` 或 `.env.local`，并填入：

- `VITE_TENCENT_ASR_APP_ID`
- `VITE_TENCENT_ASR_SECRET_ID`
- `VITE_TENCENT_ASR_SECRET_KEY`
- `VITE_TENCENT_ASR_ENGINE_MODEL_TYPE`（可选，默认 `16k_zh`）

### 未来切后端下发（迁移点）

当前 demo 的“签名拼 URL”在前端完成；上线时建议只替换：

- `src/features/asr/credentials.ts`：改为从后端拿预签名 URL / 临时 token

其余层（录音、分帧、WS 引擎、UI）尽量不动，避免耦合扩散。

## DashScope (Qwen) LLM (Front-end demo)

当前已接入一个“OpenAI-compatible”风格的前端 LLM 流式对话（用于 demo），目标是：

- UI 层只依赖一个 `LlmClient` 抽象，不关心具体供应商；
- demo 阶段直接在前端用 API Key 调用；
- 后续改成“后端签发 / 代理转发”时，尽量只替换配置与 client 实现，不动 UI。

### 关键文件

- `src/features/llm/types.ts`
  - `LlmClient` / `LlmMessage` / streaming callbacks 与 handle（支持 abort）。
- `src/features/llm/dashscope/config.ts`
  - 从 `import.meta.env` 读取配置（demo 阶段）。
- `src/features/llm/openaiCompatible/*`
  - 通用的 SSE 解析与 `chat/completions` streaming 逻辑（供应商无关）。
- `src/features/llm/dashscope/DashscopeLlmClient.ts`
  - DashScope (OpenAI-compatible mode) 的 client 实现（基于 `fetch` + SSE）。
- `src/features/chat/components/VoiceChatOverlay.tsx`
  - 用户发送消息后创建 assistant placeholder bubble，然后用 delta 文本流式更新同一条 bubble。

### 配置方式（不要把 Key 提交到仓库）

Vite 只会暴露以 `VITE_` 开头的 env 给前端代码。

本仓库提供了 `.env.example`，你需要在本地 `.env` / `.env.local` / `.env.production` 中填：

- `VITE_DASHSCOPE_BASE_URL`（默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`）
- `VITE_DASHSCOPE_MODEL`（默认 `qwen-plus`）
- `VITE_DASHSCOPE_API_KEY`

### 未来切后端（迁移点）

建议保持 UI 与 “拿 Key / 签名 / 代理” 解耦：

- demo：前端直接读取 `VITE_DASHSCOPE_API_KEY` 并请求；
- 上线：改为后端签发短期 token / 后端代理 `/chat/completions`，前端只拿一个 session token 或直接请求自家后端。

这样 `VoiceChatOverlay` 的消息流式更新逻辑可以保持不变。

## System Prompt 注入（Podcast vs Episode）

为了让“播客 chat”和“单集 chat”能把对应内容注入到 system prompt，同时保持后续可迭代，我们把注入拆成两层：

1) `PromptContext`：稳定的结构化上下文（来自 `CardDetail`），由页面在“点击 Chat”时构建。
2) `PromptInjectors`：可插拔的 prompt 拼接器，把 `PromptContext` 变成最终 system prompt。

### 关键文件

- `src/features/llm/prompts/types.ts`
  - `PromptContext` / `PromptInjector` 类型。
- `src/features/llm/prompts/buildPromptContext.ts`
  - `buildPromptContextForPodcastChat(card)`：播客 chat 注入 podcast + current episode + recent 2 episodes + highlight。
  - `buildPromptContextForEpisodeChat(card, episodeId)`：单集 chat 注入 podcast + target episode + highlight。
- `src/features/llm/prompts/injectors.ts`
  - `composeSystemPrompt(ctx, injectors)`：按 injector pipeline 拼接；默认包含 persona + JSON context。
- `src/pages/DetailPage.tsx`
  - 点击 Chat 时把 promptContext 填进 `VoiceChatContext`。
- `src/features/chat/components/VoiceChatOverlay.tsx`
  - 优先使用 `context.promptContext` 生成 system prompt；否则 fallback 到简单 title prompt。

### 后续怎么改注入内容（推荐方式）

- 改“注入哪些字段”：只动 `buildPromptContext.ts`（比如改 recent episodes 数量、加入 show notes、加入更多 episode 元信息等）。
- 改“怎么写进 prompt”：只动 `injectors.ts`（比如从 JSON block 改成更强的指令模板、增加 RAG 注入器等）。
