"""Statut senior (C-F15) : la promotion est gagnée par les compteurs, jamais offerte."""
from __future__ import annotations

from boss.attack import mini
from boss.model import ACTIVE, SENIOR, TRIAL


def pay_golds(contract, job, worker, count, start=0):
    """Paie `count` tâches de contrôle réussies (une par une, bornes respectées)."""
    for i in range(start, start + count):
        contract.pay_batch(job, [(f"gold-{i}", worker, True)])


def test_worker_starts_in_trial():
    contract, job, keys, _ = mini()
    assert contract.get_worker(keys[0].account)["status"] == TRIAL


def test_two_good_golds_make_a_worker_active():
    contract, job, keys, _ = mini()
    worker = keys[0].account
    pay_golds(contract, job, worker, 2)
    contract.promote(worker)
    assert contract.get_worker(worker)["status"] == ACTIVE


def test_one_gold_is_not_enough_for_active():
    contract, job, keys, _ = mini()
    worker = keys[0].account
    pay_golds(contract, job, worker, 1)
    contract.promote(worker)
    assert contract.get_worker(worker)["status"] == TRIAL


def test_senior_needs_twenty_golds_at_95_percent():
    contract, job, keys, _ = mini()
    worker = keys[0].account
    pay_golds(contract, job, worker, 20)
    contract.promote(worker)  # Trial -> Active
    contract.promote(worker)  # Active -> Senior
    record = contract.get_worker(worker)
    assert record["status"] == SENIOR
    assert record["golds"] == 20
    assert record["accuracy_pct"] == 100
    assert contract.check_invariants() == []


def test_nineteen_golds_do_not_make_a_senior():
    contract, job, keys, _ = mini()
    worker = keys[0].account
    pay_golds(contract, job, worker, 19)
    contract.promote(worker)
    contract.promote(worker)
    assert contract.get_worker(worker)["status"] == ACTIVE


def test_95_percent_is_the_exact_senior_threshold():
    """19 contrôles réussis sur 20 = 95 % : le seuil est atteint, la promotion passe."""
    contract, job, keys, _ = mini()
    worker = keys[0].account
    pay_golds(contract, job, worker, 19)
    contract.reject(job, "gold-ko", worker, "gold_wrong", gold=True)
    contract.promote(worker)
    contract.promote(worker)
    record = contract.get_worker(worker)
    assert record["golds"] == 20
    assert record["accuracy_pct"] == 95
    assert record["status"] == SENIOR


def test_two_rejected_golds_block_seniority():
    """18/20 = 90 % : sous le seuil, la promotion est refusée."""
    contract, job, keys, _ = mini()
    worker = keys[0].account
    pay_golds(contract, job, worker, 18)
    contract.reject(job, "ko-1", worker, "gold_wrong", gold=True)
    contract.reject(job, "ko-2", worker, "gold_wrong", gold=True)
    contract.promote(worker)
    contract.promote(worker)
    record = contract.get_worker(worker)
    assert record["golds"] == 20
    assert record["accuracy_pct"] == 90
    assert record["status"] == ACTIVE


def test_fired_worker_is_never_promoted():
    from boss.model import FIRED

    contract, job, keys, _ = mini()
    worker = keys[0].account
    for i in range(5):
        contract.reject(job, f"ko-{i}", worker, "gold_wrong", gold=True)
    contract.fire(worker)
    assert contract.get_worker(worker)["status"] == FIRED
    contract.promote(worker)
    assert contract.get_worker(worker)["status"] == FIRED
