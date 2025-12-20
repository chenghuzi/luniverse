from __future__ import annotations

from pathlib import Path
from typing import Any, Literal, TypedDict

from .cards_data import resolve_backend_root_from_backend_app


class _LlmMessage(TypedDict):
    role: Literal["system", "user", "assistant"]
    content: str


class _SeedBundle(TypedDict, total=False):
    episodeId: str
    messages: list[_LlmMessage]


class _CardChatSeeds(TypedDict):
    podcast: _SeedBundle | None
    episodes: dict[str, _SeedBundle]


_TEXT_CACHE: dict[Path, str] = {}


def _read_text(path: Path) -> str:
    cached = _TEXT_CACHE.get(path)
    if cached is not None:
        return cached
    text = path.read_text("utf-8")
    _TEXT_CACHE[path] = text
    return text


def _resolve_data_dir() -> Path:
    backend_root = resolve_backend_root_from_backend_app()
    return backend_root / "data"


def _prompt_dir() -> Path:
    return _resolve_data_dir() / "prompts"


def _transcripts_dir() -> Path:
    return _resolve_data_dir() / "transcripts"


def _prompt_path(kind: Literal["podcast", "episode"]) -> Path:
    if kind == "podcast":
        return _prompt_dir() / "chat_w_podcast.txt"
    return _prompt_dir() / "chat_w_episode.txt"


def _transcript_wrapper_template_path() -> Path:
    return _prompt_dir() / "transcript_user_wrapper.txt"


def _transcript_ack_path() -> Path:
    return _prompt_dir() / "transcript_assistant_ack.txt"


def _transcript_path(card_id: str, episode_id: str) -> Path:
    return _transcripts_dir() / f"{card_id}.{episode_id}.txt"


def _to_str(value: Any) -> str:
    return str(value or "").strip()


def _iter_episode_ids(card: dict[str, Any]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []

    episodes = card.get("episodes")
    if isinstance(episodes, list):
        for item in episodes:
            if not isinstance(item, dict):
                continue
            eid = _to_str(item.get("id"))
            if not eid or eid in seen:
                continue
            seen.add(eid)
            ordered.append(eid)

    episode = card.get("episode")
    if isinstance(episode, dict):
        eid = _to_str(episode.get("id"))
        if eid and eid not in seen:
            ordered.append(eid)

    return ordered


def _build_seed_messages(kind: Literal["podcast", "episode"], transcript_text: str) -> list[_LlmMessage]:
    system_prompt = _read_text(_prompt_path(kind)).strip()
    wrapper_template = _read_text(_transcript_wrapper_template_path()).strip("\n")
    ack_text = _read_text(_transcript_ack_path()).strip()

    transcript_block = wrapper_template.replace("{transcript}", transcript_text.strip())
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": transcript_block},
        {"role": "assistant", "content": ack_text},
    ]


def _maybe_load_transcript(card_id: str, episode_id: str) -> str | None:
    path = _transcript_path(card_id, episode_id)
    if not path.exists():
        return None
    try:
        return _read_text(path)
    except Exception:
        return None


def build_chat_seeds_for_card(card_id: str, card: dict[str, Any]) -> _CardChatSeeds:
    episode_ids = _iter_episode_ids(card)

    episode_seeds: dict[str, _SeedBundle] = {}
    for eid in episode_ids:
        transcript = _maybe_load_transcript(card_id, eid)
        if transcript is None:
            continue
        episode_seeds[eid] = {"messages": _build_seed_messages("episode", transcript)}

    podcast_seed: _SeedBundle | None = None
    for eid in episode_ids:
        transcript = _maybe_load_transcript(card_id, eid)
        if transcript is None:
            continue
        podcast_seed = {"episodeId": eid, "messages": _build_seed_messages("podcast", transcript)}
        break

    return {"podcast": podcast_seed, "episodes": episode_seeds}

