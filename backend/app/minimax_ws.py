from __future__ import annotations

import inspect
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import websockets

MINIMAX_TTS_WS_URL = "wss://api.minimaxi.com/ws/v1/t2a_v2"


def _connect_kwargs(api_key: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        sig = inspect.signature(websockets.connect)
    except (TypeError, ValueError):
        sig = None

    kwargs: dict[str, Any] = {"ping_interval": 20, "close_timeout": 5}

    if sig and "extra_headers" in sig.parameters:
        kwargs["extra_headers"] = headers
        return kwargs

    if sig and "additional_headers" in sig.parameters:
        kwargs["additional_headers"] = headers
        return kwargs

    kwargs["extra_headers"] = headers
    return kwargs


@asynccontextmanager
async def connect_minimax_tts(api_key: str) -> AsyncIterator[Any]:
    async with websockets.connect(MINIMAX_TTS_WS_URL, **_connect_kwargs(api_key)) as upstream:
        yield upstream
