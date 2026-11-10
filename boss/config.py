"""Les règles du propriétaire (config.yaml), validées avant tout déploiement."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .money import usdc


@dataclass(frozen=True)
class Rules:
    task_pay_min: int = usdc("0.02")
    task_pay_max: int = usdc("0.10")
    payroll_cap_per_day: int = usdc(20)
    worker_cap_per_day: int = usdc(2)
    min_margin_pct: int = 15
    redundancy: int = 3
    gold_share_pct: int = 20
    min_golds_before_fire: int = 5
    fire_below_accuracy_pct: int = 60
    pay_or_reject_seconds: int = 120
    inference_max_spend_per_day: int = usdc("0.50")
    revenue_split: tuple[int, int, int] = (60, 30, 10)
    kill_switch: bool = False

    def validate(self) -> "Rules":
        if self.task_pay_min <= 0:
            raise ValueError("task_pay_usdc.min doit être > 0")
        if self.task_pay_min > self.task_pay_max:
            raise ValueError("plancher au-dessus du plafond")
        if not 0 <= self.min_margin_pct < 100:
            raise ValueError("min_margin_pct hors [0, 100)")
        if self.redundancy < 3:
            raise ValueError("la majorité demande au moins 3 réponses")
        if not 0 <= self.gold_share_pct <= 100:
            raise ValueError("gold_share_pct hors [0, 100]")
        if sum(self.revenue_split) != 100:
            raise ValueError("revenue_split doit sommer à 100")
        if self.min_golds_before_fire < 1:
            raise ValueError("min_golds_before_fire >= 1")
        return self

    @classmethod
    def from_mapping(cls, raw: dict) -> "Rules":
        pay = raw.get("task_pay_usdc", {})
        return cls(
            task_pay_min=usdc(pay.get("min", "0.02")),
            task_pay_max=usdc(pay.get("max", "0.10")),
            payroll_cap_per_day=usdc(raw.get("payroll_cap_usdc_per_day", 20)),
            worker_cap_per_day=usdc(raw.get("worker_cap_usdc_per_day", 2)),
            min_margin_pct=int(raw.get("min_margin_pct", 15)),
            redundancy=int(raw.get("redundancy", 3)),
            gold_share_pct=int(raw.get("gold_share_pct", 20)),
            min_golds_before_fire=int(raw.get("min_golds_before_fire", 5)),
            fire_below_accuracy_pct=int(raw.get("fire_below_accuracy_pct", 60)),
            pay_or_reject_seconds=int(raw.get("pay_or_reject_seconds", 120)),
            inference_max_spend_per_day=usdc(raw.get("inference_max_spend_usdc_per_day", "0.50")),
            revenue_split=tuple(raw.get("revenue_split", [60, 30, 10])),
            kill_switch=bool(raw.get("kill_switch", False)),
        ).validate()

    @classmethod
    def load(cls, path: str | Path) -> "Rules":
        with open(path, encoding="utf-8") as fh:
            return cls.from_mapping(yaml.safe_load(fh) or {})