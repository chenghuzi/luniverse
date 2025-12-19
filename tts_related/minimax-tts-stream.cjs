#!/usr/bin/env node

const fs = require('fs')
const WebSocket = require('ws')

const apiKey = process.env.MINIMAX_API_KEY
if (!apiKey) {
  console.error('Missing MINIMAX_API_KEY in environment')
  process.exit(1)
}

const args = process.argv.slice(2)
const getArg = (flag, fallback = undefined) => {
  const idx = args.indexOf(flag)
  if (idx === -1) return fallback
  return args[idx + 1]
}

const voiceId = getArg('--voice-id')
const text = getArg('--text')
const outPath = getArg('--out', 'tts_stream_output.mp3')
const model = getArg('--model', 'speech-2.6-hd')
const encoding = getArg('--encoding', 'hex') // hex (default) or base64
const flushMs = Number(getArg('--flush-ms', '300'))
const maxChunkChars = Number(getArg('--max-chars', '60'))

if (!voiceId) {
  console.error(
    'Usage: MINIMAX_API_KEY=... node scripts/minimax-tts-stream.cjs --voice-id <voice_id> [--text "..."] [--out output.mp3] [--encoding hex|base64] [--flush-ms 300] [--max-chars 60]'
  )
  process.exit(1)
}

const wsUrl = 'wss://api.minimaxi.com/ws/v1/t2a_v2'
const taskId = `task_${Date.now()}_${Math.random().toString(16).slice(2)}`

const outStream = fs.createWriteStream(outPath)

const socket = new WebSocket(wsUrl, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
})

function sendJson(payload) {
  socket.send(JSON.stringify(payload))
}

function decodeAudioChunk(audio) {
  if (!audio) return null
  if (encoding === 'base64') return Buffer.from(audio, 'base64')
  return Buffer.from(audio, 'hex')
}

let started = false
let finished = false
let pending = ''
let flushTimer = null

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushPending(true)
  }, flushMs)
}

function flushPending(force = false) {
  if (!started) return
  if (!pending.trim()) return
  if (!force && pending.length < maxChunkChars) return

  const cutoff = findFlushIndex(pending, maxChunkChars)
  if (cutoff <= 0 && !force) return

  const chunk = pending.slice(0, cutoff > 0 ? cutoff : pending.length)
  pending = pending.slice(chunk.length)
  sendJson({ event: 'task_continue', text: chunk })
}

function findFlushIndex(textBuffer, limit) {
  if (textBuffer.length <= limit) {
    return findLastPunctuation(textBuffer)
  }

  const window = textBuffer.slice(0, limit)
  const idx = findLastPunctuation(window)
  return idx > 0 ? idx : limit
}

function findLastPunctuation(textBuffer) {
  const matches = textBuffer.match(/.*[。！？!?，,；;：:、.\\n]/)
  if (!matches) return -1
  return matches[0].length
}

socket.on('open', () => {
  const initPayload = {
    event: 'task_start',
    model,
    voice_setting: {
      voice_id: voiceId,
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  }

  sendJson(initPayload)
})

socket.on('message', (raw) => {
  let msg = null
  try {
    msg = JSON.parse(raw.toString())
  } catch (err) {
    console.error('Failed to parse message:', raw.toString())
    return
  }

  if (msg.base_resp && msg.base_resp.status_code !== 0) {
    console.error('API error:', msg)
    return
  }

  if (msg.event === 'task_started') {
    started = true
    if (text) {
      sendJson({ event: 'task_continue', text })
      sendJson({ event: 'task_finish' })
      return
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      if (finished) return
      pending += chunk
      flushPending()
      scheduleFlush()
    })
    process.stdin.on('end', () => {
      if (finished) return
      flushPending(true)
      sendJson({ event: 'task_finish' })
    })
    return
  }

  if (msg.event === 'task_failed') {
    console.error('Task failed:', msg)
    finished = true
    socket.close()
    outStream.end()
    return
  }

  const audio = msg?.data?.audio
  if (audio) {
    const chunk = decodeAudioChunk(audio)
    if (chunk) {
      outStream.write(chunk)
      console.log(`Audio chunk written: ${chunk.length} bytes`)
    }
  }

  if (msg.event === 'task_finished') {
    finished = true
    outStream.end()
    socket.close()
    console.log(`Done. Output saved to ${outPath}`)
  }
})

socket.on('error', (err) => {
  console.error('WebSocket error:', err)
})

socket.on('close', () => {
  if (!finished) outStream.end()
})
