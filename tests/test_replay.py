"""Le rejeu servi par /api/replay : registre annoté, cohérent avec la démo."""
from boss import report


def test_replay_annote_le_registre():
    data = report._replay_report()
    events = data["events"]
    assert events, "le registre ne doit pas être vide"
    assert [e["seq"] for e in events] == sorted(e["seq"] for e in events)
    assert all("stage" in e and "fx" in e and "who" in e for e in events)
    fx = {e["fx"] for e in events}
    assert {"order", "margin", "hire", "pay", "fire", "deliver", "split"} <= fx


def test_replay_refus_distingues_par_motif():
    events = report._replay_report()["events"]
    rejects = [e for e in events if e["kind"] == "reject"]
    assert any(e["fx"] == "fast" and "too_fast" in e["reason"] for e in rejects)
    assert any(e["fx"] == "minority" and "minority" in e["reason"] for e in rejects)
    assert all(e["fx"] is None for e in rejects
               if "too_fast" not in e["reason"] and "minority" not in e["reason"])


def test_replay_solvable_et_renvoi_au_registre():
    data = report._replay_report()
    assert data["solvency"]["balanced"] is True
    assert data["invariants"] == ["OK"]
    assert data["fired"] == ["eli"]
    assert all(a["ok"] for a in data["attacks"])
    assert data["job"]["budget"] == 1_200_000
