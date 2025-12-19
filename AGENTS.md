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
