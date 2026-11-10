"""b — Hireclaw, un agent-patron dont le code du travail est dans le contrat."""
from .agent import BossAgent
from .config import Rules
from .contract import Contract
from .errors import PatronError
from .keys import Key, verify
from .quality import QualityEngine

__all__ = ["BossAgent", "Contract", "PatronError", "QualityEngine", "Rules", "Key", "verify"]