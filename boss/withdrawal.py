"""Signed withdrawal order: the worker signs, anyone can relay.

A worker never holds NEAR (their implicit account is created in the
browser). So they sign a withdrawal order with their Ed25519 key — the key whose
hex IS their account id — and the site (or any other relay)
submits the transaction. The recipient and the amount are frozen by the signature.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from .hashing import sha256_hex
from .keys import Key, verify


@dataclass(frozen=True)
class Withdrawal:
    worker: str
    amount: int
    nonce: int
    deadline_ms: int
    signature: str = ""

    def payload(self) -> dict:
        """Same keys, same order, same types as the Rust contract (canonical_withdrawal)."""
        return {
            "amount": self.amount,
            "deadline_ms": self.deadline_ms,
            "nonce": self.nonce,
            "worker": self.worker,
        }

    @property
    def digest(self) -> str:
        return sha256_hex(self.payload())

    def to_dict(self) -> dict:
        data = self.payload()
        data["signature"] = self.signature
        return data


def issue(key: Key, amount: int, *, nonce: int | None = None, ttl_seconds: int = 120) -> Withdrawal:
    """The worker signs their withdrawal order (implicit account = their public key)."""
    order = Withdrawal(
        worker=key.account,
        amount=amount,
        nonce=nonce if nonce is not None else int(time.time() * 1000) % 1_000_000,
        deadline_ms=int(time.time() * 1000) + ttl_seconds * 1000,
    )
    return Withdrawal(signature=key.sign(order.payload()), **{k: v for k, v in order.to_dict().items()
                                                             if k != "signature"})


def check(order: Withdrawal) -> bool:
    """Local check (same rules as the contract): handy for the relay before sending."""
    if not is_implicit(order.worker):
        return False
    if order.deadline_ms < int(time.time() * 1000):
        return False
    return verify(order.worker, order.payload(), order.signature)


def is_implicit(account: str) -> bool:
    """A NEAR implicit account is exactly the hex of its public key."""
    return len(account) == 64 and all(c in "0123456789abcdef" for c in account)
