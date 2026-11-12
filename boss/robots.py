"""Robots: one client, three careful workers, one sloppy, one cheater."""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .keys import Key
from .money import usdc


@dataclass
class RobotWorker:
    name: str
    key: Key
    accuracy: float
    profile: str  # careful | sloppy | cheater
    rng: random.Random = field(default_factory=random.Random)

    def answer(self, item) -> tuple[str, int]:
        """Returns (choice, latency_ms)."""
        if self.profile == "cheater":
            return item.choices[0], 120
        if self.rng.random() < self.accuracy:
            choice = item.gold
        else:
            choice = self.rng.choice([c for c in item.choices if c != item.gold])
        if self.profile == "sloppy":
            return choice, self.rng.randint(1200, 4000)
        return choice, self.rng.randint(800, 2600)

    def sign(self, task_id: str, choice: str, latency_ms: int) -> str:
        from .keys import answer_payload

        return self.key.sign(answer_payload(self.key.account, task_id, choice, latency_ms))


def crew(seed: int = 7) -> list[RobotWorker]:
    """The five demo robots: 3 careful, 1 sloppy, 1 cheater."""
    return [
        RobotWorker("alice", Key(), 0.95, "careful", random.Random(seed + 1)),
        RobotWorker("bob", Key(), 0.95, "careful", random.Random(seed + 2)),
        RobotWorker("chloe", Key(), 0.95, "careful", random.Random(seed + 3)),
        RobotWorker("dora", Key(), 0.60, "sloppy", random.Random(seed + 4)),
        RobotWorker("eli", Key(), 0.20, "cheater", random.Random(seed + 5)),
    ]


@dataclass
class RobotClient:
    """Simulated human client: pays for the order upfront."""
    accounting: str
    budget: int
    key: Key = field(default_factory=Key)

    def fund(self, contract) -> None:
        contract.deposit(self.accounting, self.budget)

    def order(self, contract, n_items: int, deadline_ms: int, spec_hash: str) -> str:
        return contract.order(self.accounting, self.budget, n_items=n_items,
                              deadline_ms=deadline_ms, spec_hash=spec_hash)


def default_client() -> RobotClient:
    return RobotClient("acme.testnet", usdc("1.20"))