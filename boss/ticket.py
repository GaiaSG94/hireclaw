"""The signed work ticket: proof that the boss owes a worker for a task.

Issued by the agent when it refuses or is slow to pay; the contract can then
be forced to pay through `claim_unpaid` once the delay has elapsed. "Silence means
payment": this is the worker's protection against a defaulting boss.
"""
from __future__ import annotations

from dataclasses import dataclass

from .hashing import canonical, sha256_hex
from .keys import Key, verify


@dataclass(frozen=True)
class Ticket:
    """Work ticket: who, what, how much, signed by whom."""

    job_id: str
    task_id: str
    worker: str
    amount: int
    reason: str
    issued_ms: int
    agent: str
    signature: str

    def payload(self) -> dict:
        return {
            "job_id": self.job_id,
            "task_id": self.task_id,
            "worker": self.worker,
            "amount": self.amount,
            "reason": self.reason,
            "issued_ms": self.issued_ms,
            "agent": self.agent,
        }

    @property
    def digest(self) -> str:
        return sha256_hex(self.payload())

    def to_dict(self) -> dict:
        data = self.payload()
        data["signature"] = self.signature
        return data


def issue(key: Key, job_id: str, task_id: str, worker: str, amount: int, reason: str,
          issued_ms: int) -> Ticket:
    """The agent signs the ticket with its function-call key (never full access)."""
    payload = {
        "job_id": job_id, "task_id": task_id, "worker": worker, "amount": amount,
        "reason": reason, "issued_ms": issued_ms, "agent": key.account,
    }
    return Ticket(signature=key.sign(payload), **payload)


def check(ticket: Ticket, agent_pubkey: str) -> bool:
    """The contract verifies the signature before paying: neither amount nor recipient can change."""
    return verify(agent_pubkey, ticket.payload(), ticket.signature)


def from_dict(data: dict) -> Ticket:
    return Ticket(
        job_id=str(data["job_id"]),
        task_id=str(data["task_id"]),
        worker=str(data["worker"]),
        amount=int(data["amount"]),
        reason=str(data.get("reason", "")),
        issued_ms=int(data["issued_ms"]),
        agent=str(data["agent"]),
        signature=str(data["signature"]),
    )


def canonical_bytes(ticket: Ticket) -> bytes:
    return canonical(ticket.to_dict())