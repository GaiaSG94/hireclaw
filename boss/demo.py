"""make demo — the whole story in under two minutes, offline, with no secret."""
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
    print(f"floor {fmt(rules.task_pay_min)} / ceiling {fmt(rules.task_pay_max)} USDC per task")
    print(f"min margin {rules.min_margin_pct}% · redundancy {rules.redundancy} · "
          f"hidden checks {rules.gold_share_pct}% · worker cap {fmt(rules.worker_cap_per_day)}/day")


def _job(world: World) -> None:
    job = world.contract.jobs[world.job_id]
    print(f"order {job.id}: {job.n_items} items, {fmt(job.budget)} USDC paid upfront")
    print(f"  margin reserved {fmt(job.margin_reserved)} · payroll budget {fmt(job.payroll_budget)} "
          f"· rate {fmt(job.pay_per_task)}")
    print(f"  commitment on the hidden checks: {job.gold_commit[:16]}…")


def _crew(world: World) -> None:
    print(f"{len(world.robots)} robots hired (registration paid by the contract):")
    for robot in world.robots:
        print(f"  {robot.name:<6} {robot.profile:<7} simulated accuracy {int(robot.accuracy * 100)}%  "
              f"{robot.key.account[:16]}…")


def _workers(world: World) -> None:
    print(f"{'worker':<12}{'status':<9}{'paid':>7}{'rejected':>9}{'checks':>10}"
          f"{'acc.':>8}{'earned':>10}")
    for worker in world.contract.workers_table():
        print(f"{worker['account'][:8]:<12}{worker['status']:<9}{worker['tasks_paid']:>7}"
              f"{worker['tasks_rejected']:>9}{worker['golds']:>10}"
              f"{str(worker['accuracy_pct']) + '%':>8}{fmt(worker['earned_total']):>10}")


def _ledger(world: World, n: int = 8) -> None:
    print(f"Ledger (last {n} entries):")
    for entry in world.contract.get_ledger(n):
        amount = f"{fmt(entry['amount']):>7} USDC" if entry["amount"] else " " * 13
        detail = entry["detail"] or entry["reason"]
        print(f"  #{entry['seq']:<3} {entry['kind']:<8} {amount}  {detail[:44]}")


def _deliver(world: World) -> dict:
    result = world.deliver()
    good, total = world.accuracy(result)
    job = world.contract.jobs[world.job_id]
    print(f"delivery: {len(result)} items, hash {job.result_hash[:16]}…")
    print(f"accuracy of the delivered set: {good}/{total} against the reference answers")
    print(f"payroll paid {fmt(job.payroll_spent)} USDC · cost per label "
          f"{fmt(job.payroll_spent // max(1, total))} USDC")
    buckets = world.contract.buckets
    print(f"margin split 60/30/10: owner {fmt(buckets.owner)} · "
          f"reserve {fmt(buckets.reserve)} · contributors {fmt(buckets.contributors)}")
    return result


def _solvency(world: World) -> list[str]:
    contract = world.contract
    solvency = contract.get_solvency()
    print(f"contract balance {fmt(solvency['balance'])} = payroll held "
          f"{fmt(solvency['payroll_held'])} + margins {fmt(solvency['margins_held'])} + buckets "
          f"{fmt(solvency['buckets'].total if hasattr(solvency['buckets'], 'total') else sum(solvency['buckets'].values()))}"
          f" + pending payouts {fmt(sum(solvency['withdrawable'].values()))}")
    problems = contract.check_invariants()
    print("invariants: " + ("OK" if not problems else "VIOLATED → " + "; ".join(problems)))
    return problems


def _kill_switch(world: World) -> str:
    world.contract.pause("end-of-demo kill switch")
    try:
        world.contract.hire("after-pause.testnet")
        return "NO ERROR"
    except PatronError as exc:
        return exc.code


def main() -> int:
    started = time.time()
    print("\nHireclaw — an AI hires humans, checks their work, pays, delivers\n")
    world = World.create()
    _line()
    print("1. Owner's rules (config.yaml), enforced by the contract")
    _rules(world.contract)
    _line()
    print("2. Order paid upfront, budget locked")
    _job(world)
    _line()
    print("3. Hiring")
    _crew(world)
    _line()
    print("4. Work, hidden checks, majorities")
    world.run()
    _workers(world)
    _line()
    print("5. Firings and attacks")
    for event in world.agent.manage():
        print("  " + event)
    attacks = attack.suite(world)
    failures = attack.print_results(attacks)
    _line()
    print("6. Delivery")
    _deliver(world)
    _line()
    _ledger(world)
    _line()
    problems = _solvency(world)
    code = _kill_switch(world)
    print(f"kill switch: hire refused → {code}")
    elapsed = time.time() - started
    print(f"\nelapsed {elapsed:.1f} s · attacks {len(attacks) - failures}/{len(attacks)} refused as expected")
    ok = not problems and not failures and code == "ERR_PAUSED" and elapsed < 120
    print("INVARIANTS OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())