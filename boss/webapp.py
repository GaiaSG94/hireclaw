"""Site de démo : /work (le visiteur travaille), /boss (tableau), /ledger (registre)."""
from __future__ import annotations

import argparse
import json
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import testnet
from .keys import Key
from .money import fmt, usdc
from .world import World

WEB = Path(__file__).resolve().parent.parent / "web"
PAGE_TTL_S = 0.25


class Live:
    """Un monde qui tourne : les robots alimentent les majorités, le visiteur aide."""

    def __init__(self, seed: int = 11, n_items: int = 12, budget: int = usdc("1.20")) -> None:
        self.lock = threading.RLock()
        self.seed = seed
        self.n_items = n_items
        self.budget = budget
        self.fallback_keys: dict[str, Key] = {}
        self.last_delivery: dict | None = None
        self._new_world()
        threading.Thread(target=self._loop, daemon=True).start()

    # --------------------------------------------------------------- cycle de vie
    def _new_world(self) -> None:
        self.seed += 1
        self.world = World.create(seed=self.seed, n_items=self.n_items, budget=self.budget)
        self.rng = random.Random(self.seed)

    def _loop(self) -> None:
        while True:
            try:
                with self.lock:
                    if len(self.world.agent.engine.labels) >= len(self.world.agent.item_ids):
                        self._close_job()
                    else:
                        self.world._step()
                        self.world.agent.manage()
            except Exception as exc:  # pragma: no cover - garde-fou de démo
                print("boucle :", exc)
            time.sleep(PAGE_TTL_S)

    def _close_job(self) -> None:
        try:
            result = self.world.deliver()
            good, total = self.world.accuracy(result)
            self.last_delivery = {"job": self.world.job_id, "correct": good, "total": total,
                                  "at": time.time()}
        except Exception as exc:  # pragma: no cover
            print("livraison :", exc)
        self._new_world()

    # ------------------------------------------------------------------ visiteur
    def hire(self, account: str) -> None:
        if not account:
            return
        with self.lock:
            contract = self.world.contract
            if account not in contract.workers and contract.paused is False:
                contract.hire(account)
                contract.pubkeys[account] = account  # compte implicite = clé publique
            elif account not in contract.pubkeys:
                contract.pubkeys[account] = account

    def fallback_worker(self) -> dict:
        key = Key()
        self.fallback_keys[key.account] = key
        self.hire(key.account)
        return {"account": key.account, "server_key": True}

    def task(self, account: str) -> dict | None:
        if not account:
            return None
        with self.lock:
            self.hire(account)
            task = self.world.agent.serve(account)
            if task is None:
                return None
            card = self.world.agent.card(task)
            card["pay_usdc"] = self.world.contract.jobs[self.world.job_id].pay_per_task
            return card

    def answer(self, body: dict) -> dict:
        with self.lock:
            account = body.get("worker", "")
            signature = body.get("signature")
            if signature is None:
                key = self.fallback_keys.get(account)
                if key is None:
                    return {"error": "clé inconnue"}
                from .keys import answer_payload

                signature = key.sign(answer_payload(account, body["task_id"],
                                                    body["choice"], int(body["latency_ms"])))
            before = self.world.contract.workers.get(account)
            before_paid = before.tasks_paid if before else 0
            before_ko = before.tasks_rejected if before else 0
            try:
                out = self.world.agent.submit(account, body["task_id"], body["choice"],
                                              int(body["latency_ms"]), signature,
                                              self.world.job_id)
            except Exception as exc:
                return {"error": getattr(exc, "code", str(exc))}
            worker = self.world.contract.get_worker(account)
            if worker["tasks_paid"] > before_paid:
                status, reason = "pay", "validée"
            elif worker["tasks_rejected"] > before_ko:
                status, reason = "reject", self._last_reason(body["task_id"])
            else:
                status, reason = "pending", "en attente d'autres réponses"
            return {"decisions": out["decisions"], "worker": worker,
                    "task_status": status, "reason": reason, "labels": out["labels"]}

    def _last_reason(self, task_id: str) -> str:
        for entry in reversed(self.world.contract.ledger):
            if entry.kind == "reject" and task_id in entry.detail:
                return entry.reason
        return "refusée"

    # ------------------------------------------------------------------- lecture
    def snapshot(self) -> dict:
        with self.lock:
            data = self.world.snapshot()
            data["last_delivery"] = self.last_delivery
            data["visitors"] = len(self.fallback_keys)
            return data

    def rules(self) -> dict:
        with self.lock:
            return self.world.snapshot()["rules"]


class Handler(BaseHTTPRequestHandler):
    live: Live

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/work", "/boss", "/ledger"):
            return self._file("index.html", "text/html; charset=utf-8")
        if parsed.path == "/app.js":
            return self._file("app.js", "text/javascript; charset=utf-8")
        if parsed.path == "/style.css":
            return self._file("style.css", "text/css; charset=utf-8")
        if parsed.path == "/api/state":
            return self._json(self.live.snapshot())
        if parsed.path == "/api/task":
            worker = (parse_qs(parsed.query).get("worker") or [""])[0]
            card = self.live.task(worker)
            return self._json(card or {"empty": True})
        if parsed.path == "/api/testnet":
            return self._json(testnet.state())
        if parsed.path == "/api/worker":
            return self._json(self.live.fallback_worker())
        return self._json({"error": "inconnu"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "json invalide"}, 400)
        if self.path == "/api/answer":
            return self._json(self.live.answer(body))
        if self.path == "/api/worker":
            return self._json(self.live.fallback_worker())
        return self._json({"error": "inconnu"}, 404)

    # -------------------------------------------------------------------- outils
    def _file(self, name: str, ctype: str) -> None:
        path = WEB / name
        if not path.exists():
            return self._json({"error": "fichier absent"}, 404)
        payload = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, data, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt_str: str, *args) -> None:  # silence
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Hireclaw — site de démo")
    parser.add_argument("--port", type=int, default=8137)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)
    Handler.live = Live()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Hireclaw sur http://{args.host}:{args.port}/work  (Ctrl-C pour arrêter)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())