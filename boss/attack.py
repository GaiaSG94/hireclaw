"""Les attaques attendues : chaque refus du contrat, avec son code exact."""
from __future__ import annotations

from dataclasses import replace
from typing import Callable

from .config import Rules
from .contract import Contract
from .errors import PatronError
from .keys import Key
from .money import fmt, usdc
from .world import CONFIG, Clock, World


def expect(label: str, code: str, action: Callable[[], None]) -> dict:
    try:
        action()
        actual = "AUCUNE ERREUR"
    except PatronError as exc:
        actual = exc.code
    return {"label": label, "expected": code, "actual": actual, "ok": actual == code}


def mini(**overrides) -> tuple[Contract, str, list[Key], Clock]:
    """Un contrat minimal : une commande acceptée, trois travailleurs embauchés."""
    rules = replace(Rules.load(CONFIG), **overrides)
    clock = Clock()
    contract = Contract(rules, "owner", "boss", clock=clock.now)
    contract.deposit("client", usdc(5))
    job = contract.order("client", usdc(1), n_items=4,
                         deadline_ms=clock.now() + 3_600_000, spec_hash="s")
    contract.accept_job(job, usdc("0.02"), "commit")
    keys = [Key() for _ in range(3)]
    for key in keys:
        contract.hire(key.account)
    return contract, job, keys, clock


def suite(world: World) -> list[dict]:
    """Les sept refus du cahier des charges, joués sur le monde de la démo."""
    contract, job = world.contract, world.job_id
    settled = sorted(contract.settled)
    task_id, worker = (settled[0][1], settled[0][2]) if settled else ("x", "y")
    fired = next((a for a, w in contract.workers.items() if w.status == "Fired"), worker)
    results = [
        expect("payer 1,00 USDC une tâche (plafond)", "ERR_PAY_ABOVE_MAX",
               lambda: contract.pay_batch(job, [(f"px-{i}", worker) for i in range(1)], amount=usdc(1))),
        expect("payer 0,001 USDC une tâche (plancher)", "ERR_PAY_BELOW_MIN",
               lambda: contract.pay_batch(job, [("px-min", worker)], amount=usdc("0.001"))),
        expect("payer deux fois la même tâche", "ERR_ALREADY_SETTLED",
               lambda: contract.pay_batch(job, [(task_id, worker)])),
        expect("payer un travailleur renvoyé", "ERR_WORKER_FIRED",
               lambda: contract.pay_batch(job, [("px-fired", fired)])),
        expect("payer un compte non embauché", "ERR_NOT_HIRED",
               lambda: contract.pay_batch(job, [("px-none", "inconnu.testnet")])),
        expect("dépasser le budget de paie de la commande", "ERR_PAYROLL_BUDGET",
               lambda: contract.pay_batch(job, [(f"px-{i}", worker) for i in range(10)],
                                          amount=usdc("0.10"))),
        expect("renvoyer un bon travailleur", "ERR_FIRE_NOT_JUSTIFIED",
               lambda: contract.fire(next(a for a, w in contract.workers.items()
                                          if w.status != "Fired" and w.golds >= 5))),
    ]
    results += _cap_attacks()
    results += _pause_attacks(world)
    return results


def _cap_attacks() -> list[dict]:
    worker_cap, job, keys, _ = mini(worker_cap_per_day=usdc("0.03"))
    worker_cap.pay_batch(job, [("a1", keys[0].account)])
    daily, djob, dkeys, _ = mini(payroll_cap_per_day=usdc("0.03"))
    daily.pay_batch(djob, [("b1", dkeys[0].account)])
    return [
        expect("dépasser le plafond d'un travailleur", "ERR_WORKER_CAP",
               lambda: worker_cap.pay_batch(job, [("a2", keys[0].account)])),
        expect("dépasser le plafond de paie du jour", "ERR_DAILY_CAP",
               lambda: daily.pay_batch(djob, [("b2", dkeys[1].account)])),
    ]


def _pause_attacks(world: World) -> list[dict]:
    contract, job = world.contract, world.job_id
    contract.pause("test du coupe-circuit")
    worker = next(a for a, w in contract.workers.items() if w.status != "Fired")
    results = [
        expect("payer pendant la pause", "ERR_PAUSED",
               lambda: contract.pay_batch(job, [("pp-1", worker)])),
        expect("embaucher pendant la pause", "ERR_PAUSED",
               lambda: contract.hire("nouveau.testnet")),
    ]
    contract.resume()
    return results


def print_results(results: list[dict]) -> int:
    failures = 0
    for row in results:
        mark = "OK  " if row["ok"] else "FAIL"
        failures += 0 if row["ok"] else 1
        print(f"  [{mark}] {row['label']:<48} → {row['actual']}")
    return failures


def main() -> int:
    print("Attaques Hireclaw — un refus par ligne, code attendu à droite\n")
    world = World.create()
    world.run()
    results = suite(world)
    failures = print_results(results)
    print(f"\n{len(results) - failures}/{len(results)} refus conformes")
    return 1 if failures else 0

if __name__ == "__main__":
    raise SystemExit(main())
