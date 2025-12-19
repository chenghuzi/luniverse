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


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


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
    def load_from_split_files(cls, deck_path: Path, details_dir: Path) -> "CardsDataset":
        deck_raw = _read_json(deck_path)
        if not isinstance(deck_raw, list):
            raise ValueError("deckCards.json must be a JSON array")

        deck_cards: list[dict[str, Any]] = []
        for item in deck_raw:
            if not isinstance(item, dict):
                continue
            card_id = str(item.get("id", "")).strip()
            if not card_id:
                continue
            _maybe_inject_snippet(item)
            deck_cards.append(item)

        by_id: dict[str, dict[str, Any]] = {}
        cards: list[dict[str, Any]] = []
        for path in sorted(details_dir.glob("*.json")):
            item = _read_json(path)
            if not isinstance(item, dict):
                continue
            card_id = str(item.get("id", "")).strip()
            if not card_id:
                continue
            _maybe_inject_snippet(item)
            by_id[card_id] = item
            cards.append(item)

        return cls(cards=cards, deck_cards=deck_cards, by_id=by_id)


def resolve_backend_root_from_backend_app() -> Path:
    return Path(__file__).resolve().parents[1]


def load_default_cards_dataset() -> CardsDataset:
    backend_root = resolve_backend_root_from_backend_app()
    data_dir = backend_root / "data"
    return CardsDataset.load_from_split_files(data_dir / "deckCards.json", data_dir / "details")
