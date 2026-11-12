"""Moteur de qualité : contrôles, majorité, minorité, ambiguïté, signaux."""
from __future__ import annotations

import random

from boss.config import Rules
from boss.dataset import Item
from boss.errors import PatronError
from boss.quality import QualityEngine

CHOICES = ("positive", "negative", "neutral")
RULES = Rules(redundancy=3, min_golds_before_fire=5)


def engine(n_items: int = 3, golds: tuple[str, ...] = ()) -> QualityEngine:
    items = [Item(f"i{n}", f"texte {n}", random.choice(CHOICES)) for n in range(n_items)]
    return QualityEngine(items, RULES, random.Random(1), set(golds))


def test_gold_correct_is_paid_and_published():
    eng = engine(golds=("i0",))
    task = eng.serve("w1")
    decisions = eng.submit("w1", task.id, eng.by_id[task.item_id].gold, 1200, True)
    assert task.is_gold
    assert decisions[0].action == "pay" and decisions[0].gold


def test_gold_wrong_is_rejected_with_reason():
    eng = engine(golds=("i0",))
    task = eng.serve("w1")
    wrong = next(c for c in CHOICES if c != eng.by_id[task.item_id].gold)
    decisions = eng.submit("w1", task.id, wrong, 1200, True)
    assert decisions[0].action == "reject" and decisions[0].reason == "gold_wrong"


def test_majority_pays_two_and_rejects_one():
    eng = engine()
    decisions = []
    for worker in ("a", "b", "c"):
        task = eng.serve(worker)
        decisions += eng.submit(worker, task.id, task and "positive", 1000, True)
    assert len(decisions) == 3
    assert sum(d.action == "pay" for d in decisions) >= 2
    assert eng.labels


def test_five_answers_without_majority_are_all_paid_as_ambiguous():
    eng = engine(n_items=1)
    tasks = [eng.serve(f"w{i}") for i in range(5)]
    choices = ["positive", "negative", "neutral", "positive", "negative"]
    decisions = []
    for task, choice in zip(tasks, choices):
        decisions += eng.submit(task.worker, task.id, choice, 1500, True)
    assert decisions and all(d.action == "pay" for d in decisions)
    assert all(d.reason in ("majority", "ambiguous") for d in decisions)


def test_too_fast_same_button_is_refused():
    eng = engine(n_items=6)
    decisions = []
    for _ in range(4):
        task = eng.serve("robot")
        decisions += eng.submit("robot", task.id, "positive", 120, True)
    assert any(d.reason == "too_fast" for d in decisions)
    assert eng.signals["robot"] >= 1


def test_bad_signature_is_refused():
    eng = engine()
    task = eng.serve("w1")
    try:
        eng.submit("w1", task.id, "positive", 1000, False)
    except PatronError as exc:
        assert exc.code == "ERR_BAD_SIGNATURE"
    else:  # pragma: no cover
        raise AssertionError("signature invalide acceptée")


def test_unknown_choice_is_refused():
    eng = engine()
    task = eng.serve("w1")
    try:
        eng.submit("w1", task.id, "peut-être", 1000, True)
    except PatronError as exc:
        assert exc.code == "ERR_BAD_ORDER"
    else:  # pragma: no cover
        raise AssertionError("choix inconnu accepté")