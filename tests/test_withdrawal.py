"""Retrait signé (C-F14 étendu) : même empreinte canonique en Python et en Rust."""
from __future__ import annotations

import time

import pytest

from boss.keys import Key
from boss.money import usdc
from boss.withdrawal import check, is_implicit, issue
from boss.world import World


def test_implicit_account_is_the_public_key_hex():
    key = Key()
    assert is_implicit(key.account)
    assert key.account == key.pub_hex
    assert not is_implicit("alice.testnet")
    assert not is_implicit("trop-court")


def test_issue_and_check_roundtrip():
    key = Key()
    order = issue(key, usdc("0.02"), nonce=7, ttl_seconds=60)
    assert order.worker == key.account
    assert order.nonce == 7
    assert check(order)


def test_check_rejects_tampered_amount():
    from dataclasses import replace

    key = Key()
    order = issue(key, usdc("0.02"), nonce=7)
    forged = replace(order, amount=usdc("0.10"))
    assert not check(forged)


def test_check_rejects_expired_order():
    key = Key()
    order = issue(key, usdc("0.02"), nonce=7, ttl_seconds=-1)
    assert not check(order)


def test_payload_matches_the_rust_canonical_form():
    """Le contrat signe exactement ces octets : clés triées, séparateurs compacts."""
    from boss.hashing import canonical

    key = Key()
    order = issue(key, 20000, nonce=3, ttl_seconds=60)
    raw = canonical(order.payload()).decode()
    assert raw == ('{"amount":20000,"deadline_ms":%d,"nonce":3,"worker":"%s"}'
                   % (order.deadline_ms, key.account))


def test_python_contract_honours_a_signed_withdrawal():
    """Parité : le contrat Python accepte le bon relayé et débite le solde dû."""
    world = World.create()
    world.run()
    key = world.robots[0].key
    worker = key.account
    due = world.contract.withdrawable.get(worker, 0)
    assert due > 0
    order = issue(key, due, nonce=1)
    assert check(order)
    world.contract.apply_relayed_withdrawal(order, relayer="relais.testnet")
    assert world.contract.withdrawable.get(worker, 0) == 0
    assert world.contract.check_invariants() == []


def test_python_contract_refuses_a_forged_withdrawal():
    from dataclasses import replace

    from boss.errors import PatronError

    world = World.create()
    world.run()
    key = world.robots[0].key
    order = issue(key, world.contract.withdrawable[key.account], nonce=1)
    forged = replace(order, amount=order.amount + 1)
    with pytest.raises(PatronError) as exc:
        world.contract.apply_relayed_withdrawal(forged, relayer="relais.testnet")
    assert exc.value.code == "ERR_BAD_SIGNATURE"
