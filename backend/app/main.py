from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .cards_data import CardsDataset, load_default_cards_dataset
from .chat_seeds import build_chat_seeds_for_card
from .minimax_tts_config import build_minimax_tts_config
from .minimax_ws import connect_minimax_tts

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
    cursor: int = Query(0, description="cursor index into the base card list"),
    limit: int = Query(8, description="page size, clamped to [1, 50]"),
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
        raise HTTPException(status_code=400, detail="cardId is required")

    dataset = _get_cards_dataset()
    card = dataset.by_id.get(cid)
    if not card:
        raise HTTPException(status_code=404, detail="card not found")

    payload: dict[str, Any] = dict(card)
    payload["chat"] = build_chat_seeds_for_card(cid, card)
    return payload


@app.get("/api/tts/minimax/config")
async def minimax_tts_config(
    card_id: str | None = Query(None, alias="cardId", description="card id (deck card id)"),
    cardid: str | None = Query(None, include_in_schema=False),
) -> dict[str, Any]:
    selected = (card_id or cardid or "").strip() or None
    return build_minimax_tts_config(selected)


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
