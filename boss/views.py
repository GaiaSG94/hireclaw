"""Contract views: read-only queries and invariants, with no state write at all.

Split out of `contract.py` to stay under the 500-lines-per-file limit.
Each function takes the contract as first argument; `Contract` delegates here.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # avoids the circular import at runtime
    from .contract import Contract


def get_job(contract: "Contract", job_id: str) -> dict:
    return contract._job(job_id).to_dict()


def get_worker(contract: "Contract", account: str) -> dict:
    return contract._worker(account).to_dict()


def get_ledger(contract: "Contract", limit: int = 50, kind: str | None = None) -> list[dict]:
    entries = [e for e in contract.ledger if kind is None or e.kind == kind]
    return [e.to_dict() for e in entries[-limit:]]


def workers_table(contract: "Contract") -> list[dict]:
    return [w.to_dict() for w in contract.workers.values()]


def get_solvency(contract: "Contract") -> dict:
    """C-I1: the balance must always equal the sum of the commitments."""
    open_jobs = [j for j in contract.jobs.values() if j.open]
    held = sum(j.payroll_left + j.margin_reserved for j in open_jobs)
    return {
        "balance": contract.balance,
        "payroll_held": sum(j.payroll_left for j in open_jobs),
        "margins_held": sum(j.margin_reserved for j in open_jobs),
        "buckets": contract.buckets.to_dict(),
        "withdrawable": dict(contract.withdrawable),
        "pending_out": dict(contract.pending_out),
        "client_wallets": dict(contract.balances),
        "near_balance": contract.near_balance,
        "sum": (held + contract.buckets.total + sum(contract.withdrawable.values())
                + sum(contract.pending_out.values())),
    }


def check_invariants(contract: "Contract") -> list[str]:
    problems: list[str] = []
    if contract.balance < 0:
        problems.append(f"negative balance: {contract.balance}")
    for job in contract.jobs.values():
        if job.payroll_spent > job.payroll_budget:
            problems.append(f"{job.id}: payroll {job.payroll_spent} > budget {job.payroll_budget}")
        if job.payroll_budget < 0 or job.margin_reserved < 0:
            problems.append(f"{job.id}: negative budget or margin")
    solvency = get_solvency(contract)
    if contract.balance != solvency["sum"]:
        problems.append(f"conservation: balance {contract.balance} != {solvency['sum']}")
    if any(v < 0 for v in contract.withdrawable.values()):
        problems.append("negative pending payout")
    if any(v < 0 for v in contract.pending_out.values()):
        problems.append("negative in-flight transfer")
    return problems
