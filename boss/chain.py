"""Testnet relay client: the site pays for real, without ever touching a key.

The relay (`scripts/relay.mjs`, 127.0.0.1:8790) holds the agent key and signs
the transactions. This module only does local HTTP: if the relay is missing,
the site keeps running in local demo mode (no error on the visitor side).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RELAY = os.environ.get("HIRECLAW_RELAY", "http://127.0.0.1:8790")
TIMEOUT_S = float(os.environ.get("HIRECLAW_RELAY_TIMEOUT", "25"))


def _post(path: str, body: dict) -> dict:
    request = urllib.request.Request(
        RELAY + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": "RELAY_UNREACHABLE", "detail": str(exc)[:120]}


def _get(path: str) -> dict | None:
    try:
        with urllib.request.urlopen(RELAY + path, timeout=TIMEOUT_S) as response:
            return json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None


def available() -> bool:
    health = _get("/health")
    return bool(health and health.get("ok"))


def site_job() -> str | None:
    """The open order dedicated to the site, else the last one seen by the relay."""
    state = _get("/state")
    if not state:
        return None
    return state.get("job_id")


def _contract() -> str | None:
    path = ROOT / "testnet-deployment.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("contract")
    except (OSError, json.JSONDecodeError):
        return None


def chain_state() -> dict:
    state = _get("/state") or {}
    job = state.get("job") or {}
    payroll_left = int(job.get("payroll_budget", 0)) - int(job.get("payroll_spent", 0))
    return {
        "available": bool(state),
        "contract": state.get("contract") or _contract(),
        "job": job.get("id"),
        "job_state": job.get("state"),
        "payroll_left": max(0, payroll_left),
        "solvency": state.get("solvency"),
    }


def hire(worker: str) -> dict:
    """On-chain worker registration (idempotent, including ERR_ALREADY_HIRED)."""
    return _post("/hire", {"worker": worker})


def pay(job_id: str, items: list[dict]) -> dict:
    """Pays a batch of validated tasks (the relay splits into batches of 10)."""
    return _post("/pay", {"job_id": job_id, "items": items})


def reject(job_id: str, task_id: str, worker: str, reason: str, gold: bool = False) -> dict:
    return _post("/reject", {"job_id": job_id, "task_id": task_id, "worker": worker,
                             "reason": reason, "gold": gold})


def withdraw(ticket: dict) -> dict:
    """Withdrawal order signed by the worker; the relay pays the gas."""
    return _post("/withdraw", {"ticket": ticket})


def transaction(tx_hash: str) -> dict[str, Any]:
    return _get(f"/tx/{tx_hash}") or {"ok": False, "error": "RELAY_UNREACHABLE"}
