"""Le contrat : bornes, plafonds, double paiement, renvoi, livraison, conservation."""
from __future__ import annotations

from dataclasses import replace

import pytest

from boss.config import Rules
from boss.contract import Contract
from boss.errors import PatronError
from boss.keys import Key
from boss.hashing import sha256_hex
from boss.money import usdc
from boss.world import CONFIG, Clock


def mini(**overrides):
    rules = replace(Rules.load(CONFIG), **overrides)
    clock = Clock()
    contract = Contract(rules, "owner", "agent.testnet", clock=clock.now)
    contract.deposit("client", usdc(5))
    job = contract.order("client", usdc(1), n_items=4, deadline_ms=clock.now() + 3_600_000,
                         spec_hash="spec")
    contract.accept_job(job, usdc("0.02"), sha256_hex({}))
    keys = [Key() for _ in range(3)]
    for key in keys:
        contract.hire(key.account)
    return contract, job, keys, clock


def test_accept_reserves_margin_and_payroll():
    contract, job, _, _ = mini()
    record = contract.jobs[job]
    assert record.margin_reserved == usdc("0.15")
    assert record.payroll_budget == usdc("0.85")
    assert record.state == "accepted"


def test_order_blocks_budget_and_checks_wallet():
    contract, _, _, clock = mini()
    with pytest.raises(PatronError) as exc:
        contract.order("client", usdc(99), n_items=1, deadline_ms=clock.now() + 1000, spec_hash="s")
    assert exc.value.code == "ERR_INSUFFICIENT"
    assert contract.balance == usdc(1)


def test_bounds_are_enforced():
    contract, job, _, _ = mini()
    with pytest.raises(PatronError) as low:
        contract.pay_batch(job, [("t1", Key().account)], amount=usdc("0.001"))
    assert low.value.code == "ERR_PAY_BELOW_MIN"
    with pytest.raises(PatronError) as high:
        contract.pay_batch(job, [("t1", Key().account)], amount=usdc(1))
    assert high.value.code == "ERR_PAY_ABOVE_MAX"


def test_double_payment_is_refused():
    contract, job, keys, _ = mini()
    contract.pay_batch(job, [("t1", keys[0].account)])
    with pytest.raises(PatronError) as exc:
        contract.pay_batch(job, [("t1", keys[0].account)])
    assert exc.value.code == "ERR_ALREADY_SETTLED"
    assert contract.get_worker(keys[0].account)["tasks_paid"] == 1


def test_worker_and_daily_caps():
    contract, job, keys, _ = mini(worker_cap_per_day=usdc("0.03"))
    contract.pay_batch(job, [("t1", keys[0].account)])
    with pytest.raises(PatronError) as exc:
        contract.pay_batch(job, [("t2", keys[0].account)])
    assert exc.value.code == "ERR_WORKER_CAP"
    daily, djob, dkeys, _ = mini(payroll_cap_per_day=usdc("0.03"))
    daily.pay_batch(djob, [("t1", dkeys[0].account)])
    with pytest.raises(PatronError) as exc2:
        daily.pay_batch(djob, [("t2", dkeys[1].account)])
    assert exc2.value.code == "ERR_DAILY_CAP"


def test_fire_needs_golds_and_bad_accuracy():
    contract, job, keys, _ = mini()
    with pytest.raises(PatronError) as exc:
        contract.fire(keys[0].account)
    assert exc.value.code == "ERR_FIRE_NOT_JUSTIFIED"
    for i in range(5):
        contract.reject(job, f"g{i}", keys[0].account, "gold_wrong", gold=True)
    contract.fire(keys[0].account)
    assert contract.get_worker(keys[0].account)["status"] == "Fired"


def test_forbidden_worker_and_double_hire():
    contract, _, _, _ = mini()
    with pytest.raises(PatronError) as exc:
        contract.hire(contract.agent)
    assert exc.value.code == "ERR_FORBIDDEN_WORKER"
    existing = next(iter(contract.workers))
    with pytest.raises(PatronError) as exc2:
        contract.hire(existing)
    assert exc2.value.code == "ERR_ALREADY_HIRED"


def test_delivery_splits_margin_and_checks_commit():
    contract, job, keys, _ = mini()
    for i in range(4):
        contract.pay_batch(job, [(f"t{i}", keys[i % 3].account)])
    with pytest.raises(PatronError) as exc:
        contract.deliver(job, "hash", 4, {"gold": "positif"})
    assert exc.value.code == "ERR_GOLD_MISMATCH"
    with pytest.raises(PatronError) as exc2:
        contract.deliver(job, "hash", 2, {})
    assert exc2.value.code == "ERR_NOT_DELIVERABLE"


def test_inference_is_paid_from_margin_only():
    contract, job, keys, _ = mini()
    contract.pay_batch(job, [("t1", keys[0].account)])
    contract.record_cost("provider", usdc("0.05"), job_id=job)
    record = contract.jobs[job]
    assert record.margin_reserved == usdc("0.10")
    assert record.payroll_spent == usdc("0.02")
    with pytest.raises(PatronError) as exc:
        contract.record_cost("provider", usdc("0.50"), job_id=job)
    assert exc.value.code == "ERR_INFERENCE_CAP"


def test_refund_after_deadline_only():
    contract, job, keys, clock = mini()
    contract.pay_batch(job, [("t1", keys[0].account)])
    with pytest.raises(PatronError) as exc:
        contract.refund(job)
    assert exc.value.code == "ERR_NOT_DUE"
    clock.advance(3_600_001)
    amount = contract.refund(job)
    assert amount == usdc("0.98")
    assert contract.jobs[job].state == "refunded"


def test_conservation_holds_through_the_cycle():
    contract, job, keys, clock = mini()
    for i in range(4):
        contract.pay_batch(job, [(f"t{i}", keys[i % 3].account)])
    contract.record_cost("provider", usdc("0.01"), job_id=job)
    contract.deliver(job, "hash", 4, {})  # commit vide = empreinte de {}
    assert contract.check_invariants() == []
    contract.withdraw(keys[0].account, usdc("0.01"))
    assert contract.check_invariants() == []
    clock.advance(10)
    assert contract.check_invariants() == []


def test_pause_blocks_orders_hires_and_pay():
    contract, job, keys, clock = mini()
    contract.pause("test")
    with pytest.raises(PatronError) as exc:
        contract.hire("nouveau.testnet")
    assert exc.value.code == "ERR_PAUSED"
    with pytest.raises(PatronError) as exc2:
        contract.pay_batch(job, [("t1", keys[0].account)])
    assert exc2.value.code == "ERR_PAUSED"
    with pytest.raises(PatronError) as exc3:
        contract.order("client", usdc("0.10"), n_items=1, deadline_ms=clock.now() + 1000, spec_hash="x")
    assert exc3.value.code == "ERR_PAUSED"