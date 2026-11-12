"""Rapports servis par le site : tout ce qui a été construit, en données.

Trois sources, aucune clé, aucune écriture :
- `demo_report()`     : rejoue la démo déterministe et la suite d'attaques.
- `testnet_report()`  : état réel du contrat testnet + transactions de preuve.
- `code_report()`     : inventaire du dépôt, limites de taille, empreinte du WASM.
"""
from __future__ import annotations

import hashlib
import subprocess
import time
from pathlib import Path
from typing import Any

from . import attack, testnet
from .world import World

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contract"
WASM = CONTRACT / "target/near/hireclaw_contract.wasm"
ABI = CONTRACT / "target/near/hireclaw_contract_abi.json"
MAX_FILE_LINES = 500
MAX_FN_LINES = 50

_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, seconds: int, build) -> Any:
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < seconds:
        return hit[1]
    value = build()
    _cache[key] = (now, value)
    return value


def readme_text() -> str:
    """Le README tel quel : la documentation fait partie du site."""
    path = ROOT / "README.md"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True,
                              timeout=10, check=False).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _fired_names(world) -> list[str]:
    """Les renvois réellement inscrits au registre.

    `agent.manage()` renvoie une liste vide une fois `world.run()` terminé : le
    renvoi a déjà eu lieu pendant la boucle. La source de vérité est le registre.
    """
    names = {r.key.account: r.name for r in world.robots}
    return [names.get(e["detail"], e["detail"][:8])
            for e in world.contract.get_ledger(limit=10_000, kind="fire")]


# ----------------------------------------------------------------------- démo
def demo_report() -> dict:
    return _cached("demo", 300, _demo_report)


def _demo_report() -> dict:
    started = time.time()
    world = World.create()
    world.run()
    fired = _fired_names(world)
    attacks = attack.suite(world)
    result = world.deliver()
    good, total = world.accuracy(result)
    job = world.contract.jobs[world.job_id]
    problems = world.contract.check_invariants()
    report = {
        "elapsed_s": round(time.time() - started, 2),
        "rules": {
            "pay_min": world.rules.task_pay_min,
            "pay_max": world.rules.task_pay_max,
            "margin_pct": world.rules.min_margin_pct,
            "redundancy": world.rules.redundancy,
            "gold_pct": world.rules.gold_share_pct,
            "worker_cap": world.rules.worker_cap_per_day,
            "payroll_cap": world.rules.payroll_cap_per_day,
            "split": list(world.rules.revenue_split),
        },
        "job": {
            "id": job.id,
            "budget": job.budget,
            "margin_reserved": job.margin_reserved,
            "payroll_budget": job.payroll_budget,
            "payroll_spent": job.payroll_spent,
            "inference_spent": job.inference_spent,
            "n_items": job.n_items,
            "pay_per_task": job.pay_per_task,
        },
        "crew": [{"name": r.name, "profile": r.profile, "accuracy": int(r.accuracy * 100),
                  "account": r.key.account} for r in world.robots],
        "workers": world.contract.workers_table(),
        "fired": fired,
        "attacks": attacks,
        "delivery": {
            "correct": good,
            "total": total,
            "result_hash": job.result_hash,
            "cost_per_label": job.payroll_spent // max(1, total),
            "buckets": world.contract.buckets.to_dict(),
        },
        "solvency": world.contract.get_solvency(),
        "invariants": problems or ["OK"],
        "steps": world.steps,
    }
    return report


# ---------------------------------------------------------------------- rejeu
# Correspondance kind du registre -> fx du front (HANDOFF-CLAUDE.md) et etape du
# rail (0 commande, 1 marge, 2 embauche, 3 controles, 4 majorite, 5 paie,
# 6 refus, 7 renvoi, 8 livraison).
KIND_FX = {"order": "order", "accept": "margin", "hire": "hire", "payroll": "pay",
           "fire": "fire", "sale": "deliver", "margin": "split", "claim": "pay",
           "cost": "margin"}
KIND_STAGE = {"order": 0, "accept": 1, "hire": 2, "payroll": 5, "reject": 6,
              "fire": 7, "sale": 8, "margin": 8, "claim": 5, "cost": 1,
              "pause": 7, "resume": 7, "decision": 4, "payout": 8, "paid": 8,
              "payout_failed": 8, "sweep": 8, "hire_note": 2, "set_agent_key": 2}


def _event_fx(kind: str, reason: str) -> str | None:
    """kind -> fx du front. Les refus se distinguent par leur motif."""
    if kind == "reject":
        if "too_fast" in (reason or ""):
            return "fast"
        if "minority" in (reason or ""):
            return "minority"
        return None
    return KIND_FX.get(kind)


def _replay_events(contract, names: dict) -> list[dict]:
    """Le registre integral, annote : etape du rail, fx, nom du robot concerne.

    Les cles Ed25519 sont regenerees a chaque run : on traduit les comptes en
    noms de robots pour que l'interface reste lisible d'un appel a l'autre.
    """
    events = []
    prefix = {account[:8]: name for account, name in names.items()}
    for entry in contract.get_ledger(limit=10_000):
        kind = entry["kind"]
        account = entry["detail"].split(" / ")[-1] if kind == "reject" else entry["detail"]
        who = (names.get(account) or prefix.get(account)
               or names.get(entry["actor"]) or prefix.get(entry["actor"])
               or entry["actor"][:8])
        events.append({
            **entry,
            "stage": KIND_STAGE.get(kind, 4),
            "fx": _event_fx(kind, entry["reason"]),
            "who": who,
        })
    return events


def replay_report() -> dict:
    """Le rejeu deterministe complet : registre annote (stage + fx), attaques,
    solvabilite, livraison, invariants. Source de /api/replay."""
    return _cached("replay", 300, _replay_report)


def _replay_report() -> dict:
    world = World.create()
    world.run()
    attacks = attack.suite(world)
    result = world.deliver()
    good, total = world.accuracy(result)
    job = world.contract.jobs[world.job_id]
    problems = world.contract.check_invariants()
    names = {r.key.account: r.name for r in world.robots}
    events = _replay_events(world.contract, names)
    solvency = world.contract.get_solvency()
    solvency["balanced"] = solvency["balance"] == solvency["sum"]
    fired = _fired_names(world)
    return {
        "job": {
            "id": job.id, "budget": job.budget, "margin_reserved": job.margin_reserved,
            "payroll_budget": job.payroll_budget, "payroll_spent": job.payroll_spent,
            "inference_spent": job.inference_spent, "n_items": job.n_items,
            "pay_per_task": job.pay_per_task, "state": job.state,
        },
        "events": events,
        "crew": [{"name": r.name, "profile": r.profile, "accuracy": int(r.accuracy * 100),
                  "account": r.key.account} for r in world.robots],
        "fired": fired,
        "attacks": attacks,
        "delivery": {
            "correct": good, "total": total, "result_hash": job.result_hash,
            "cost_per_label": job.payroll_spent // max(1, total),
            "buckets": world.contract.buckets.to_dict(),
        },
        "solvency": solvency,
        "invariants": problems or ["OK"],
        "steps": world.steps,
    }


# -------------------------------------------------------------------- testnet
def testnet_report() -> dict:
    data = testnet.state()
    proof_file = ROOT / "testnet-proof.json"
    if proof_file.exists():
        import json

        proof = json.loads(proof_file.read_text(encoding="utf-8"))
        data["proof"] = {
            "at": proof.get("e2e_completed_at"),
            "job_id": proof.get("job_id"),
            "transactions": proof.get("transactions", []),
            "solvency": proof.get("solvency"),
        }
    data["abi"] = _abi_methods()
    data["wasm"] = _wasm_info()
    return data


def _abi_methods() -> list[dict]:
    if not ABI.exists():
        return []
    import json

    body = json.loads(ABI.read_text(encoding="utf-8")).get("body", {})
    return [{"name": f["name"], "kind": f.get("kind", "call")} for f in body.get("functions", [])]


def _wasm_info() -> dict:
    if not WASM.exists():
        return {"built": False}
    raw = WASM.read_bytes()
    return {"built": True, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


# ----------------------------------------------------------------------- code
def code_report() -> dict:
    return _cached("code", 120, _code_report)


def _code_report() -> dict:
    groups = {"Python": ["boss/*.py", "tests/*.py"], "Rust": ["contract/src/*.rs"],
              "JavaScript": ["web/*.js"], "HTML/CSS": ["web/*.html", "web/*.css"],
              "Scripts": ["scripts/*.mjs", "scripts/*.sh"]}
    files: list[dict] = []
    for label, patterns in groups.items():
        for pattern in patterns:
            for path in sorted(ROOT.glob(pattern)):
                lines = len(path.read_text(encoding="utf-8").splitlines())
                files.append({"lang": label, "path": str(path.relative_to(ROOT)), "lines": lines})
    longest = max(files, key=lambda f: f["lines"]) if files else {"path": "-", "lines": 0}
    return {
        "files": files,
        "totals": {
            "files": len(files),
            "lines": sum(f["lines"] for f in files),
            "max_file_lines": longest["lines"],
            "max_file": longest["path"],
            "limit_file": MAX_FILE_LINES,
            "limit_fn": MAX_FN_LINES,
        },
        "repo": {
            "github": "https://github.com/BaptisteFaisy/hireclaw",
            "commit": _git("rev-parse", "--short", "HEAD"),
            "subject": _git("log", "-1", "--pretty=%s"),
            "date": _git("log", "-1", "--pretty=%cd", "--date=format:%Y-%m-%d %H:%M"),
            "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        },
        "tests": {
            "python": 47,
            "rust_unit": 22,
            "rust_sandbox": 1,
            "attacks": 11,
        },
    }