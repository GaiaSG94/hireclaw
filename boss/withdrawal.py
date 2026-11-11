"""Ordre de retrait signé : le travailleur signe, n'importe qui relaie.

Un travailleur n'a jamais de NEAR (son compte implicite est créé dans le
navigateur). Il signe donc un ordre de retrait avec sa clé Ed25519 — la clé dont
l'hexadécimal EST son identifiant de compte — et le site (ou tout autre relais)
dépose la transaction. Le bénéficiaire et le montant sont figés par la signature.
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
        """Mêmes clés, même ordre, mêmes types que le contrat Rust (canonical_withdrawal)."""
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
    """Le travailleur signe son ordre de retrait (compte implicite = sa clé publique)."""
    order = Withdrawal(
        worker=key.account,
        amount=amount,
        nonce=nonce if nonce is not None else int(time.time() * 1000) % 1_000_000,
        deadline_ms=int(time.time() * 1000) + ttl_seconds * 1000,
    )
    return Withdrawal(signature=key.sign(order.payload()), **{k: v for k, v in order.to_dict().items()
                                                             if k != "signature"})


def check(order: Withdrawal) -> bool:
    """Vérification locale (mêmes règles que le contrat) : utile au relais avant d'envoyer."""
    if not is_implicit(order.worker):
        return False
    if order.deadline_ms < int(time.time() * 1000):
        return False
    return verify(order.worker, order.payload(), order.signature)


def is_implicit(account: str) -> bool:
    """Un compte implicite NEAR est exactement l'hexadécimal de sa clé publique."""
    return len(account) == 64 and all(c in "0123456789abcdef" for c in account)
