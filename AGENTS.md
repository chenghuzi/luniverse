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

