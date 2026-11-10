"""État du monde : commandes, travailleurs, registre. Aucune logique métier ici."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

TRIAL, ACTIVE, SENIOR, FIRED = "Trial", "Active", "Senior", "Fired"


@dataclass
class Job:
    id: str
    client: str
    budget: int
    n_items: int
    deadline_ms: int
    spec_hash: str = ""
    created_ms: int = 0
    state: str = "ordered"  # ordered | accepted | delivered | refunded
    pay_per_task: int = 0
    margin_reserved: int = 0
    payroll_budget: int = 0
    payroll_spent: int = 0
    gold_commit: str = ""
    gold_reveal: dict[str, str] | None = None
    result_hash: str = ""
    n_validated: int = 0
    delivered_ms: int | None = None
    inference_spent: int = 0

    @property
    def open(self) -> bool:
        return self.state in ("ordered", "accepted")

    @property
    def payroll_left(self) -> int:
        return self.payroll_budget - self.payroll_spent

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Worker:
    account: str
    status: str = TRIAL
    tasks_paid: int = 0
    tasks_rejected: int = 0
    gold_ok: int = 0
    gold_ko: int = 0
    earned_total: int = 0
    earned_today: int = 0
    hired_ms: int = 0
    fired_ms: int | None = None

    @property
    def golds(self) -> int:
        return self.gold_ok + self.gold_ko

    @property
    def accuracy_pct(self) -> int:
        return (self.gold_ok * 100 // self.golds) if self.golds else 0

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["golds"] = self.golds
        data["accuracy_pct"] = self.accuracy_pct
        return data


@dataclass
class Entry:
    seq: int
    at_ms: int
    kind: str
    actor: str
    job: str = ""
    amount: int = 0
    detail: str = ""
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Buckets:
    owner: int = 0
    reserve: int = 0
    contributors: int = 0

    def to_dict(self) -> dict[str, int]:
        return asdict(self)

    def add(self, owner: int, reserve: int, contributors: int) -> None:
        self.owner += owner
        self.reserve += reserve
        self.contributors += contributors

    @property
    def total(self) -> int:
        return self.owner + self.reserve + self.contributors