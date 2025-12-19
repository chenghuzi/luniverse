# MiniMax 语音克隆 + 流式 TTS 使用说明（脚本 1 / 脚本 2）

本说明覆盖：
- 脚本 1：输入音频样本 -> 克隆 -> 生成 `voice_id`
- 脚本 2：输入文本（可流式）-> 实时回传音频片段 -> 输出 MP3

> 不会在文档中包含任何真实密钥，请自行设置 `MINIMAX_API_KEY`。

---

## 1. 前置条件

- Node.js >= 18
- 已安装依赖（已包含 `ws`）：
  ```bash
  npm install
  ```
- 环境变量：
  ```bash
  export MINIMAX_API_KEY=你的key
  ```
- 一段清晰人声的音频样本（建议 15 秒，避免纯音乐）

---

## 2. 脚本 1：音频样本 -> 克隆 -> voice_id

**脚本路径**
- `scripts/minimax-clone.cjs`

**用途**
- 上传音频样本
- 调用 voice_clone
- 输出 `voice_id`（你后续用它进行文生语音）

**基础用法**
```bash
MINIMAX_API_KEY=你的key node scripts/minimax-clone.cjs \
  --audio /path/to/voice.wav \
  --voice-id my_voice_001 \
  --out clone_result.json
```

**参数说明**
- `--audio`：必填，音频样本路径（wav/mp3/m4a）
- `--voice-id`：可选，若不填会自动生成（基于时间戳）
- `--out`：可选，保存完整响应 JSON
- `--prompt-audio`：可选，提示音频（若不传，默认复用 `--audio`）
- `--prompt-text`：可选，提示文本
- `--text`：可选，克隆完成后生成的测试文本
- `--model`：可选，默认 `speech-2.6-hd`

**输出示例**
- 控制台输出：
  ```
  VOICE_ID=my_voice_001
  { ...完整JSON... }
  ```
- `clone_result.json`：保存完整返回（含 demo_audio 链接）

---

## 3. 脚本 2：流式文本 -> 实时音频 -> MP3

**脚本路径**
- `scripts/minimax-tts-stream.cjs`

**用途**
- 通过 WebSocket 流式发送文本片段
- 服务端持续回传音频片段
- 实时写入 mp3 文件

### 3.1 管道模式（推荐：接 AI 流式文本）

```bash
# 假设 your_ai_stream.js 会持续输出文本
node your_ai_stream.js | \
MINIMAX_API_KEY=你的key node scripts/minimax-tts-stream.cjs \
  --voice-id my_voice_001 \
  --out output.mp3
```

**效果**：AI 文字一段段输出，TTS 音频也一段段写入并回传，用户无需等整段完成。

### 3.2 一次性文本模式（快速测试）

```bash
printf "第一句。第二句。第三句。" | \
MINIMAX_API_KEY=你的key node scripts/minimax-tts-stream.cjs \
  --voice-id my_voice_001 \
  --out output.mp3
```

---

## 4. 流式行为说明（“跟读”效果）

- 文本通过 stdin 流式输入
- 脚本会按标点/长度做切片并 `task_continue`
- 服务端会持续回传 `data.audio` 音频片段
- mp3 文件会不断增长

> 这就是你要的“AI 文本一点点返回，音频也一点点跟读”。

---

## 5. 可调参数（控制“多快开始说”）

脚本 2 提供两个节奏参数：
- `--flush-ms 300`：最长等待时间（默认 300ms）
- `--max-chars 60`：文本片段超过这个长度强制发送

示例：更快起声
```bash
node your_ai_stream.js | \
MINIMAX_API_KEY=你的key node scripts/minimax-tts-stream.cjs \
  --voice-id my_voice_001 \
  --out output.mp3 \
  --flush-ms 150 \
  --max-chars 30
```

---

## 6. 浏览器场景注意事项

浏览器 WebSocket **不能设置 `Authorization` 头**，所以前端不能直接连 MiniMax。你需要：

- 前端 -> 你的后端 WS（自建）
- 后端 WS -> MiniMax WS（带 Authorization）

如果需要，我可以补一个“后端 WS 代理 + 前端 demo”。

---

## 7. 常见问题

- **voice_id 重复**：会报错 `voice id duplicate`，换一个新的。
- **余额不足**：会报错 `insufficient balance`。
- **音色不对**：样本里如果是音乐或嘈杂环境，会导致效果差，请换清晰人声。

---

## 8. 小结流程

1. 用脚本 1 克隆得到 `voice_id`
2. 用脚本 2 把文本流输入，实时写出 mp3

示例流程：
```bash
# 1) 克隆
MINIMAX_API_KEY=你的key node scripts/minimax-clone.cjs \
  --audio /path/to/voice.wav \
  --voice-id my_voice_001

# 2) 流式 TTS
node your_ai_stream.js | \
MINIMAX_API_KEY=你的key node scripts/minimax-tts-stream.cjs \
  --voice-id my_voice_001 \
  --out output.mp3
```
