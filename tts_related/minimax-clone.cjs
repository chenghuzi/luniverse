#!/usr/bin/env node

const https = require('https')
const fs = require('fs')
const path = require('path')

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

const inputPath = getArg('--audio') || getArg('--input')
const promptPath = getArg('--prompt-audio')
const promptText = getArg('--prompt-text', 'This is a prompt audio for voice cloning.')
const sampleText = getArg('--text', 'Hello, this is a quick sample to validate the cloned voice.')
const model = getArg('--model', 'speech-2.6-hd')
const outPath = getArg('--out')

if (!inputPath) {
  console.error(
    'Usage: MINIMAX_API_KEY=... node scripts/minimax-clone.cjs --audio /path/to/voice.wav [--voice-id custom_id] [--prompt-audio /path/to/prompt.wav] [--prompt-text "..."] [--text "..."] [--out result.json]'
  )
  process.exit(1)
}

const voiceId = getArg('--voice-id', `voice_${Date.now()}`)

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.wav') return 'audio/wav'
  return 'application/octet-stream'
}

function buildMultipart({ fields, fileFieldName, filePath }) {
  const boundary = `----minimax-${Date.now().toString(16)}`
  const chunks = []
  const push = (value) => {
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value))
  }

  Object.entries(fields).forEach(([name, value]) => {
    push(`--${boundary}\r\n`)
    push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`)
    push(`${value}\r\n`)
  })

  const filename = path.basename(filePath)
  const mime = guessMime(filePath)
  const fileBuffer = fs.readFileSync(filePath)

  push(`--${boundary}\r\n`)
  push(
    `Content-Disposition: form-data; name="${fileFieldName}"; filename="${filename}"\r\n`
  )
  push(`Content-Type: ${mime}\r\n\r\n`)
  push(fileBuffer)
  push(`\r\n--${boundary}--\r\n`)

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function postMultipart(url, fields, filePath) {
  return new Promise((resolve, reject) => {
    const { body, contentType } = buildMultipart({
      fields,
      fileFieldName: 'file',
      filePath,
    })

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      }
    )

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload))
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(err)
          }
        })
      }
    )

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function run() {
  const uploadUrl = 'https://api.minimaxi.com/v1/files/upload'
  const cloneUrl = 'https://api.minimaxi.com/v1/voice_clone'

  const voiceUpload = await postMultipart(uploadUrl, { purpose: 'voice_clone' }, inputPath)
  const voiceFileId = voiceUpload?.file?.file_id
  if (!voiceFileId) {
    console.error('Upload failed:', voiceUpload)
    process.exit(1)
  }

  const promptSource = promptPath || inputPath
  const promptUpload = await postMultipart(uploadUrl, { purpose: 'prompt_audio' }, promptSource)
  const promptFileId = promptUpload?.file?.file_id
  if (!promptFileId) {
    console.error('Prompt upload failed:', promptUpload)
    process.exit(1)
  }

  const clonePayload = {
    file_id: voiceFileId,
    voice_id: voiceId,
    clone_prompt: {
      prompt_audio: promptFileId,
      prompt_text: promptText,
    },
    text: sampleText,
    model,
  }

  const cloneResp = await postJson(cloneUrl, clonePayload)

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(cloneResp, null, 2))
  }

  console.log(`VOICE_ID=${voiceId}`)
  console.log(JSON.stringify(cloneResp, null, 2))
}

run().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
