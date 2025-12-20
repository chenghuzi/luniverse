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

## Prompt Seeds（后端拼接 transcripts）

为了让 demo 不在前端拼 system prompt，同时避免把逐字稿逻辑散落到 UI，我们把“prompt + transcripts 拼接”放在后端的 detail API 中完成：

- 前端进入详情页时请求 `GET /api/cards/{cardId}`。
- 后端除了返回原本的 detail JSON，还会额外返回 `chat` 字段，里面包含可直接喂给 LLM 的标准 `messages`（history seeds）。
- 前端只负责：
  - 根据是否存在 seeds 来 disable/enable Chat 按钮；
  - 打开 overlay 后，把 seeds 作为固定前缀拼进 LLM 请求，然后 append 用户后续对话。

### 数据位置与命名约定

- Prompt 模板：
  - `backend/data/prompts/chat_w_podcast.txt`
  - `backend/data/prompts/chat_w_episode.txt`
- Transcript：
  - `backend/data/transcripts/{cardId}.{episodeId}.txt`
  - 逐字稿文件可能缺失（并非每个 episode 都有）。

### API 返回结构（增量字段）

`GET /api/cards/{cardId}` 返回的 JSON 会额外包含：

- `chat.podcast`
  - `null`：该节目下没有任何 episode 有逐字稿
  - 否则：`{ episodeId, messages }`，其中 `messages` 结构为：
    - `system`: `chat_w_podcast.txt`
    - `user`: transcript wrapper + full transcript
    - `assistant`: ack
- `chat.episodes`
  - `Record<episodeId, { messages }>`，只包含“确实存在逐字稿文件”的 episodes。

### 选择逻辑

- “和节目聊”（podcast chat）：按 detail 的 `episodes` 顺序扫描，选择第一个存在逐字稿的 episode 作为 transcript 来源。
- “和单集聊”（episode chat）：只有当 `{cardId}.{episodeId}.txt` 存在时才返回该 episode 的 seeds；否则前端 disable 对应按钮。

### 关键文件

- 后端：
  - `backend/app/chat_seeds.py`：读取 prompt/transcripts 并生成 seeds（messages）。
  - `backend/app/main.py`：`GET /api/cards/{cardId}` 注入 `chat` 字段。
- 前端：
  - `src/shared/api/details.ts`：`CardDetail.chat` 类型定义。
  - `src/pages/DetailPage.tsx`：根据 `card.chat` disable/enable Chat 按钮，并把 `seedMessages` 传给 overlay。
  - `src/features/chat/components/VoiceChatOverlay.tsx`：请求 LLM 时把 `seedMessages` 作为固定前缀 messages。

### 旧的前端 Prompt 注入（暂留但不再走主路径）

`src/features/llm/prompts/*` 仍然保留（便于对比/回退/快速试验），但当前主流程已改为后端返回 seeds。

## Backend (FastAPI demo)

### 约定（必须遵守）

- `backend/.venv` 是仓库内的 Python 虚拟环境；所有 Python 相关命令必须使用该 venv 的解释器与 pip。
- 所有依赖必须先写入 `backend/requirements.txt`，再用 venv 的 pip 安装；不要先 `pip install` 再补写文件。
- 所有 API 端点路径必须以 `/api/...` 开头（包含 HTTP 与 WebSocket）。
- demo 阶段不做任何鉴权；上线前需要再补鉴权/限流/日志脱敏等。
- 后端使用 `python-dotenv` 从 `backend/.env` 加载环境变量；请复制 `backend/.env.example` 为 `backend/.env` 并填写密钥（不要提交到仓库）。
- 卡片/详情数据文件统一放在 `backend/data/`：
  - 列表：`backend/data/deckCards.json`
  - 详情：`backend/data/details/*.json`
  - 后端直接读取这些拆分文件提供 `/api/deck` 与 `/api/cards/{cardId}`。

### 常用命令

```bash
backend/.venv/bin/python --version
backend/.venv/bin/pip install -r backend/requirements.txt

backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --reload --port 8102
```

### Front-end dev proxy

- `vite.config.ts` 在开发模式下会把 `/api`（含 WebSocket）代理到 `http://127.0.0.1:8102`，所以前端代码应始终使用相对路径 `/api/...`。

### MiniMax TTS (front-end demo)

- 后端提供 `GET /api/tts/minimax/config`，前端在加载 detail 后自动拉取该配置（voiceId/model/encoding/wsPath）。
- 前端通过 WebSocket 连接配置里的 `wsPath`（由后端代理到 MiniMax，负责注入 `MINIMAX_API_KEY`）。
- voiceId 在后端代码里写死（见 `backend/app/main.py`），前端不再使用任何 `VITE_MINIMAX_TTS_*` 配置。
