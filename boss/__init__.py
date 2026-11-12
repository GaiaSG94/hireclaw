"""boss — Hireclaw, a boss agent whose labor code lives in the contract."""
import sys

# Windows consoles default to cp1252 and crash on the arrows the demo prints.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass

from .agent import BossAgent
from .config import Rules
from .contract import Contract
from .errors import PatronError
from .keys import Key, verify
from .quality import QualityEngine

__all__ = ["BossAgent", "Contract", "PatronError", "QualityEngine", "Rules", "Key", "verify"]