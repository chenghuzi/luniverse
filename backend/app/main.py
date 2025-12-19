from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .minimax_ws import connect_minimax_tts

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=False)

app = FastAPI(title="luniverse-backend", version="0.1.0")

MINIMAX_TTS_VOICE_ID = "mia_voice_20251219_v3"
MINIMAX_TTS_MODEL = "speech-2.6-hd"
MINIMAX_TTS_ENCODING = "hex"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True}


@app.get("/api/tts/minimax/config")
async def minimax_tts_config() -> dict[str, Any]:
    return {
        "voiceId": MINIMAX_TTS_VOICE_ID,
        "model": MINIMAX_TTS_MODEL,
        "encoding": MINIMAX_TTS_ENCODING,
        "wsPath": "/api/tts/minimax/ws",
    }


async def _close_client_ws(ws: WebSocket) -> None:
    if ws.application_state != WebSocketState.CONNECTED:
        return
    try:
        await ws.close()
    except Exception:
        return


async def _close_upstream_ws(ws: Any) -> None:
    try:
        await ws.close()
    except Exception:
        return


async def _pipe_client_to_upstream(client: WebSocket, upstream: Any) -> None:
    try:
        while True:
            message = await client.receive()
            if message.get("type") == "websocket.disconnect":
                return

            if message.get("type") != "websocket.receive":
                continue

            text = message.get("text")
            if isinstance(text, str):
                await upstream.send(text)
                continue

            data = message.get("bytes")
            if isinstance(data, (bytes, bytearray)):
                await upstream.send(bytes(data))
    except WebSocketDisconnect:
        return
    finally:
        await _close_upstream_ws(upstream)


async def _pipe_upstream_to_client(client: WebSocket, upstream: Any) -> None:
    try:
        async for message in upstream:
            if isinstance(message, bytes):
                await client.send_bytes(message)
            else:
                await client.send_text(message)
    finally:
        await _close_client_ws(client)


@app.websocket("/api/tts/minimax/ws")
async def minimax_tts_ws(ws: WebSocket) -> None:
    await ws.accept()

    api_key = os.getenv("MINIMAX_API_KEY", "").strip()
    if not api_key:
        await ws.send_json({"error": "missing MINIMAX_API_KEY"})
        await ws.close(code=1011)
        return

    try:
        async with connect_minimax_tts(api_key) as upstream:
            async with anyio.create_task_group() as tg:
                tg.start_soon(_pipe_client_to_upstream, ws, upstream)
                tg.start_soon(_pipe_upstream_to_client, ws, upstream)
    except WebSocketDisconnect:
        return
    except Exception as e:
        if ws.application_state == WebSocketState.CONNECTED:
            await ws.send_json({"error": "upstream_error", "details": str(e)})
            await ws.close(code=1011)
