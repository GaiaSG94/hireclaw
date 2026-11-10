"""make demo — l'histoire complète en moins de deux minutes, hors ligne, sans secret."""
from __future__ import annotations

import time

from . import attack
from .errors import PatronError
from .money import fmt, usdc
from .world import World


def _line() -> None:
    print("-" * 78)


def _rules(contract) -> None:
    rules = contract.rules
    print(f"plancher {fmt(rules.task_pay_min)} / plafond {fmt(rules.task_pay_max)} USDC par tâche")
    print(f"marge mini {rules.min_margin_pct}% · redondance {rules.redundancy} · "
          f"contrôles {rules.gold_share_pct}% · plafond travailleur {fmt(rules.worker_cap_per_day)}/jour")


def _job(world: World) -> None:
    job = world.contract.jobs[world.job_id]
    print(f"commande {job.id} : {job.n_items} éléments, {fmt(job.budget)} USDC payés d'avance")
    print(f"  marge réservée {fmt(job.margin_reserved)} · budget de paie {fmt(job.payroll_budget)} "
          f"· tarif {fmt(job.pay_per_task)}")
    print(f"  engagement sur les contrôles : {job.gold_commit[:16]}…")


def _crew(world: World) -> None:
    print(f"{len(world.robots)} robots embauchés (inscription payée par le contrat) :")
    for robot in world.robots:
        print(f"  {robot.name:<6} {robot.profile:<7} exactitude simulée {int(robot.accuracy * 100)}%  "
              f"{robot.key.account[:16]}…")


def _workers(world: World) -> None:
    print(f"{'travailleur':<12}{'statut':<9}{'payées':>7}{'refusées':>9}{'contrôles':>10}"
          f"{'exact.':>8}{'gagné':>10}")
    for worker in world.contract.workers_table():
        print(f"{worker['account'][:8]:<12}{worker['status']:<9}{worker['tasks_paid']:>7}"
              f"{worker['tasks_rejected']:>9}{worker['golds']:>10}"
              f"{str(worker['accuracy_pct']) + '%':>8}{fmt(worker['earned_total']):>10}")


def _ledger(world: World, n: int = 8) -> None:
    print(f"Registre (les {n} dernières lignes) :")
    for entry in world.contract.get_ledger(n):
        amount = f"{fmt(entry['amount']):>7} USDC" if entry["amount"] else " " * 13
        detail = entry["detail"] or entry["reason"]
        print(f"  #{entry['seq']:<3} {entry['kind']:<8} {amount}  {detail[:44]}")


def _deliver(world: World) -> dict:
    result = world.deliver()
    good, total = world.accuracy(result)
    job = world.contract.jobs[world.job_id]
    print(f"livraison : {len(result)} éléments, empreinte {job.result_hash[:16]}…")
    print(f"exactitude du jeu livré : {good}/{total} face aux réponses de référence")
    print(f"paie versée {fmt(job.payroll_spent)} USDC · coût par étiquette "
          f"{fmt(job.payroll_spent // max(1, total))} USDC")
    buckets = world.contract.buckets
    print(f"marge ventilée 60/30/10 : propriétaire {fmt(buckets.owner)} · "
          f"réserve {fmt(buckets.reserve)} · contributeurs {fmt(buckets.contributors)}")
    return result


def _solvency(world: World) -> list[str]:
    contract = world.contract
    solvency = contract.get_solvency()
    print(f"solde du contrat {fmt(solvency['balance'])} = paie bloquée "
          f"{fmt(solvency['payroll_held'])} + marges {fmt(solvency['margins_held'])} + poches "
          f"{fmt(solvency['buckets'].total if hasattr(solvency['buckets'], 'total') else sum(solvency['buckets'].values()))}"
          f" + versements en attente {fmt(sum(solvency['withdrawable'].values()))}")
    problems = contract.check_invariants()
    print("invariants : " + ("OK" if not problems else "VIOLÉS → " + "; ".join(problems)))
    return problems


def _kill_switch(world: World) -> str:
    world.contract.pause("coupe-circuit de fin de démo")
    try:
        world.contract.hire("apres-coupure.testnet")
        return "AUCUNE ERREUR"
    except PatronError as exc:
        return exc.code


def main() -> int:
    started = time.time()
    print("\nHireclaw — une IA embauche des humains, contrôle, paie, livre\n")
    world = World.create()
    _line()
    print("1. Règles du propriétaire (config.yaml), appliquées par le contrat")
    _rules(world.contract)
    _line()
    print("2. Commande payée d'avance, budget bloqué")
    _job(world)
    _line()
    print("3. Embauche")
    _crew(world)
    _line()
    print("4. Travail, contrôles cachés, majorités")
    world.run()
    _workers(world)
    _line()
    print("5. Renvois et attaques")
    for event in world.agent.manage():
        print("  " + event)
    attacks = attack.suite(world)
    failures = attack.print_results(attacks)
    _line()
    print("6. Livraison")
    _deliver(world)
    _line()
    _ledger(world)
    _line()
    problems = _solvency(world)
    code = _kill_switch(world)
    print(f"coupe-circuit : embauche refusée → {code}")
    elapsed = time.time() - started
    print(f"\ndurée {elapsed:.1f} s · attaques {len(attacks) - failures}/{len(attacks)} conformes")
    ok = not problems and not failures and code == "ERR_PAUSED" and elapsed < 120
    print("INVARIANTS OK" if ok else "ÉCHEC")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())