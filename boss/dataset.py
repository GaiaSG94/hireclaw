"""Small set of product reviews written for the occasion: positive, negative, neutral."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

CHOICES = ["positive", "negative", "neutral"]
DATA = Path(__file__).resolve().parent.parent / "data" / "reviews.json"


@dataclass(frozen=True)
class Item:
    id: str
    text: str
    gold: str | None = None
    choices: tuple[str, ...] = tuple(CHOICES)

    def to_dict(self, *, with_gold: bool = False) -> dict:
        data = {"id": self.id, "text": self.text, "choices": list(self.choices)}
        if with_gold:
            data["gold"] = self.gold
        return data


def load(path: Path | None = None) -> list[Item]:
    raw = json.loads((path or DATA).read_text(encoding="utf-8"))
    return [Item(id=r["id"], text=r["text"], gold=r["gold"]) for r in raw["items"]]