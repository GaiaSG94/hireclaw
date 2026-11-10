"""Tests du bon de travail signé et de `claim_unpaid` (C-F14)."""
from __future__ import annotations

import pytest

from boss.errors import PatronError
from boss.keys import Key
from boss.money import usdc
from boss.ticket import issue
from boss.world import World


def world_ready() -> World:
    w = World.create()
    return w


def test_claim_unpaid_happy_path():
    w = world_ready()
    worker = w.robots[0].key.account
    ticket = issue(w.agent_key, w.job_id, "task-unpaid-1", worker, usdc("0.02"),
                   "le silence vaut paiement", w.clock.now())
    # Avant l'échéance : refusé
    with pytest.raises(PatronError) as exc:
        w.contract.claim_unpaid(ticket, actor=worker)
    assert exc.value.code == "ERR_NOT_DUE"

    # Après le délai (120 s) : payé par le contrat
    w.clock.advance(125_000)
    paid = w.contract.claim_unpaid(ticket, actor=worker)
    assert paid == usdc("0.02")
    assert w.contract.get_worker(worker)["tasks_paid"] == 1
    assert w.contract.withdrawable[worker] == usdc("0.02")
    assert w.contract.check_invariants() == []


def test_claim_unpaid_refuses_tampered_signature():
    w = world_ready()
    worker = w.robots[0].key.account
    other_key = Key()
    fake = issue(other_key, w.job_id, "task-tampered", worker, usdc("0.02"), "faux", w.clock.now())
    w.clock.advance(125_000)
    with pytest.raises(PatronError) as exc:
        w.contract.claim_unpaid(fake, actor=worker)
    assert exc.value.code == "ERR_BAD_SIGNATURE"


def test_claim_unpaid_refuses_double_claim_or_settled_task():
    w = world_ready()
    worker = w.robots[0].key.account
    ticket = issue(w.agent_key, w.job_id, "task-once", worker, usdc("0.02"), "ok", w.clock.now())
    w.clock.advance(125_000)
    w.contract.claim_unpaid(ticket, actor=worker)
    # Deuxième présentation du même bon
    with pytest.raises(PatronError) as exc:
        w.contract.claim_unpaid(ticket, actor=worker)
    assert exc.value.code == "ERR_ALREADY_SETTLED"


def test_claim_unpaid_refuses_wrong_actor():
    w = world_ready()
    worker = w.robots[0].key.account
    imposter = w.robots[1].key.account
    ticket = issue(w.agent_key, w.job_id, "task-actor", worker, usdc("0.02"), "ok", w.clock.now())
    w.clock.advance(125_000)
    with pytest.raises(PatronError) as exc:
        w.contract.claim_unpaid(ticket, actor=imposter)
    assert exc.value.code == "ERR_NOT_AGENT"


def test_claim_unpaid_respects_payroll_budget():
    w = world_ready()
    worker = w.robots[0].key.account
    # Bon qui dépasse le budget restant
    huge = issue(w.agent_key, w.job_id, "task-huge", worker, usdc("0.10"), "trop cher", w.clock.now())
    # consommer le budget
    job = w.contract.jobs[w.job_id]
    job.payroll_spent = job.payroll_budget - usdc("0.01")
    w.clock.advance(125_000)
    with pytest.raises(PatronError) as exc:
        w.contract.claim_unpaid(huge, actor=worker)
    assert exc.value.code == "ERR_PAYROLL_BUDGET"