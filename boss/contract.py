"""The contract: it bounds the money and makes everything public. It never judges an answer."""
from __future__ import annotations

import time
from typing import Callable, Iterable, Sequence

from .config import Rules
from .errors import PatronError
from .hashing import sha256_hex
from .money import fmt, pct_of
from .model import ACTIVE, FIRED, SENIOR, TRIAL, Buckets, Entry, Job, Worker
from . import views
from .ticket import Ticket, check as ticket_ok
from .withdrawal import Withdrawal, check as withdrawal_ok

DAY_MS = 86_400_000
REGISTRATION_FEE_NEAR = 1_250_000_000_000_000_000_000  # 0.00125 N per token registration


class Contract:
    """Single contract account: locked budgets, bounded payroll, public ledger."""

    def __init__(
        self,
        rules: Rules,
        owner: str,
        agent: str,
        *,
        clock: Callable[[], int] | None = None,
        near_balance: int = REGISTRATION_FEE_NEAR * 40,
        pubkeys: dict[str, str] | None = None,
        agent_pubkey: str = "",
    ) -> None:
        self.rules = rules.validate()
        self.owner = owner
        self.agent = agent
        self._clock = clock or (lambda: int(time.time() * 1000))
        self.paused = rules.kill_switch
        self.balance = 0
        self.near_balance = near_balance
        self.balances: dict[str, int] = {}
        self.withdrawable: dict[str, int] = {}
        self.buckets = Buckets()
        self.jobs: dict[str, Job] = {}
        self.workers: dict[str, Worker] = {}
        self.settled: set[tuple[str, str, str]] = set()
        self.ledger: list[Entry] = []
        self.daily = {"day": self._day(), "payroll": 0, "inference": 0}
        self.pubkeys = pubkeys if pubkeys is not None else {}
        self.agent_pubkey = agent_pubkey
        self.claimed: set[str] = set()
        self.pending_out: dict[str, int] = {}
        self._seq = 0

    # ------------------------------------------------------------------ time
    def now_ms(self) -> int:
        return self._clock()

    def _day(self) -> int:
        return self.now_ms() // DAY_MS

    def _roll_day(self) -> None:
        today = self._day()
        if today != self.daily["day"]:
            self.daily = {"day": today, "payroll": 0, "inference": 0}
            for worker in self.workers.values():
                worker.earned_today = 0

    # --------------------------------------------------------------- ledger
    def _log(self, kind: str, actor: str, **fields) -> Entry:
        self._seq += 1
        entry = Entry(seq=self._seq, at_ms=self.now_ms(), kind=kind, actor=actor, **fields)
        self.ledger.append(entry)
        return entry

    def record_decision(self, actor: str, kind: str, reason: str, job: str = "") -> None:
        self._log("decision", actor, job=job, detail=kind, reason=reason)

    # ---------------------------------------------------------------- guards
    def _require_agent(self, actor: str) -> None:
        if actor != self.agent:
            raise PatronError("ERR_NOT_AGENT", actor)

    def _require_active(self) -> None:
        if self.paused:
            raise PatronError("ERR_PAUSED")

    def _job(self, job_id: str) -> Job:
        job = self.jobs.get(job_id)
        if job is None:
            raise PatronError("ERR_UNKNOWN_JOB", job_id)
        return job

    def _worker(self, account: str) -> Worker:
        worker = self.workers.get(account)
        if worker is None:
            raise PatronError("ERR_NOT_HIRED", account)
        return worker

    # ------------------------------------------------------------------ money
    def deposit(self, account: str, amount: int) -> None:
        """Simulates the client's off-chain wallet (USDC already owned)."""
        if amount <= 0:
            raise PatronError("ERR_BAD_ORDER", "deposit <= 0")
        self.balances[account] = self.balances.get(account, 0) + amount

    def order(self, client: str, amount: int, *, n_items: int, deadline_ms: int, spec_hash: str) -> str:
        """ft_transfer_call, `order` action: the token credits the contract, the budget is locked."""
        self._require_active()
        if n_items <= 0 or amount <= 0:
            raise PatronError("ERR_BAD_ORDER", "invalid n_items or amount")
        if deadline_ms <= self.now_ms():
            raise PatronError("ERR_BAD_ORDER", "deadline already passed")
        if self.balances.get(client, 0) < amount:
            raise PatronError("ERR_INSUFFICIENT", client)
        self.balances[client] -= amount
        self.balance += amount
        job_id = f"job-{len(self.jobs) + 1:04d}"
        self.jobs[job_id] = Job(
            id=job_id,
            client=client,
            budget=amount,
            n_items=n_items,
            deadline_ms=deadline_ms,
            spec_hash=spec_hash,
            created_ms=self.now_ms(),
        )
        self._log("order", client, job=job_id, amount=amount, detail=f"{n_items} items")
        return job_id

    def ft_on_transfer(self, sender: str, amount: int, msg: dict) -> str:
        """NEP-141 entry point: the token calls the contract."""
        if msg.get("action") != "order":
            raise PatronError("ERR_BAD_ORDER", f"unknown action: {msg.get('action')}")
        return self.order(
            sender,
            amount,
            n_items=int(msg.get("n_items", 0)),
            deadline_ms=int(msg.get("deadline_ms", 0)),
            spec_hash=str(msg.get("spec_hash", "")),
        )

    def accept_job(self, job_id: str, pay_per_task: int, gold_commit: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        job = self._job(job_id)
        if job.state != "ordered":
            raise PatronError("ERR_ALREADY_ACCEPTED", job.state)
        self._check_bounds(pay_per_task)
        margin = pct_of(job.budget, self.rules.min_margin_pct)
        payroll = job.budget - margin
        if payroll < pay_per_task:
            raise PatronError("ERR_PAYROLL_BUDGET", "payroll budget too small for a single task")
        if not gold_commit:
            raise PatronError("ERR_BAD_ORDER", "missing commitment on the hidden checks")
        job.pay_per_task = pay_per_task
        job.margin_reserved = margin
        job.payroll_budget = payroll
        job.gold_commit = gold_commit
        job.state = "accepted"
        self._log(
            "accept", actor, job=job_id, amount=job.budget,
            detail=f"rate {fmt(pay_per_task)}; margin {fmt(margin)}; payroll {fmt(payroll)}",
        )
        self.record_decision(actor, "rate", f"set to {fmt(pay_per_task)} USDC/task, within bounds", job_id)

    def _check_bounds(self, pay: int) -> None:
        if pay < self.rules.task_pay_min:
            raise PatronError("ERR_PAY_BELOW_MIN", f"{fmt(pay)} < {fmt(self.rules.task_pay_min)}")
        if pay > self.rules.task_pay_max:
            raise PatronError("ERR_PAY_ABOVE_MAX", f"{fmt(pay)} > {fmt(self.rules.task_pay_max)}")

    # ----------------------------------------------------------------- hiring
    def hire(self, worker: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        if worker in (self.agent, self.owner):
            raise PatronError("ERR_FORBIDDEN_WORKER", "agent or owner account")
        if worker in self.workers:
            raise PatronError("ERR_ALREADY_HIRED", worker)
        if self.near_balance < REGISTRATION_FEE_NEAR:
            raise PatronError("ERR_INSUFFICIENT", "NEAR registration fee")
        self.near_balance -= REGISTRATION_FEE_NEAR
        self.workers[worker] = Worker(account=worker, status=TRIAL, hired_ms=self.now_ms())
        self._log("hire", actor, detail=worker, amount=0, reason="token registration paid by the contract")

    # --------------------------------------------------------------------- payroll
    def _norm(self, item) -> tuple[str, str, bool]:
        if isinstance(item, dict):
            return str(item["task_id"]), str(item["worker"]), bool(item.get("gold", False))
        task_id, worker = item[0], item[1]
        gold = bool(item[2]) if len(item) > 2 else False
        return str(task_id), str(worker), gold

    def pay_batch(self, job_id: str, items: Sequence, *, amount: int | None = None, actor: str | None = None) -> int:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        job = self._job(job_id)
        if job.state != "accepted":
            raise PatronError("ERR_PAYROLL_BUDGET", f"order {job.state}")
        pay = job.pay_per_task if amount is None else amount
        batch = [self._norm(i) for i in items]
        if not batch or len(batch) > 10:
            raise PatronError("ERR_BAD_ORDER", "a batch holds 1 to 10 tasks")
        self._check_bounds(pay)
        self._roll_day()
        keys: set[tuple[str, str, str]] = set()
        total = 0
        for task_id, worker, _ in batch:
            key = (job_id, task_id, worker)
            if key in keys or key in self.settled:
                raise PatronError("ERR_ALREADY_SETTLED", f"{task_id}/{worker[:8]}")
            w = self._worker(worker)
            if w.status == FIRED:
                raise PatronError("ERR_WORKER_FIRED", worker)
            if job.payroll_spent + total + pay > job.payroll_budget:
                raise PatronError("ERR_PAYROLL_BUDGET", f"{fmt(job.payroll_left - total)} left")
            if self.daily["payroll"] + total + pay > self.rules.payroll_cap_per_day:
                raise PatronError("ERR_DAILY_CAP", "daily payroll cap")
            if w.earned_today + pay > self.rules.worker_cap_per_day:
                raise PatronError("ERR_WORKER_CAP", worker)
            keys.add(key)
            total += pay
        for task_id, worker, gold in batch:
            self.settled.add((job_id, task_id, worker))
            w = self.workers[worker]
            w.tasks_paid += 1
            w.earned_total += pay
            w.earned_today += pay
            w.gold_ok += 1 if gold else 0
            self.withdrawable[worker] = self.withdrawable.get(worker, 0) + pay
        job.payroll_spent += total
        self.daily["payroll"] += total
        self._log("payroll", actor, job=job_id, amount=total, detail=f"{len(batch)} task(s) at {fmt(pay)}")
        return total

    def reject(self, job_id: str, task_id: str, worker: str, reason: str, *, gold: bool = False,
               actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        self._job(job_id)
        w = self._worker(worker)
        key = (job_id, task_id, worker)
        if key in self.settled:
            raise PatronError("ERR_ALREADY_SETTLED", f"{task_id}/{worker[:8]}")
        self.settled.add(key)
        w.tasks_rejected += 1
        w.gold_ko += 1 if gold else 0
        self._log("reject", actor, job=job_id, amount=0, detail=f"{task_id} / {worker[:8]}", reason=reason)
        self.record_decision(actor, "rejection", f"{reason} ({task_id})", job_id)

    def fire(self, worker: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        w = self._worker(worker)
        if w.status == FIRED:
            raise PatronError("ERR_FIRE_NOT_JUSTIFIED", "already fired")
        if w.golds < self.rules.min_golds_before_fire:
            raise PatronError("ERR_FIRE_NOT_JUSTIFIED", f"{w.golds} hidden check(s) < {self.rules.min_golds_before_fire}")
        if w.accuracy_pct >= self.rules.fire_below_accuracy_pct:
            raise PatronError("ERR_FIRE_NOT_JUSTIFIED", f"accuracy {w.accuracy_pct}%")
        w.status = FIRED
        w.fired_ms = self.now_ms()
        self._log("fire", actor, detail=worker, reason=f"{w.accuracy_pct}% on {w.golds} hidden checks")
        self.record_decision(actor, "firing", f"{worker[:8]}: {w.accuracy_pct}% on {w.golds} hidden checks")

    def promote(self, worker: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        w = self._worker(worker)
        if w.status == TRIAL and w.golds >= 2 and w.accuracy_pct >= 80:
            w.status = ACTIVE
            self.record_decision(actor, "hiring", f"{worker[:8]} becomes active (paid trial passed)")
        elif w.status == ACTIVE and w.golds >= 20 and w.accuracy_pct >= 95:
            w.status = SENIOR
            self.record_decision(actor, "promotion", f"{worker[:8]} senior at {w.accuracy_pct}% on {w.golds} hidden checks")

    # ---------------------------------------------------------------- delivery
    def deliver(self, job_id: str, result_hash: str, n_validated: int, gold_reveal: dict[str, str],
                *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        job = self._job(job_id)
        if job.state != "accepted" or n_validated < job.n_items:
            raise PatronError("ERR_NOT_DELIVERABLE", f"{n_validated}/{job.n_items} validated, state {job.state}")
        if sha256_hex(gold_reveal) != job.gold_commit:
            raise PatronError("ERR_GOLD_MISMATCH", "the reveal does not match the commitment")
        margin_total = job.margin_reserved + job.payroll_left
        owner, reserve, contributors = self._split(margin_total)
        self.buckets.add(owner, reserve, contributors)
        job.margin_reserved = 0
        job.payroll_budget = job.payroll_spent
        job.state = "delivered"
        job.gold_reveal = gold_reveal
        job.result_hash = result_hash
        job.n_validated = n_validated
        job.delivered_ms = self.now_ms()
        self._log("sale", actor, job=job_id, amount=job.budget,
                  detail=f"{n_validated} items, hash {result_hash[:16]}")
        self._log("margin", actor, job=job_id, amount=margin_total,
                  detail=f"owner {fmt(owner)} / reserve {fmt(reserve)} / contributors {fmt(contributors)}")
        self.record_decision(actor, "delivery", f"margin {fmt(margin_total)} USDC split", job_id)

    def _split(self, total: int) -> tuple[int, int, int]:
        owner_pct, reserve_pct, contrib_pct = self.rules.revenue_split
        owner = pct_of(total, owner_pct, round_up=False)
        reserve = pct_of(total, reserve_pct, round_up=False)
        return owner, reserve, total - owner - reserve

    def refund(self, job_id: str, *, actor: str | None = None) -> int:
        job = self._job(job_id)
        actor = actor or job.client
        if actor != job.client:
            raise PatronError("ERR_NOT_AGENT", "only the client can refund")
        if job.state == "delivered":
            raise PatronError("ERR_ALREADY_DELIVERED", job_id)
        if not job.open:
            raise PatronError("ERR_ALREADY_DELIVERED", f"order {job.state}")
        if self.now_ms() < job.deadline_ms:
            raise PatronError("ERR_NOT_DUE", "deadline not reached")
        amount = job.budget - job.payroll_spent
        self.balance -= amount
        self.balances[job.client] = self.balances.get(job.client, 0) + amount
        job.margin_reserved = 0
        job.payroll_budget = job.payroll_spent
        job.state = "refunded"
        self._log("refund", actor, job=job_id, amount=amount, detail="unspent budget returned")
        return amount

    # ------------------------------------------------------------------- costs
    def record_cost(self, provider: str, amount: int, *, job_id: str | None = None,
                    actor: str | None = None) -> None:
        """Inference is paid out of the order's margin, never out of payroll."""
        actor = actor or self.agent
        self._require_agent(actor)
        self._roll_day()
        if amount <= 0:
            raise PatronError("ERR_BAD_ORDER", "cost <= 0")
        if self.daily["inference"] + amount > self.rules.inference_max_spend_per_day:
            raise PatronError("ERR_INFERENCE_CAP", "daily inference cap")
        if job_id is not None:
            job = self._job(job_id)
            if job.margin_reserved < amount:
                raise PatronError("ERR_INFERENCE_CAP", "order margin exhausted")
            job.margin_reserved -= amount
            job.inference_spent += amount
        self.daily["inference"] += amount
        self.withdrawable[provider] = self.withdrawable.get(provider, 0) + amount
        self._log("cost", actor, job=job_id or "", amount=amount, detail=f"inference for {provider}")

    def withdraw(self, account: str, amount: int) -> None:
        available = self.withdrawable.get(account, 0)
        if amount <= 0 or amount > available:
            raise PatronError("ERR_INSUFFICIENT", f"{fmt(available)} available")
        if self.balance < amount:
            raise PatronError("ERR_INSUFFICIENT", "contract balance")
        self.withdrawable[account] = available - amount
        self.balance -= amount
        self._log("withdraw", account, amount=amount, detail="payout")

    def claim_unpaid(self, ticket: Ticket, *, actor: str | None = None) -> int:
        """The worker claims a task the boss did not settle in time.

        Three guards: the agent's signature, the elapsed delay, and the fact that
        the task is not already settled. The order's payroll cap still applies
        anyway: a ticket cannot create money.
        """
        actor = actor or ticket.worker
        if actor != ticket.worker:
            raise PatronError("ERR_NOT_AGENT", "only the recipient can claim their ticket")
        if not self.agent_pubkey or not ticket_ok(ticket, self.agent_pubkey):
            raise PatronError("ERR_BAD_SIGNATURE", "invalid work ticket")
        if ticket.digest in self.claimed:
            raise PatronError("ERR_ALREADY_SETTLED", "ticket already claimed")
        if self.now_ms() < ticket.issued_ms + self.rules.pay_or_reject_seconds * 1000:
            raise PatronError("ERR_NOT_DUE", "pay-or-reject delay not elapsed")
        job = self._job(ticket.job_id)
        key = (job.id, ticket.task_id, ticket.worker)
        if key in self.settled:
            raise PatronError("ERR_ALREADY_SETTLED", "task already settled by the boss")
        self._check_bounds(ticket.amount)
        self._roll_day()
        worker = self._worker(ticket.worker)
        if worker.status == FIRED:
            raise PatronError("ERR_WORKER_FIRED", ticket.worker)
        if job.payroll_spent + ticket.amount > job.payroll_budget:
            raise PatronError("ERR_PAYROLL_BUDGET", f"{fmt(job.payroll_left)} left")
        if self.daily["payroll"] + ticket.amount > self.rules.payroll_cap_per_day:
            raise PatronError("ERR_DAILY_CAP", "daily payroll cap")
        if worker.earned_today + ticket.amount > self.rules.worker_cap_per_day:
            raise PatronError("ERR_WORKER_CAP", ticket.worker)
        self.settled.add(key)
        self.claimed.add(ticket.digest)
        worker.tasks_paid += 1
        worker.earned_total += ticket.amount
        worker.earned_today += ticket.amount
        job.payroll_spent += ticket.amount
        self.daily["payroll"] += ticket.amount
        self.credit_withdrawable(ticket.worker, ticket.amount)
        self._log("claim", actor, job=job.id, amount=ticket.amount,
                  detail=f"{ticket.task_id} — silence meant payment", reason=ticket.reason)
        return ticket.amount

    def credit_withdrawable(self, account: str, amount: int) -> None:
        self.withdrawable[account] = self.withdrawable.get(account, 0) + amount

    def apply_relayed_withdrawal(self, order: Withdrawal, *, relayer: str) -> int:
        """Withdrawal signed by the worker, submitted by a relay (the site, the agent…).

        The recipient and the amount are frozen by the signature: a relay can
        neither pay itself instead of the worker nor inflate the amount. The nonce prevents
        replay, the deadline bounds the order's validity.
        """
        if not withdrawal_ok(order):
            raise PatronError("ERR_BAD_SIGNATURE", order.worker)
        key = f"{order.worker}#{order.nonce}"
        if key in self.claimed:
            raise PatronError("ERR_ALREADY_SETTLED", "order already executed")
        available = self.withdrawable.get(order.worker, 0)
        if order.amount <= 0 or order.amount > available:
            raise PatronError("ERR_INSUFFICIENT", f"{fmt(available)} available")
        self.claimed.add(key)
        self.withdrawable[order.worker] = available - order.amount
        self.pending_out[order.worker] = self.pending_out.get(order.worker, 0) + order.amount
        self._log("withdraw_signed", order.worker, amount=order.amount,
                  detail=f"relayed by {relayer}", reason="signed order")
        return order.amount

    def settle_payout(self, worker: str, amount: int) -> None:
        """The token confirms the transfer: the money leaves the contract's custody."""
        self.pending_out[worker] = max(0, self.pending_out.get(worker, 0) - amount)
        self.balance -= amount
        self._log("paid", worker, amount=amount, detail="transfer confirmed")

    # ------------------------------------------------------------------ pause
    def pause(self, reason: str = "kill switch", *, actor: str | None = None) -> None:
        actor = actor or self.owner
        if actor not in (self.owner, self.agent):
            raise PatronError("ERR_NOT_AGENT", actor)
        self.paused = True
        self._log("pause", actor, reason=reason)

    def resume(self, *, actor: str | None = None) -> None:
        actor = actor or self.owner
        if actor not in (self.owner, self.agent):
            raise PatronError("ERR_NOT_AGENT", actor)
        self.paused = False
        self._log("resume", actor, detail="resumed: pending tasks get paid")

    # ------------------------------------------------------------------ reads
    # (implemented in boss/views.py to stay under 500 lines per file)
    def get_job(self, job_id: str) -> dict:
        return views.get_job(self, job_id)

    def get_worker(self, account: str) -> dict:
        return views.get_worker(self, account)

    def get_ledger(self, limit: int = 50, kind: str | None = None) -> list[dict]:
        return views.get_ledger(self, limit, kind)

    def get_solvency(self) -> dict:
        return views.get_solvency(self)

    def workers_table(self) -> list[dict]:
        return views.workers_table(self)

    def check_invariants(self) -> list[str]:
        return views.check_invariants(self)
