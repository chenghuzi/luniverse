from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket, Body
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .cards_data import CardsDataset, load_default_cards_dataset
from .chat_seeds import build_chat_seeds_for_card
from .minimax_tts_config import build_minimax_tts_config
from .minimax_ws import connect_minimax_tts
from .volcengine_asr import (
    build_audio_packet,
    build_full_client_request,
    connect_volcengine_asr,
    load_volcengine_asr_config,
    make_connect_id,
    parse_server_packet,
)
from .volcengine_tts import synthesize_volcengine_tts, VolcengineTtsConfig

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=False)

app = FastAPI(title="luniverse-backend", version="0.1.0")

_CARDS_DATASET: CardsDataset | None = None
_INSTANCE_SEQ = 0


def _mod(n: int, m: int) -> int:
    r = n % m
    return r + m if r < 0 else r


def _get_cards_dataset() -> CardsDataset:
    global _CARDS_DATASET
    if _CARDS_DATASET is None:
        _CARDS_DATASET = load_default_cards_dataset()
    return _CARDS_DATASET


def _next_instance_id(card_id: str) -> str:
    global _INSTANCE_SEQ
    instance_id = f"{card_id}-{_INSTANCE_SEQ}"
    _INSTANCE_SEQ += 1
    return instance_id


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


@app.get("/api/deck")
async def deck(
    cursor: int = Query(0, description="卡片列表的游标位置"),
    limit: int = Query(8, description="每页数量，范围限制在 1 到 50"),
) -> dict[str, Any]:
    dataset = _get_cards_dataset()
    base = dataset.deck_cards
    base_len = len(base)
    if base_len == 0:
        return {"cards": [], "nextCursor": 0}

    safe_limit = max(1, min(50, int(limit)))
    start = _mod(int(cursor), base_len)

    cards: list[dict[str, Any]] = []
    for i in range(safe_limit):
        item = base[(start + i) % base_len]
        card_id = str(item.get("id", "")).strip()
        if not card_id:
            continue
        cards.append({**item, "instanceId": _next_instance_id(card_id)})

    next_cursor = _mod(start + safe_limit, base_len)
    return {"cards": cards, "nextCursor": next_cursor}


@app.get("/api/cards/{card_id}")
async def card_detail(card_id: str) -> dict[str, Any]:
    cid = str(card_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="缺少卡片 ID")

    dataset = _get_cards_dataset()
    card = dataset.by_id.get(cid)
    if not card:
        raise HTTPException(status_code=404, detail="未找到卡片")

    payload: dict[str, Any] = dict(card)
    payload["chat"] = build_chat_seeds_for_card(cid, card)
    return payload


@app.get("/api/tts/minimax/config")
async def minimax_tts_config(
    card_id: str | None = Query(None, alias="cardId", description="卡片 ID（卡片列表里的 id）"),
    cardid: str | None = Query(None, include_in_schema=False),
) -> dict[str, Any]:
    selected = (card_id or cardid or "").strip() or None
    return build_minimax_tts_config(selected)


@app.post("/api/tts/volcengine/synthesize")
async def volcengine_tts_synthesize(
    text: str = Body(..., embed=True),
    voice_id: str = Body(..., embed=True),
    api_key: str = Body(..., embed=True),
    cluster: str = Body("volcano_icl", embed=True),
    uid: str = Body("声岛", embed=True),
) -> bytes:
    if not text.strip():
        raise HTTPException(status_code=400, detail="文本不能为空")

    config = VolcengineTtsConfig(
        api_key=api_key,
        voice_id=voice_id,
        cluster=cluster,
        uid=uid,
    )

    audio_data = await synthesize_volcengine_tts(text, config)
    if audio_data is None:
        raise HTTPException(status_code=500, detail="语音合成失败")

    from fastapi.responses import Response
    return Response(content=audio_data, media_type="audio/mpeg")


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
        await ws.send_json({"error": "未配置 MINIMAX_API_KEY"})
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
            await ws.send_json({"error": "上游服务异常", "details": str(e)})
            await ws.close(code=1011)


async def _pipe_client_to_volcengine_upstream(client: WebSocket, upstream: Any) -> None:
    try:
        while True:
            message = await client.receive()
            if message.get("type") == "websocket.disconnect":
                await upstream.close()
                return

            if message.get("type") != "websocket.receive":
                continue

            text = message.get("text")
            if isinstance(text, str):
                try:
                    payload = json.loads(text)
                except Exception:
                    payload = {}
                if payload.get("type") == "end":
                    await upstream.send(build_audio_packet(b"", is_last=True))
                    return
                continue

            data = message.get("bytes")
            if isinstance(data, (bytes, bytearray)) and data:
                await upstream.send(build_audio_packet(bytes(data), is_last=False))
    except WebSocketDisconnect:
        await _close_upstream_ws(upstream)


async def _pipe_volcengine_upstream_to_client(client: WebSocket, upstream: Any) -> None:
    try:
        async for message in upstream:
            if not isinstance(message, bytes):
                continue

            event = parse_server_packet(message)
            if event is None:
                continue

            if event.type == "error":
                await client.send_json({"type": "error", "message": event.message})
                await _close_client_ws(client)
                return

            await client.send_json({"type": event.type, "text": event.text})
    finally:
        await _close_client_ws(client)


@app.websocket("/api/asr/volcengine/ws")
async def volcengine_asr_ws(ws: WebSocket) -> None:
    await ws.accept()

    config = load_volcengine_asr_config()
    if not config:
        await ws.send_json({"type": "error", "message": "未配置火山引擎语音识别"})
        await ws.close(code=1011)
        return

    connect_id = make_connect_id()

    try:
        async with connect_volcengine_asr(config, connect_id) as upstream:
            await upstream.send(build_full_client_request(connect_id))
            await ws.send_json({"type": "ready"})

            async with anyio.create_task_group() as tg:
                tg.start_soon(_pipe_client_to_volcengine_upstream, ws, upstream)
                tg.start_soon(_pipe_volcengine_upstream_to_client, ws, upstream)
    except WebSocketDisconnect:
        return
    except Exception as e:
        if ws.application_state == WebSocketState.CONNECTED:
            await ws.send_json({"type": "error", "message": "上游服务异常", "details": str(e)})
            await ws.close(code=1011)
