"""Montants en micro-USDC, jamais en flottants."""
from __future__ import annotations

USDC = 1_000_000


def usdc(value: str | float | int) -> int:
    """0.02 -> 20000, sans passer par un float binaire quand c'est une chaîne."""
    if isinstance(value, int):
        return value * USDC
    text = str(value).strip()
    whole, _, frac = text.partition(".")
    frac = (frac + "000000")[:6]
    if not whole.lstrip("-").isdigit() or not frac.isdigit():
        raise ValueError(f"montant invalide : {value!r}")
    sign = -1 if whole.startswith("-") else 1
    return sign * (abs(int(whole)) * USDC + int(frac))


def fmt(amount: int) -> str:
    """20000 -> '0.02' (2 à 6 décimales utiles)."""
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    whole, frac = divmod(amount, USDC)
    text = f"{frac:06d}".rstrip("0")
    return f"{sign}{whole}.{text.ljust(2, '0')}"


def pct_of(amount: int, pct: int, *, round_up: bool = True) -> int:
    """Part en pourcentage, arrondie au micro-USDC près."""
    num = amount * pct
    if round_up:
        return -(-num // 100)
    return num // 100