"""Canonical hashes: same bytes here, in the contract and in the browser."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_hex(obj: Any) -> str:
    return hashlib.sha256(canonical(obj)).hexdigest()


def short(hex_digest: str, n: int = 12) -> str:
    return hex_digest[:n]