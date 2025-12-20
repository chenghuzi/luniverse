from __future__ import annotations

from typing import Any

MINIMAX_TTS_MODEL = "speech-2.6-hd"
MINIMAX_TTS_ENCODING = "hex"
MINIMAX_TTS_WS_PATH = "/api/tts/minimax/ws"

DEFAULT_MINIMAX_TTS_VOICE_ID = "clip_s8e6_1766199126" # 鲁豫 默认声音

_VOICE_ID_BY_CARD_ID: dict[str, str] = {
    "c_3067a773be17": "clip_13_1766199126",
    "c_d9f9c10cfcb9": "clip_s8e6_1766199126",
    "c_a717d83d2177": "clip_no77_1766199126",
    "c_2a228717168e": "chenghuzi_voice_20251220_v4",
    "c_295c4a1f13a0":"c_295c4a1f13a0_1766214281",
    "c_67649cb49e0f":"c_67649cb49e0f_1766214281",
    "c_2a4fe8861408":"c_2a4fe8861408_1766214281",
    "c_4519164ba984":"c_4519164ba984_1766214281",
    "c_0d0d73b06b0f":"c_0d0d73b06b0f_1766214281",
    "c_0c6c7fd9fb6e":"c_0c6c7fd9fb6e_1766214281",
}



def select_minimax_voice_id(card_id: str | None) -> str:
    cid = str(card_id or "").strip()
    if not cid:
        return DEFAULT_MINIMAX_TTS_VOICE_ID
    return _VOICE_ID_BY_CARD_ID.get(cid, DEFAULT_MINIMAX_TTS_VOICE_ID)


def build_minimax_tts_config(card_id: str | None) -> dict[str, Any]:
    return {
        "voiceId": select_minimax_voice_id(card_id),
        "model": MINIMAX_TTS_MODEL,
        "encoding": MINIMAX_TTS_ENCODING,
        "wsPath": MINIMAX_TTS_WS_PATH,
    }

