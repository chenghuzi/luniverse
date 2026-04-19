from __future__ import annotations

import gzip
import inspect
import json
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import websockets

VOLCENGINE_ASR_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
DEFAULT_VOLCENGINE_ASR_RESOURCE_ID = "volc.bigasr.sauc.duration"

PROTOCOL_VERSION = 0x1
HEADER_SIZE = 0x1

MESSAGE_FULL_CLIENT_REQUEST = 0x1
MESSAGE_AUDIO_ONLY_REQUEST = 0x2
MESSAGE_FULL_SERVER_RESPONSE = 0x9
MESSAGE_ERROR_RESPONSE = 0xF

FLAG_NONE = 0x0
FLAG_LAST = 0x2

SERIALIZATION_NONE = 0x0
SERIALIZATION_JSON = 0x1

COMPRESSION_NONE = 0x0
COMPRESSION_GZIP = 0x1

SUCCESS_CODE = 1000


@dataclass(frozen=True)
class VolcengineAsrConfig:
  app_id: str
  access_token: str
  resource_id: str


@dataclass(frozen=True)
class VolcengineAsrEvent:
  type: str
  text: str = ""
  message: str = ""


def load_volcengine_asr_config() -> VolcengineAsrConfig | None:
  app_id = os.getenv("VOLCENGINE_ASR_APP_ID", "").strip()
  access_token = os.getenv("VOLCENGINE_ASR_ACCESS_TOKEN", "").strip()
  resource_id = os.getenv("VOLCENGINE_ASR_RESOURCE_ID", "").strip() or DEFAULT_VOLCENGINE_ASR_RESOURCE_ID

  if not app_id or not access_token:
    return None

  return VolcengineAsrConfig(app_id=app_id, access_token=access_token, resource_id=resource_id)


def _connect_kwargs(config: VolcengineAsrConfig, connect_id: str) -> dict[str, Any]:
  headers = {
    "X-Api-App-Key": config.app_id,
    "X-Api-Access-Key": config.access_token,
    "X-Api-Resource-Id": config.resource_id,
    "X-Api-Connect-Id": connect_id,
  }

  try:
    sig = inspect.signature(websockets.connect)
  except (TypeError, ValueError):
    sig = None

  kwargs: dict[str, Any] = {"ping_interval": 20, "close_timeout": 5}

  if sig and "proxy" in sig.parameters:
    kwargs["proxy"] = None

  if sig and "extra_headers" in sig.parameters:
    kwargs["extra_headers"] = headers
    return kwargs

  if sig and "additional_headers" in sig.parameters:
    kwargs["additional_headers"] = headers
    return kwargs

  kwargs["extra_headers"] = headers
  return kwargs


@asynccontextmanager
async def connect_volcengine_asr(config: VolcengineAsrConfig, connect_id: str) -> AsyncIterator[Any]:
  async with websockets.connect(VOLCENGINE_ASR_WS_URL, **_connect_kwargs(config, connect_id)) as upstream:
    yield upstream


def _build_header(message_type: int, flags: int, serialization: int, compression: int) -> bytes:
  return bytes(
    [
      ((PROTOCOL_VERSION & 0x0F) << 4) | (HEADER_SIZE & 0x0F),
      ((message_type & 0x0F) << 4) | (flags & 0x0F),
      ((serialization & 0x0F) << 4) | (compression & 0x0F),
      0x00,
    ]
  )


def _build_client_packet(message_type: int, flags: int, payload: bytes, *, serialization: int, compression: int) -> bytes:
  return _build_header(message_type, flags, serialization, compression) + len(payload).to_bytes(4, "big") + payload


def build_full_client_request(connect_id: str) -> bytes:
  payload = {
    "user": {
      "uid": connect_id,
    },
    "audio": {
      "format": "pcm",
      "rate": 16000,
      "bits": 16,
      "channel": 1,
      "language": "zh-CN",
    },
    "request": {
      "model_name": "bigmodel",
      "enable_itn": True,
      "enable_ddc": False,
      "enable_punc": True,
      "show_utterances": True,
    },
  }
  body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
  return _build_client_packet(
    MESSAGE_FULL_CLIENT_REQUEST,
    FLAG_NONE,
    body,
    serialization=SERIALIZATION_JSON,
    compression=COMPRESSION_GZIP,
  )


def build_audio_packet(audio_bytes: bytes, *, is_last: bool) -> bytes:
  flags = FLAG_LAST if is_last else FLAG_NONE
  if not audio_bytes:
    return _build_client_packet(
      MESSAGE_AUDIO_ONLY_REQUEST,
      flags,
      b"",
      serialization=SERIALIZATION_NONE,
      compression=COMPRESSION_NONE,
    )

  payload = gzip.compress(audio_bytes)
  return _build_client_packet(
    MESSAGE_AUDIO_ONLY_REQUEST,
    flags,
    payload,
    serialization=SERIALIZATION_NONE,
    compression=COMPRESSION_GZIP,
  )


def _extract_payload(packet: bytes) -> tuple[int, int, int, dict[str, Any] | None]:
  if len(packet) < 4:
    return 0, 0, 0, None

  header_size_words = packet[0] & 0x0F
  header_size = header_size_words * 4
  if header_size < 4 or len(packet) < header_size:
    return 0, 0, 0, None

  message_type = (packet[1] >> 4) & 0x0F
  flags = packet[1] & 0x0F
  compression = packet[2] & 0x0F
  offset = header_size

  if message_type == MESSAGE_FULL_SERVER_RESPONSE:
    if len(packet) < offset + 8:
      return message_type, flags, 0, None
    sequence = int.from_bytes(packet[offset : offset + 4], "big", signed=True)
    payload_size = int.from_bytes(packet[offset + 4 : offset + 8], "big")
    payload = packet[offset + 8 : offset + 8 + payload_size]
  elif message_type == MESSAGE_ERROR_RESPONSE:
    if len(packet) < offset + 8:
      return message_type, flags, 0, None
    sequence = 0
    payload_size = int.from_bytes(packet[offset + 4 : offset + 8], "big")
    payload = packet[offset + 8 : offset + 8 + payload_size]
  else:
    return message_type, flags, 0, None

  if compression == COMPRESSION_GZIP and payload:
    payload = gzip.decompress(payload)

  if not payload:
    return message_type, flags, sequence, None

  try:
    data = json.loads(payload.decode("utf-8"))
  except (UnicodeDecodeError, json.JSONDecodeError):
    return message_type, flags, sequence, None

  return message_type, flags, sequence, data if isinstance(data, dict) else None


def _iter_utterances(node: Any):
  if isinstance(node, dict):
    utterances = node.get("utterances")
    if isinstance(utterances, list):
      for item in utterances:
        if isinstance(item, dict):
          yield item
    for value in node.values():
      yield from _iter_utterances(value)
  elif isinstance(node, list):
    for item in node:
      yield from _iter_utterances(item)


def _extract_text(payload: dict[str, Any] | None) -> tuple[str, bool]:
  if not payload:
    return "", False

  texts: list[str] = []
  is_final = False
  for utterance in _iter_utterances(payload):
    text = str(utterance.get("text") or "").strip()
    if text:
      texts.append(text)
    if utterance.get("definite") is True:
      is_final = True

  if texts:
    return "".join(texts), is_final

  result = payload.get("result")
  if isinstance(result, dict):
    text = str(result.get("text") or "").strip()
    if text:
      return text, bool(result.get("is_final"))

  fallback = str(payload.get("text") or "").strip()
  return fallback, is_final


def parse_server_packet(packet: bytes) -> VolcengineAsrEvent | None:
  message_type, flags, sequence, payload = _extract_payload(packet)
  if message_type == MESSAGE_ERROR_RESPONSE:
    message = ""
    if isinstance(payload, dict):
      message = str(payload.get("message") or payload.get("error") or "").strip()
    return VolcengineAsrEvent(type="error", message=message or "语音识别服务异常")

  if message_type != MESSAGE_FULL_SERVER_RESPONSE:
    return None

  if not isinstance(payload, dict):
    return None

  code = payload.get("code")
  if code not in (None, SUCCESS_CODE):
    message = str(payload.get("message") or "").strip()
    return VolcengineAsrEvent(type="error", message=message or f"语音识别服务返回错误（代码 {code}）")

  text, is_final = _extract_text(payload)
  if not text and not (flags & FLAG_LAST):
    return None

  if is_final or sequence < 0 or bool(flags & FLAG_LAST):
    return VolcengineAsrEvent(type="final", text=text)
  return VolcengineAsrEvent(type="partial", text=text)


def make_connect_id() -> str:
  return str(uuid.uuid4())
