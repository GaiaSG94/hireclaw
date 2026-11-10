"""Le bon de travail signé : la preuve que le patron doit une tâche à un travailleur.

Émis par l'agent au moment où il refuse ou tarde à payer ; le contrat peut ensuite
être forcé à payer via `claim_unpaid` une fois le délai écoulé. « Le silence vaut
paiement » : c'est la protection du travailleur contre un patron défaillant.
"""
from __future__ import annotations

from dataclasses import dataclass

from .hashing import canonical, sha256_hex
from .keys import Key, verify


@dataclass(frozen=True)
class Ticket:
    """Bon de travail : qui, quoi, combien, signé par qui."""

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
    """L'agent signe le bon avec sa clé d'appel de fonction (jamais un accès total)."""
    payload = {
        "job_id": job_id, "task_id": task_id, "worker": worker, "amount": amount,
        "reason": reason, "issued_ms": issued_ms, "agent": key.account,
    }
    return Ticket(signature=key.sign(payload), **payload)


def check(ticket: Ticket, agent_pubkey: str) -> bool:
    """Le contrat vérifie la signature avant de payer : ni montant, ni destinataire modifiables."""
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