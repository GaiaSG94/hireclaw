"""Vues du contrat : lecture seule et invariants, sans aucune écriture d'état.

Découpé depuis `contract.py` pour tenir la limite de 500 lignes par fichier.
Chaque fonction prend le contrat en premier argument ; `Contract` délègue vers ici.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # évite l'import circulaire à l'exécution
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
    """C-I1 : le solde doit toujours égaler la somme des engagements."""
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
        problems.append(f"solde négatif : {contract.balance}")
    for job in contract.jobs.values():
        if job.payroll_spent > job.payroll_budget:
            problems.append(f"{job.id}: paie {job.payroll_spent} > budget {job.payroll_budget}")
        if job.payroll_budget < 0 or job.margin_reserved < 0:
            problems.append(f"{job.id}: budget ou marge négatif")
    solvency = get_solvency(contract)
    if contract.balance != solvency["sum"]:
        problems.append(f"conservation : solde {contract.balance} != {solvency['sum']}")
    if any(v < 0 for v in contract.withdrawable.values()):
        problems.append("versement en attente négatif")
    if any(v < 0 for v in contract.pending_out.values()):
        problems.append("transfert en vol négatif")
    return problems
