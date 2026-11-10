"""L'agent-patron : sert les tâches, juge, paie, embauche, renvoie, livre."""
from __future__ import annotations

from typing import Any, Iterable

from .config import Rules
from .contract import Contract
from .hashing import sha256_hex
from .keys import answer_payload, verify
from .model import FIRED
from .quality import Decision, QualityEngine, Task
from .ticket import Ticket, issue

INFERENCE_COST_PER_CHECK = 800  # 0,0008 USDC par contrôle automatique


class BossAgent:
    def __init__(self, contract: Contract, items: Iterable, gold_ids: set[str], rng: Any,
                 inference_provider: str = "inf-check-01", key=None) -> None:
        self.key = key
        self.contract = contract
        self.items = list(items)
        self.item_ids = [i.id for i in self.items if i.id not in gold_ids]
        self.gold_ids = set(gold_ids)
        self.golds = {i.id: i.gold for i in self.items if i.id in gold_ids}
        self.engine = QualityEngine(self.items, contract.rules, rng, self.gold_ids)
        self.inference_provider = inference_provider
        self.payments = 0
        self.rejections = 0

    # ------------------------------------------------------------------ gestion
    def accept(self, job_id: str, pay_per_task: int | None = None) -> None:
        pay = pay_per_task if pay_per_task is not None else self.contract.rules.task_pay_min
        self.contract.accept_job(job_id, pay, sha256_hex(self.golds))

    def onboard(self, key) -> None:
        self.contract.hire(key.account)
        self.contract.pubkeys[key.account] = key.pub_hex

    def can_hire(self, job_id: str | None = None) -> bool:
        job = self.contract.jobs.get(job_id or "")
        if job is None:
            return True
        return job.payroll_left > job.budget * 5 // 100

    # ------------------------------------------------------------------ service
    def serve(self, worker: str) -> Task | None:
        record = self.contract.workers.get(worker)
        if record is None or record.status == FIRED:
            return None
        return self.engine.serve(worker, self.contract.now_ms(), allow_gold=self.gold_budget_ok())

    def gold_budget_ok(self) -> bool:
        """Gestion de trésorerie : on garde 20 % du budget de paie pour finir les éléments."""
        job = self.contract.jobs.get(self.first_job())
        if job is None:
            return True
        return job.payroll_left > job.payroll_budget * 20 // 100

    def card(self, task: Task) -> dict:
        card = self.engine.card(task, self.contract.rules.pay_or_reject_seconds)
        card["pay_usdc"] = self.contract.jobs[next(iter(self.contract.jobs))].pay_per_task \
            if self.contract.jobs else 0
        return card

    # ------------------------------------------------------------------ réponses
    def submit(self, worker: str, task_id: str, choice: str, latency_ms: int, signature: str,
               job_id: str | None = None) -> dict:
        payload = answer_payload(worker, task_id, choice, latency_ms)
        signature_ok = verify(self.contract.pubkeys.get(worker, ""), payload, signature)
        decisions = self.engine.submit(worker, task_id, choice, latency_ms, signature_ok)
        settled = self.settle(job_id or self.first_job(), decisions)
        return {"decisions": settled, "labels": len(self.engine.labels)}

    def settle(self, job_id: str, decisions: list[Decision]) -> list[dict]:
        paid = [d for d in decisions if d.action == "pay"]
        refused = [d for d in decisions if d.action == "reject"]
        out: list[dict] = []
        for chunk_start in range(0, len(paid), 10):
            chunk = paid[chunk_start:chunk_start + 10]
            total = self.contract.pay_batch(job_id, [
                {"task_id": d.task_id, "worker": d.worker, "gold": d.gold} for d in chunk
            ])
            self.payments += len(chunk)
            out.append({"action": "pay", "n": len(chunk), "total": total})
        for decision in refused:
            self.contract.reject(job_id, decision.task_id, decision.worker, decision.reason,
                                 gold=decision.gold)
            self.rejections += 1
            out.append({"action": "reject", "task": decision.task_id, "reason": decision.reason})
        if decisions:
            self.contract.record_cost(self.inference_provider,
                                      INFERENCE_COST_PER_CHECK * len(decisions),
                                      job_id=job_id, actor=self.contract.agent)
        return out

    def issue_ticket(self, job_id: str, task_id: str, worker: str, reason: str = "non payée à temps") -> Ticket:
        """Bon de travail signé : si le patron se tait, le travailleur peut réclamer."""
        job = self.contract.jobs[job_id]
        return issue(self.key, job_id, task_id, worker, job.pay_per_task, reason,
                     self.contract.now_ms())

    def first_job(self) -> str:
        return next(iter(self.contract.jobs))

    # ------------------------------------------------------------------- renvois
    def manage(self) -> list[str]:
        events: list[str] = []
        for account, record in list(self.contract.workers.items()):
            if record.status == FIRED:
                continue
            self.contract.promote(account)
            if record.golds >= self.contract.rules.min_golds_before_fire and \
                    record.accuracy_pct < self.contract.rules.fire_below_accuracy_pct:
                self.contract.fire(account)
                events.append(f"renvoi {account[:8]} ({record.accuracy_pct}% sur {record.golds} contrôles)")
        return events

    # ----------------------------------------------------------------- livraison
    def deliver(self, job_id: str) -> dict:
        job = self.contract.jobs[job_id]
        result = {iid: label for iid, label in self.engine.validated.items() if iid in self.item_ids}
        if len(result) < job.n_items:
            raise RuntimeError(f"livraison incomplète : {len(result)}/{job.n_items}")
        self.contract.deliver(job_id, sha256_hex(result), len(result), self.golds)
        return result

    # ------------------------------------------------------------------- lecture
    def gold_table(self) -> dict[str, dict[str, int]]:
        return {w.account: {"ok": w.gold_ok, "ko": w.gold_ko, "accuracy": w.accuracy_pct}
                for w in self.contract.workers.values()}