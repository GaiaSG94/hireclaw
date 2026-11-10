"""Le contrat : il borne l'argent et rend tout public. Il ne juge jamais une réponse."""
from __future__ import annotations

import time
from typing import Callable, Iterable, Sequence

from .config import Rules
from .errors import PatronError
from .hashing import sha256_hex
from .money import fmt, pct_of
from .model import ACTIVE, FIRED, SENIOR, TRIAL, Buckets, Entry, Job, Worker
from .ticket import Ticket, check as ticket_ok

DAY_MS = 86_400_000
REGISTRATION_FEE_NEAR = 1_250_000_000_000_000_000_000  # 0,00125 N par inscription au jeton


class Contract:
    """Compte de contrat unique : budgets bloqués, paie bornée, registre public."""

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
        self._seq = 0

    # ------------------------------------------------------------------ temps
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

    # --------------------------------------------------------------- registre
    def _log(self, kind: str, actor: str, **fields) -> Entry:
        self._seq += 1
        entry = Entry(seq=self._seq, at_ms=self.now_ms(), kind=kind, actor=actor, **fields)
        self.ledger.append(entry)
        return entry

    def record_decision(self, actor: str, kind: str, reason: str, job: str = "") -> None:
        self._log("decision", actor, job=job, detail=kind, reason=reason)

    # ---------------------------------------------------------------- garde-fous
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

    # ------------------------------------------------------------------ argent
    def deposit(self, account: str, amount: int) -> None:
        """Simule le portefeuille hors chaîne du client (USDC déjà possédés)."""
        if amount <= 0:
            raise PatronError("ERR_BAD_ORDER", "dépôt <= 0")
        self.balances[account] = self.balances.get(account, 0) + amount

    def order(self, client: str, amount: int, *, n_items: int, deadline_ms: int, spec_hash: str) -> str:
        """ft_transfer_call, action `order` : le jeton crédite le contrat, le budget est bloqué."""
        self._require_active()
        if n_items <= 0 or amount <= 0:
            raise PatronError("ERR_BAD_ORDER", "n_items ou montant invalide")
        if deadline_ms <= self.now_ms():
            raise PatronError("ERR_BAD_ORDER", "échéance déjà passée")
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
        self._log("order", client, job=job_id, amount=amount, detail=f"{n_items} éléments")
        return job_id

    def ft_on_transfer(self, sender: str, amount: int, msg: dict) -> str:
        """Point d'entrée NEP-141 : le jeton appelle le contrat."""
        if msg.get("action") != "order":
            raise PatronError("ERR_BAD_ORDER", f"action inconnue : {msg.get('action')}")
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
            raise PatronError("ERR_PAYROLL_BUDGET", "budget de paie insuffisant pour une tâche")
        if not gold_commit:
            raise PatronError("ERR_BAD_ORDER", "engagement sur les contrôles manquant")
        job.pay_per_task = pay_per_task
        job.margin_reserved = margin
        job.payroll_budget = payroll
        job.gold_commit = gold_commit
        job.state = "accepted"
        self._log(
            "accept", actor, job=job_id, amount=job.budget,
            detail=f"tarif {fmt(pay_per_task)} ; marge {fmt(margin)} ; paie {fmt(payroll)}",
        )
        self.record_decision(actor, "tarif", f"fixé à {fmt(pay_per_task)} USDC/tâche, dans les bornes", job_id)

    def _check_bounds(self, pay: int) -> None:
        if pay < self.rules.task_pay_min:
            raise PatronError("ERR_PAY_BELOW_MIN", f"{fmt(pay)} < {fmt(self.rules.task_pay_min)}")
        if pay > self.rules.task_pay_max:
            raise PatronError("ERR_PAY_ABOVE_MAX", f"{fmt(pay)} > {fmt(self.rules.task_pay_max)}")

    # ----------------------------------------------------------------- embauche
    def hire(self, worker: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        if worker in (self.agent, self.owner):
            raise PatronError("ERR_FORBIDDEN_WORKER", "compte de l'agent ou du propriétaire")
        if worker in self.workers:
            raise PatronError("ERR_ALREADY_HIRED", worker)
        if self.near_balance < REGISTRATION_FEE_NEAR:
            raise PatronError("ERR_INSUFFICIENT", "frais d'inscription NEAR")
        self.near_balance -= REGISTRATION_FEE_NEAR
        self.workers[worker] = Worker(account=worker, status=TRIAL, hired_ms=self.now_ms())
        self._log("hire", actor, detail=worker, amount=0, reason="inscription au jeton payée par le contrat")

    # --------------------------------------------------------------------- paie
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
            raise PatronError("ERR_PAYROLL_BUDGET", f"commande {job.state}")
        pay = job.pay_per_task if amount is None else amount
        batch = [self._norm(i) for i in items]
        if not batch or len(batch) > 10:
            raise PatronError("ERR_BAD_ORDER", "un lot fait 1 à 10 tâches")
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
                raise PatronError("ERR_PAYROLL_BUDGET", f"reste {fmt(job.payroll_left - total)}")
            if self.daily["payroll"] + total + pay > self.rules.payroll_cap_per_day:
                raise PatronError("ERR_DAILY_CAP", "plafond de paie du jour")
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
        self._log("payroll", actor, job=job_id, amount=total, detail=f"{len(batch)} tâche(s) à {fmt(pay)}")
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
        self.record_decision(actor, "refus", f"{reason} ({task_id})", job_id)

    def fire(self, worker: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        self._require_active()
        w = self._worker(worker)
        if w.status == FIRED:
            raise PatronError("ERR_FIRE_NOT_JUSTIFIED", "déjà renvoyé")
        if w.golds < self.rules.min_golds_before_fire:
            raise PatronError("ERR_FIRE_NOT_JUSTIFIED", f"{w.golds} contrôle(s) < {self.rules.min_golds_before_fire}")
        if w.accuracy_pct >= self.rules.fire_below_accuracy_pct:
            raise PatronError("ERR_FIRE_NOT_JUSTIFIED", f"exactitude {w.accuracy_pct}%")
        w.status = FIRED
        w.fired_ms = self.now_ms()
        self._log("fire", actor, detail=worker, reason=f"{w.accuracy_pct}% sur {w.golds} contrôles")
        self.record_decision(actor, "renvoi", f"{worker[:8]} : {w.accuracy_pct}% sur {w.golds} contrôles")

    def promote(self, worker: str, *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        w = self._worker(worker)
        if w.status == TRIAL and w.golds >= 2 and w.accuracy_pct >= 80:
            w.status = ACTIVE
            self.record_decision(actor, "embauche", f"{worker[:8]} passe actif (essai payé réussi)")
        elif w.status == ACTIVE and w.golds >= 20 and w.accuracy_pct >= 95:
            w.status = SENIOR
            self.record_decision(actor, "promotion", f"{worker[:8]} senior à {w.accuracy_pct}% sur {w.golds} contrôles")

    # ---------------------------------------------------------------- livraison
    def deliver(self, job_id: str, result_hash: str, n_validated: int, gold_reveal: dict[str, str],
                *, actor: str | None = None) -> None:
        actor = actor or self.agent
        self._require_agent(actor)
        job = self._job(job_id)
        if job.state != "accepted" or n_validated < job.n_items:
            raise PatronError("ERR_NOT_DELIVERABLE", f"{n_validated}/{job.n_items} validés, état {job.state}")
        if sha256_hex(gold_reveal) != job.gold_commit:
            raise PatronError("ERR_GOLD_MISMATCH", "la révélation ne correspond pas à l'engagement")
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
                  detail=f"{n_validated} éléments, empreinte {result_hash[:16]}")
        self._log("margin", actor, job=job_id, amount=margin_total,
                  detail=f"propriétaire {fmt(owner)} / réserve {fmt(reserve)} / contributeurs {fmt(contributors)}")
        self.record_decision(actor, "livraison", f"marge {fmt(margin_total)} USDC ventilée", job_id)

    def _split(self, total: int) -> tuple[int, int, int]:
        owner_pct, reserve_pct, contrib_pct = self.rules.revenue_split
        owner = pct_of(total, owner_pct, round_up=False)
        reserve = pct_of(total, reserve_pct, round_up=False)
        return owner, reserve, total - owner - reserve

    def refund(self, job_id: str, *, actor: str | None = None) -> int:
        job = self._job(job_id)
        actor = actor or job.client
        if actor != job.client:
            raise PatronError("ERR_NOT_AGENT", "seul le client rembourse")
        if job.state == "delivered":
            raise PatronError("ERR_ALREADY_DELIVERED", job_id)
        if not job.open:
            raise PatronError("ERR_ALREADY_DELIVERED", f"commande {job.state}")
        if self.now_ms() < job.deadline_ms:
            raise PatronError("ERR_NOT_DUE", "échéance non passée")
        amount = job.budget - job.payroll_spent
        self.balance -= amount
        self.balances[job.client] = self.balances.get(job.client, 0) + amount
        job.margin_reserved = 0
        job.payroll_budget = job.payroll_spent
        job.state = "refunded"
        self._log("refund", actor, job=job_id, amount=amount, detail="budget non dépensé rendu")
        return amount

    # ------------------------------------------------------------------- coûts
    def record_cost(self, provider: str, amount: int, *, job_id: str | None = None,
                    actor: str | None = None) -> None:
        """L'inférence est payée sur la marge de la commande, jamais sur la paie."""
        actor = actor or self.agent
        self._require_agent(actor)
        self._roll_day()
        if amount <= 0:
            raise PatronError("ERR_BAD_ORDER", "coût <= 0")
        if self.daily["inference"] + amount > self.rules.inference_max_spend_per_day:
            raise PatronError("ERR_INFERENCE_CAP", "plafond d'inférence du jour")
        if job_id is not None:
            job = self._job(job_id)
            if job.margin_reserved < amount:
                raise PatronError("ERR_INFERENCE_CAP", "marge de la commande épuisée")
            job.margin_reserved -= amount
            job.inference_spent += amount
        self.daily["inference"] += amount
        self.withdrawable[provider] = self.withdrawable.get(provider, 0) + amount
        self._log("cost", actor, job=job_id or "", amount=amount, detail=f"inférence pour {provider}")

    def withdraw(self, account: str, amount: int) -> None:
        available = self.withdrawable.get(account, 0)
        if amount <= 0 or amount > available:
            raise PatronError("ERR_INSUFFICIENT", f"{fmt(available)} disponible")
        if self.balance < amount:
            raise PatronError("ERR_INSUFFICIENT", "solde du contrat")
        self.withdrawable[account] = available - amount
        self.balance -= amount
        self._log("withdraw", account, amount=amount, detail="versement")

    def claim_unpaid(self, ticket: Ticket, *, actor: str | None = None) -> int:
        """Le travailleur réclame une tâche que le patron n'a pas réglée à temps.

        Trois garde-fous : la signature de l'agent, le délai écoulé, et le fait que
        la tâche ne soit pas déjà réglée. Le plafond de paie de la commande s'applique
        quand même : un bon ne peut pas créer d'argent.
        """
        actor = actor or ticket.worker
        if actor != ticket.worker:
            raise PatronError("ERR_NOT_AGENT", "seul le bénéficiaire réclame son bon")
        if not self.agent_pubkey or not ticket_ok(ticket, self.agent_pubkey):
            raise PatronError("ERR_BAD_SIGNATURE", "bon de travail invalide")
        if ticket.digest in self.claimed:
            raise PatronError("ERR_ALREADY_SETTLED", "bon déjà réclamé")
        if self.now_ms() < ticket.issued_ms + self.rules.pay_or_reject_seconds * 1000:
            raise PatronError("ERR_NOT_DUE", "délai payer-ou-refuser non écoulé")
        job = self._job(ticket.job_id)
        key = (job.id, ticket.task_id, ticket.worker)
        if key in self.settled:
            raise PatronError("ERR_ALREADY_SETTLED", "tâche déjà réglée par le patron")
        self._check_bounds(ticket.amount)
        self._roll_day()
        worker = self._worker(ticket.worker)
        if worker.status == FIRED:
            raise PatronError("ERR_WORKER_FIRED", ticket.worker)
        if job.payroll_spent + ticket.amount > job.payroll_budget:
            raise PatronError("ERR_PAYROLL_BUDGET", f"reste {fmt(job.payroll_left)}")
        if self.daily["payroll"] + ticket.amount > self.rules.payroll_cap_per_day:
            raise PatronError("ERR_DAILY_CAP", "plafond de paie du jour")
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
                  detail=f"{ticket.task_id} — le silence valait paiement", reason=ticket.reason)
        return ticket.amount

    def credit_withdrawable(self, account: str, amount: int) -> None:
        self.withdrawable[account] = self.withdrawable.get(account, 0) + amount

    # ------------------------------------------------------------------ pause
    def pause(self, reason: str = "coupe-circuit", *, actor: str | None = None) -> None:
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
        self._log("resume", actor, detail="reprise : les tâches en attente sont payées")

    # ------------------------------------------------------------------ lectures
    def get_job(self, job_id: str) -> dict:
        return self._job(job_id).to_dict()

    def get_worker(self, account: str) -> dict:
        return self._worker(account).to_dict()

    def get_ledger(self, limit: int = 50, kind: str | None = None) -> list[dict]:
        entries = [e for e in self.ledger if kind is None or e.kind == kind]
        return [e.to_dict() for e in entries[-limit:]]

    def get_solvency(self) -> dict:
        held = sum(j.payroll_left + j.margin_reserved for j in self.jobs.values() if j.open)
        return {
            "balance": self.balance,
            "payroll_held": sum(j.payroll_left for j in self.jobs.values() if j.open),
            "margins_held": sum(j.margin_reserved for j in self.jobs.values() if j.open),
            "buckets": self.buckets.to_dict(),
            "withdrawable": dict(self.withdrawable),
            "client_wallets": dict(self.balances),
            "near_balance": self.near_balance,
            "sum": held + self.buckets.total + sum(self.withdrawable.values()),
        }

    def workers_table(self) -> list[dict]:
        return [w.to_dict() for w in self.workers.values()]

    def check_invariants(self) -> list[str]:
        problems: list[str] = []
        if self.balance < 0:
            problems.append(f"solde négatif : {self.balance}")
        for job in self.jobs.values():
            if job.payroll_spent > job.payroll_budget:
                problems.append(f"{job.id}: paie {job.payroll_spent} > budget {job.payroll_budget}")
            if job.payroll_budget < 0 or job.margin_reserved < 0:
                problems.append(f"{job.id}: budget ou marge négatif")
        solvency = self.get_solvency()
        if self.balance != solvency["sum"]:
            problems.append(f"conservation : solde {self.balance} != {solvency['sum']}")
        if any(v < 0 for v in self.withdrawable.values()):
            problems.append("versement en attente négatif")
        for key in self.settled:
            if not isinstance(key, tuple) or len(key) != 3:
                problems.append(f"clé de règlement invalide : {key}")
        return problems