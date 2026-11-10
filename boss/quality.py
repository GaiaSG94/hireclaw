"""Moteur de qualité : contrôles cachés, redondance, majorité, ambiguïté, signaux."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

from .config import Rules
from .errors import PatronError


@dataclass
class Task:
    id: str
    item_id: str
    worker: str
    is_gold: bool
    opened_ms: int


@dataclass
class Answer:
    task_id: str
    worker: str
    choice: str
    latency_ms: int
    decided: bool = False


@dataclass
class Decision:
    task_id: str
    item_id: str
    worker: str
    action: str  # pay | reject
    reason: str
    gold: bool = False


@dataclass
class QualityEngine:
    items: list
    rules: Rules
    rng: Any
    gold_ids: set[str]
    tasks: dict[str, Task] = field(default_factory=dict)
    answers: dict[str, list[Answer]] = field(default_factory=lambda: defaultdict(list))
    open_tasks: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    labels: dict[str, str] = field(default_factory=dict)
    golds_served: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    choices_seen: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))
    answered: set[tuple[str, str]] = field(default_factory=set)
    signals: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    served_gold: set[tuple[str, str]] = field(default_factory=set)
    _n: int = 0
    _gold_cursor: int = 0

    def __post_init__(self) -> None:
        self.by_id = {item.id: item for item in self.items}
        self.gold_items = [i for i in self.items if i.id in self.gold_ids]
        self.real_items = [i for i in self.items if i.id not in self.gold_ids]

    # ------------------------------------------------------------------ service
    def serve(self, worker: str, now_ms: int = 0, allow_gold: bool = True) -> Task | None:
        self._n += 1
        task = None
        if allow_gold and self._wants_gold(worker):
            item = self._pick_gold(worker)
            if item is not None:
                task = Task(f"t{self._n:05d}", item.id, worker, True, now_ms)
                self.golds_served[worker] += 1
                self.served_gold.add((item.id, worker))
        if task is None:
            item = self._pick_real(worker)
            if item is not None:
                task = Task(f"t{self._n:05d}", item.id, worker, False, now_ms)
                self.open_tasks[item.id] += 1
            elif allow_gold:
                item = self._pick_gold(worker)
                if item is None:
                    return None
                task = Task(f"t{self._n:05d}", item.id, worker, True, now_ms)
                self.golds_served[worker] += 1
                self.served_gold.add((item.id, worker))
            else:
                return None
        self.tasks[task.id] = task
        return task

    def _wants_gold(self, worker: str) -> bool:
        if self.golds_served[worker] < 2:  # période d'essai : deux contrôles payés
            return True
        if self.signals[worker] >= 2:  # on contrôle davantage celui dont on doute
            return True
        return self._n % 5 == 0  # une tâche sur cinq

    def _pick_gold(self, worker: str):
        for _ in range(len(self.gold_items)):
            item = self.gold_items[self._gold_cursor % len(self.gold_items)]
            self._gold_cursor += 1
            if (item.id, worker) not in self.served_gold:
                return item
        return None

    def _pick_real(self, worker: str):
        limit = self.rules.redundancy + 2
        candidates = [
            i for i in self.real_items
            if self.open_tasks[i.id] < limit
            and (i.id, worker) not in self.answered
            and i.id not in self.labels
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda i: (self.open_tasks[i.id], i.id))
        pool = candidates[: max(1, len(candidates) // 2)]
        return self.rng.choice(pool)

    def card(self, task: Task, deadline_s: int = 120) -> dict:
        item = self.by_id[task.item_id]
        return {
            "task_id": task.id,
            "item_id": item.id,
            "text": item.text,
            "choices": list(item.choices),
            "is_gold_hint": None,  # jamais exposé : les contrôles sont cachés
            "deadline_ms": task.opened_ms + deadline_s * 1000,
        }

    # ------------------------------------------------------------------ réponses
    def submit(self, worker: str, task_id: str, choice: str, latency_ms: int,
               signature_ok: bool) -> list[Decision]:
        task = self.tasks.get(task_id)
        if task is None or task.worker != worker:
            raise PatronError("ERR_UNKNOWN_TASK", task_id)
        if not signature_ok:
            raise PatronError("ERR_BAD_SIGNATURE", worker)
        if choice not in self.by_id[task.item_id].choices:
            raise PatronError("ERR_BAD_ORDER", f"choix inconnu : {choice}")
        self.choices_seen[worker].append(choice)
        if self._too_fast(worker, latency_ms):
            self.signals[worker] += 1
            return [Decision(task_id, task.item_id, worker, "reject", "too_fast", task.is_gold)]
        if task.is_gold:
            return [self._judge_gold(task, choice)]
        self.answers[task.item_id].append(Answer(task_id, worker, choice, latency_ms))
        self.answered.add((task.item_id, worker))
        self.open_tasks[task.item_id] = max(0, self.open_tasks[task.item_id] - 1)
        return self._tally(task.item_id)

    def _too_fast(self, worker: str, latency_ms: int) -> bool:
        history = self.choices_seen[worker]
        return latency_ms < 300 and len(history) >= 3 and len(set(history)) == 1

    def _judge_gold(self, task: Task, choice: str) -> Decision:
        expected = self.by_id[task.item_id].gold
        ok = choice == expected
        return Decision(task.id, task.item_id, task.worker, "pay" if ok else "reject",
                        "gold_ok" if ok else "gold_wrong", True)

    def _tally(self, item_id: str) -> list[Decision]:
        pending = [a for a in self.answers[item_id] if not a.decided]
        if len(pending) < self.rules.redundancy:
            return []
        counts = Counter(a.choice for a in pending)
        best, votes = counts.most_common(1)[0]
        decisions: list[Decision] = []
        if votes * 2 > len(pending):
            for answer in pending:
                winner = answer.choice == best
                decisions.append(Decision(
                    answer.task_id, item_id, answer.worker,
                    "pay" if winner else "reject",
                    "majority" if winner else "minority",
                ))
                answer.decided = True
            self.labels[item_id] = best
        elif len(pending) >= 5:
            for answer in pending:
                decisions.append(Decision(answer.task_id, item_id, answer.worker, "pay", "ambiguous"))
                answer.decided = True
            self.labels[item_id] = best  # le plus fréquent, marqué ambigu
        return decisions

    # ------------------------------------------------------------------- lecture
    @property
    def validated(self) -> dict[str, str]:
        return dict(sorted(self.labels.items()))

    def pending_count(self, item_id: str) -> int:
        return sum(1 for a in self.answers[item_id] if not a.decided)