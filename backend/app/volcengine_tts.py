from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

VOLCENGINE_TTS_API_URL = "https://openspeech.bytedance.com/api/v1/tts"


@dataclass(frozen=True)
class VolcengineTtsConfig:
    api_key: str
    voice_id: str
    cluster: str = "volcano_icl"
    uid: str = "声岛"


def load_volcengine_tts_config() -> VolcengineTtsConfig | None:
    api_key = os.getenv("VOLCENGINE_TTS_API_KEY", "").strip()
    voice_id = os.getenv("VOLCENGINE_TTS_VOICE_ID", "").strip()

    if not api_key or not voice_id:
        return None

    return VolcengineTtsConfig(api_key=api_key, voice_id=voice_id)


def build_volcengine_tts_config(card_id: str | None) -> dict[str, Any] | None:
    config = load_volcengine_tts_config()
    if not config:
        return None

    return {
        "provider": "volcengine",
        "apiKey": config.api_key,
        "voiceId": config.voice_id,
        "cluster": config.cluster,
        "uid": config.uid,
    }


async def synthesize_volcengine_tts(
    text: str,
    config: VolcengineTtsConfig,
    encoding: str = "mp3",
    speed_ratio: float = 1.0,
) -> bytes | None:
    reqid = uuid.uuid4().hex + str(uuid.uuid4().int)[:18]

    payload = {
        "app": {
            "cluster": config.cluster,
        },
        "user": {
            "uid": config.uid,
        },
        "audio": {
            "voice_type": config.voice_id,
            "encoding": encoding,
            "speed_ratio": speed_ratio,
        },
        "request": {
            "reqid": reqid,
            "text": text,
            "operation": "query",
        },
    }

    headers = {
        "x-api-key": config.api_key,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            VOLCENGINE_TTS_API_URL,
            headers=headers,
            json=payload,
        )

        if response.status_code != 200:
            return None

        data = response.json()
        if data.get("code") != 3000:
            return None

        import base64
        audio_data = data.get("data")
        if not audio_data:
            return None

        return base64.b64decode(audio_data)
