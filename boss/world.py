"""A complete world (contract + agent + robots) shared by the demo and the site."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import dataset
from .agent import BossAgent
from .keys import Key
from .config import Rules
from .contract import Contract
from .money import fmt, usdc
from .robots import RobotClient, RobotWorker, crew

CONFIG = Path(__file__).resolve().parent.parent / "config.yaml"


class Clock:
    def __init__(self, start_ms: int = 1_700_000_000_000) -> None:
        self.ms = start_ms

    def now(self) -> int:
        return self.ms

    def set(self, ms: int) -> None:
        self.ms = max(self.ms, ms)

    def advance(self, ms: int) -> None:
        self.ms += ms


@dataclass
class World:
    rules: Rules
    contract: Contract
    agent: BossAgent
    items: list
    job_id: str
    clock: Clock
    robots: list[RobotWorker] = field(default_factory=list)
    client: RobotClient | None = None
    agent_key: Key | None = None
    free_at: dict[str, int] = field(default_factory=dict)
    idle: set[str] = field(default_factory=set)
    steps: int = 0

    # -------------------------------------------------------------- construction
    @classmethod
    def create(cls, *, seed: int = 7, n_items: int = 12, budget: int = usdc("1.20"),
               deadline_s: int = 3600, rules: Rules | None = None,
               gold_count: int = 8) -> "World":
        clock = Clock()
        rules = rules or Rules.load(CONFIG)
        agent_key = Key()
        contract = Contract(rules, "owner.testnet", "hireclaw.testnet", clock=clock.now,
                            agent_pubkey=agent_key.pub_hex)
        all_items = dataset.load()
        job_items = all_items[:n_items]
        golds = all_items[n_items:n_items + gold_count]
        agent = BossAgent(contract, job_items + golds, {i.id for i in golds},
                          __import__("random").Random(seed), key=agent_key)
        client = RobotClient("acme.testnet", budget)
        client.fund(contract)
        job_id = client.order(contract, n_items, clock.now() + deadline_s * 1000, "spec-demo")
        agent.accept(job_id)
        robots = crew(seed)
        for robot in robots:
            agent.onboard(robot.key)
        world = cls(rules, contract, agent, job_items + golds, job_id, clock, robots, client,
                    agent_key=agent_key)
        world.free_at = {r.key.account: clock.now() for r in robots}
        return world

    # -------------------------------------------------------------------- loop
    def run(self, max_steps: int = 4000) -> "World":
        target = len(self.agent.item_ids)
        while max_steps > 0:
            if self._done(target):
                break
            if not self._step():
                break
            self.agent.manage()
            max_steps -= 1
        return self

    def _done(self, target: int) -> bool:
        job = self.contract.jobs[self.job_id]
        labels_done = len(self.agent.engine.labels) >= target
        golds_done = all(w.golds >= self.rules.min_golds_before_fire or w.status == "Fired"
                         for w in self.contract.workers.values())
        return labels_done and (golds_done or job.payroll_left < job.pay_per_task)

    def _step(self) -> bool:
        active = [a for a in self.free_at
                  if self.contract.workers[a].status != "Fired" and a not in self.idle]
        if not active:
            return False
        account = min(active, key=lambda a: self.free_at[a])
        task = self.agent.serve(account)
        if task is None:
            self.idle.add(account)
            return True
        robot = next(r for r in self.robots if r.key.account == account)
        item = self.agent.engine.by_id[task.item_id]
        choice, latency = robot.answer(item)
        self.clock.set(self.free_at[account] + latency)
        self.agent.submit(account, task.id, choice, latency,
                          robot.sign(task.id, choice, latency), self.job_id)
        self.free_at[account] = self.clock.now()
        self.steps += 1
        return True

    # ------------------------------------------------------------------- reads
    def delivered(self) -> bool:
        return self.contract.jobs[self.job_id].state == "delivered"

    def deliver(self) -> dict:
        return self.agent.deliver(self.job_id)

    def accuracy(self, result: dict | None = None) -> tuple[int, int]:
        result = result or self.agent.engine.validated
        job_items = [i for i in self.items if i.id in self.agent.item_ids]
        good = sum(1 for i in job_items if result.get(i.id) == i.gold)
        return good, len(job_items)

    def stats(self) -> dict[str, Any]:
        job = self.contract.jobs[self.job_id]
        good, total = self.accuracy()
        return {
            "job": job.id,
            "budget": job.budget,
            "payroll_budget": job.payroll_budget,
            "payroll_spent": job.payroll_spent,
            "margin": job.margin_reserved + job.payroll_left,
            "items": total,
            "correct": good,
            "cost_per_label": job.payroll_spent // max(1, total),
            "payments": self.agent.payments,
            "rejections": self.agent.rejections,
            "state": job.state,
            "steps": self.steps,
        }

    def snapshot(self) -> dict:
        job = self.contract.jobs[self.job_id]
        results = self.agent.engine.validated
        return {
            "job": job.to_dict(),
            "progress": {"validated": len([i for i in results if i in self.agent.item_ids]),
                         "total": job.n_items},
            "workers": self.contract.workers_table(),
            "ledger": self.contract.get_ledger(40),
            "solvency": self.contract.get_solvency(),
            "decisions": self.contract.get_ledger(30, "decision"),
            "rules": {"pay_min": self.rules.task_pay_min, "pay_max": self.rules.task_pay_max,
                      "margin_pct": self.rules.min_margin_pct,
                      "redundancy": self.rules.redundancy,
                      "gold_pct": self.rules.gold_share_pct,
                      "pay_or_reject_s": self.rules.pay_or_reject_seconds,
                      "worker_cap": self.rules.worker_cap_per_day},
            "pay_per_task": job.pay_per_task,
            "paused": self.contract.paused,
        }

    def fmt(self, amount: int) -> str:
        return fmt(amount)