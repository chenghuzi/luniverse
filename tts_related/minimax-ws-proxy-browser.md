# MiniMax 流式 TTS：后端 WS 代理 + 浏览器示例

这份文档说明如何在浏览器中实现“边接收文本、边播报”的体验。关键点是：**浏览器 WebSocket 不能设置 `Authorization` 头**，所以必须用后端做代理。

---

## 1. 架构与数据流

```
浏览器(WS)  <--->  你的后端 WS 代理  <--->  MiniMax WS
               (负责鉴权/转发)         (带 Authorization)
```

流程：
1. 浏览器连接到你的后端 WS
2. 后端与 MiniMax WS 建立连接（带 `Authorization: Bearer <API_KEY>`）
3. 浏览器把 TTS 事件按 MiniMax 的协议发送给后端
4. 后端原样转发给 MiniMax；MiniMax 回传音频片段
5. 后端原样转发给浏览器；浏览器实时播放

---

## 2. 后端 WS 代理（Node.js 示例）

> 说明：这是**示例结构**，用于展示转发逻辑。生产环境需加鉴权、限流、日志脱敏等。

```js
// server/ws-proxy.js
import http from 'http'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'

const API_KEY = process.env.MINIMAX_API_KEY
if (!API_KEY) throw new Error('Missing MINIMAX_API_KEY')

const server = http.createServer()
const wss = new WebSocketServer({ server })

wss.on('connection', (client) => {
  // 连接 MiniMax
  const upstream = new WebSocket('wss://api.minimaxi.com/ws/v1/t2a_v2', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })

  // 浏览器 -> MiniMax
  client.on('message', (raw) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(raw)
    }
  })

  // MiniMax -> 浏览器
  upstream.on('message', (raw) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw)
    }
  })

  const closeAll = () => {
    if (client.readyState === WebSocket.OPEN) client.close()
    if (upstream.readyState === WebSocket.OPEN) upstream.close()
  }

  client.on('close', closeAll)
  upstream.on('close', closeAll)
  client.on('error', closeAll)
  upstream.on('error', closeAll)
})

server.listen(8787, () => {
  console.log('WS proxy listening on ws://localhost:8787')
})
```

**生产环境建议**
- 对客户端做鉴权（JWT 或 session）
- 限流/计费保护（防止被滥用）
- 只允许特定 payload（不要当公共转发器）

---

## 3. 浏览器端示例（流式文本 + 实时播放）

### 3.1 连接并发送事件

> 浏览器只需要连接你的后端 WS（例如 `ws://localhost:8787`）。

```js
// browser/tts-stream.js
const ws = new WebSocket('ws://localhost:8787')

const voiceId = 'my_voice_001'

ws.onopen = () => {
  // 1) 启动任务
  ws.send(JSON.stringify({
    event: 'task_start',
    model: 'speech-2.6-hd',
    voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  }))

  // 2) 模拟 AI 流式文本，每 300ms 送一段
  const chunks = ['你好，', '这里是实时', '语音合成示例。']
  let i = 0
  const timer = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(timer)
      ws.send(JSON.stringify({ event: 'task_finish' }))
      return
    }
    ws.send(JSON.stringify({ event: 'task_continue', text: chunks[i++] }))
  }, 300)
}
```

### 3.2 实时播放音频（MediaSource）

MiniMax 通常会返回 `data.audio`（hex/base64 字符串）。
下面示例假设返回 **hex**，并将 mp3 片段追加到 `MediaSource`。

```js
// browser/playback.js
const audio = document.querySelector('audio')
const mediaSource = new MediaSource()
let sourceBuffer
const queue = []
let sourceOpen = false

function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

mediaSource.addEventListener('sourceopen', () => {
  sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg')
  sourceOpen = true
  sourceBuffer.addEventListener('updateend', () => {
    if (queue.length) {
      sourceBuffer.appendBuffer(queue.shift())
    }
  })
})

audio.src = URL.createObjectURL(mediaSource)

audio.play().catch(() => {})

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data)
  const audioHex = msg?.data?.audio
  if (!audioHex || !sourceOpen) return

  const chunk = hexToUint8Array(audioHex)
  if (sourceBuffer.updating || queue.length) {
    queue.push(chunk)
  } else {
    sourceBuffer.appendBuffer(chunk)
  }
}
```

> **注意**：如果返回的是 base64，请把 `hexToUint8Array` 改成 `atob` 解码逻辑。

---

## 4. “跟读”体验的关键策略

为了“尽快出声”，你需要把文本**切小块并及时送出**，但不要按单字切割。

建议策略：
- **分块规则**：按标点（。！？,）或每 20~60 字切分
- **节奏控制**：每 200~500ms 允许发送一块
- **小缓冲播放**：积累 200~500ms 音频再开始播放，减少卡顿

---

## 5. 小结

- 后端 WS 代理是必须的（浏览器无法带 Authorization）
- 浏览器只需发送 MiniMax 的 JSON 事件即可
- 通过流式 `task_continue` 即可实现“AI 文本一点点来，语音一点点播”

如果你希望我把这套内容整理成可直接运行的 demo 项目（含前后端代码），告诉我即可。
