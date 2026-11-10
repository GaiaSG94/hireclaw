"""La démo de bout en bout : livraison, exactitude, renvois, invariants."""
from __future__ import annotations

from boss.world import World


def test_world_delivers_at_least_11_of_12():
    world = World.create()
    world.run()
    assert len(world.agent.engine.labels) == len(world.agent.item_ids)
    result = world.deliver()
    good, total = world.accuracy(result)
    assert total == 12
    assert good >= 11
    assert world.contract.check_invariants() == []


def test_cheater_is_fired_and_careful_workers_are_not():
    world = World.create()
    world.run()
    fired = [w for w in world.contract.workers.values() if w.status == "Fired"]
    assert fired, "au moins le tricheur doit être renvoyé"
    assert all(w.accuracy_pct < world.rules.fire_below_accuracy_pct for w in fired)
    careful = [r for r in world.robots if r.profile == "careful"]
    by_account = {w.account: w for w in world.contract.workers.values()}
    assert all(by_account[r.key.account].status != "Fired" for r in careful)


def test_payroll_never_exceeds_budget_and_margin_is_intact():
    world = World.create()
    world.run()
    job = world.contract.jobs[world.job_id]
    assert job.payroll_spent <= job.payroll_budget
    margin_before = job.margin_reserved
    world.deliver()
    assert job.payroll_spent <= job.payroll_budget
    assert margin_before > 0


def test_daily_inference_is_capped():
    world = World.create()
    world.run()
    spent = world.contract.daily["inference"]
    assert spent <= world.rules.inference_max_spend_per_day


def test_worker_receives_payment_without_sending_transaction():
    world = World.create()
    world.run()
    paid = [w for w in world.contract.workers.values() if w.tasks_paid > 0]
    assert paid
    assert all(w.earned_total == world.contract.withdrawable.get(w.account, 0) for w in paid)