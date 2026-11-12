"""Amounts in micro-USDC, never in floats."""
from __future__ import annotations

USDC = 1_000_000


def usdc(value: str | float | int) -> int:
    """0.02 -> 20000, without going through a binary float when given a string."""
    if isinstance(value, int):
        return value * USDC
    text = str(value).strip()
    whole, _, frac = text.partition(".")
    frac = (frac + "000000")[:6]
    if not whole.lstrip("-").isdigit() or not frac.isdigit():
        raise ValueError(f"invalid amount: {value!r}")
    sign = -1 if whole.startswith("-") else 1
    return sign * (abs(int(whole)) * USDC + int(frac))


def fmt(amount: int) -> str:
    """20000 -> '0.02' (2 to 6 significant decimals)."""
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    whole, frac = divmod(amount, USDC)
    text = f"{frac:06d}".rstrip("0")
    return f"{sign}{whole}.{text.ljust(2, '0')}"


def pct_of(amount: int, pct: int, *, round_up: bool = True) -> int:
    """Percentage share, rounded to the nearest micro-USDC."""
    num = amount * pct
    if round_up:
        return -(-num // 100)
    return num // 100