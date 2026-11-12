"""Ed25519 keys: a worker exists with a plain key pair (implicit account)."""
from __future__ import annotations

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .hashing import canonical


class Key:
    """NEAR implicit account = hex of the public key (64 characters)."""

    def __init__(self, private: Ed25519PrivateKey | None = None) -> None:
        self._private = private or Ed25519PrivateKey.generate()
        raw = self._private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        self.pub_hex = raw.hex()
        self.account = self.pub_hex

    def sign(self, payload: dict) -> str:
        return self._private.sign(canonical(payload)).hex()


def verify(pub_hex: str, payload: dict, signature_hex: str) -> bool:
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex))
        key.verify(bytes.fromhex(signature_hex), canonical(payload))
        return True
    except (InvalidSignature, ValueError):
        return False


def answer_payload(worker: str, task_id: str, choice: str, latency_ms: int) -> dict:
    return {"worker": worker, "task_id": task_id, "choice": choice, "latency_ms": int(latency_ms)}