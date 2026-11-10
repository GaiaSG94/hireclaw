"""Erreurs explicites : chaque refus du contrat porte un code stable, public."""
from __future__ import annotations


class PatronError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}" if detail else code)

    def __str__(self) -> str:  # pragma: no cover - confort d'affichage
        return self.code if not self.detail else f"{self.code} ({self.detail})"


CODES = (
    "ERR_PAUSED",
    "ERR_NOT_AGENT",
    "ERR_PAY_BELOW_MIN",
    "ERR_PAY_ABOVE_MAX",
    "ERR_PAYROLL_BUDGET",
    "ERR_DAILY_CAP",
    "ERR_WORKER_CAP",
    "ERR_ALREADY_SETTLED",
    "ERR_WORKER_FIRED",
    "ERR_NOT_HIRED",
    "ERR_FIRE_NOT_JUSTIFIED",
    "ERR_NOT_DELIVERABLE",
    "ERR_GOLD_MISMATCH",
    "ERR_ALREADY_ACCEPTED",
    "ERR_ALREADY_HIRED",
    "ERR_FORBIDDEN_WORKER",
    "ERR_INFERENCE_CAP",
    "ERR_NOT_DUE",
    "ERR_ALREADY_DELIVERED",
    "ERR_UNKNOWN_JOB",
    "ERR_UNKNOWN_WORKER",
    "ERR_INSUFFICIENT",
    "ERR_BAD_SIGNATURE",
    "ERR_BAD_ORDER",
    "ERR_UNKNOWN_TASK",
)