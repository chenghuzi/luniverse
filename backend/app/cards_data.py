from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SNIPPET_WINDOW_SECONDS = 30


def _stable_u32(seed: str) -> int:
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _to_int_or_none(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _maybe_inject_snippet(card: dict[str, Any]) -> None:
    highlight = card.get("highlight")
    if not isinstance(highlight, dict):
        return
    if "snippet" in highlight:
        return

    episode = card.get("episode")
    if not isinstance(episode, dict):
        return
    duration_seconds = _to_int_or_none(episode.get("durationSeconds"))
    if duration_seconds is None or duration_seconds < SNIPPET_WINDOW_SECONDS:
        return

    max_start_seconds = duration_seconds - SNIPPET_WINDOW_SECONDS
    if max_start_seconds <= 0:
        start_seconds = 0
    else:
        seed = str(card.get("id") or episode.get("id") or "")
        start_seconds = _stable_u32(seed) % (max_start_seconds + 1)

    highlight["snippet"] = {
        "startMs": start_seconds * 1000,
        "durationMs": SNIPPET_WINDOW_SECONDS * 1000,
    }


def _strip_episodes(card: dict[str, Any]) -> dict[str, Any]:
    if "episodes" not in card:
        return card
    return {k: v for (k, v) in card.items() if k != "episodes"}


@dataclass(frozen=True)
class CardsDataset:
    cards: list[dict[str, Any]]
    deck_cards: list[dict[str, Any]]
    by_id: dict[str, dict[str, Any]]

    @classmethod
    def load_from_json(cls, path: Path) -> "CardsDataset":
        raw = json.loads(path.read_text("utf-8"))
        if not isinstance(raw, list):
            raise ValueError("cards dataset must be a JSON array")

        cards: list[dict[str, Any]] = []
        deck_cards: list[dict[str, Any]] = []
        by_id: dict[str, dict[str, Any]] = {}

        for item in raw:
            if not isinstance(item, dict):
                continue
            card_id = str(item.get("id", "")).strip()
            if not card_id:
                continue

            _maybe_inject_snippet(item)
            cards.append(item)
            by_id[card_id] = item
            deck_cards.append(_strip_episodes(item))

        return cls(cards=cards, deck_cards=deck_cards, by_id=by_id)


def resolve_repo_root_from_backend_app() -> Path:
    return Path(__file__).resolve().parents[2]


def load_default_cards_dataset() -> CardsDataset:
    repo_root = resolve_repo_root_from_backend_app()
    dataset_path = repo_root / "card_data.json"
    return CardsDataset.load_from_json(dataset_path)

