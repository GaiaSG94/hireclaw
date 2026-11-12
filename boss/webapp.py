"""Demo site: /work (the visitor works), /boss (dashboard), /ledger (ledger)."""
from __future__ import annotations

import argparse
import json
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import chain, report, withdrawal
from .keys import Key
from .money import fmt, usdc
from .world import World

WEB = Path(__file__).resolve().parent.parent / "web"
SCENE_JS = ("/v7-data.js", "/v9-steps.js", "/v9-engine.js", "/v9-ui.js", "/scene-replay.js", "/scene-term.js")
PAGE_TTL_S = 0.25


class Live:
    """A running world: robots feed the majorities, the visitor helps."""

    def __init__(self, seed: int = 11, n_items: int = 12, budget: int = usdc("1.20")) -> None:
        self.lock = threading.RLock()
        self.seed = seed
        self.n_items = n_items
        self.budget = budget
        self.fallback_keys: dict[str, Key] = {}
        self.hired_on_chain: set[str] = set()
        self.last_tx: dict[str, str] = {}
        # cards served to visitors: the world is not swapped while any is still open
        self.pending_cards: dict[str, float] = {}
        self.chain_job: str | None = chain.site_job() if chain.available() else None
        self.last_delivery: dict | None = None
        self._new_world()
        threading.Thread(target=self._loop, daemon=True).start()

    # --------------------------------------------------------------- lifecycle
    def _new_world(self) -> None:
        self.seed += 1
        self.world = World.create(seed=self.seed, n_items=self.n_items, budget=self.budget)
        self.rng = random.Random(self.seed)

    def _loop(self) -> None:
        while True:
            try:
                with self.lock:
                    if self._job_done() and not self._cards_open():
                        self._close_job()
                    else:
                        self.world._step()
                        self.world.agent.manage()
            except Exception as exc:  # pragma: no cover - demo safety net
                print("loop:", exc)
            time.sleep(PAGE_TTL_S)

    def _job_done(self) -> bool:
        return len(self.world.agent.engine.labels) >= len(self.world.agent.item_ids)

    def _cards_open(self, max_age_s: float = 90.0) -> bool:
        """True if a visitor has a card open: the order is not pulled from under them."""
        now = time.time()
        self.pending_cards = {k: v for k, v in self.pending_cards.items() if now - v < max_age_s}
        return bool(self.pending_cards)

    def _close_job(self) -> None:
        try:
            result = self.world.deliver()
            good, total = self.world.accuracy(result)
            self.last_delivery = {"job": self.world.job_id, "correct": good, "total": total,
                                  "at": time.time()}
        except Exception as exc:  # pragma: no cover
            print("delivery:", exc)
        self._new_world()

    # ------------------------------------------------------------------ visitor
    def hire(self, account: str) -> None:
        if not account:
            return
        if account in self.hired_on_chain:
            return
        with self.lock:
            contract = self.world.contract
            if account not in contract.workers and contract.paused is False:
                contract.hire(account)
                contract.pubkeys[account] = account  # implicit account = public key
            elif account not in contract.pubkeys:
                contract.pubkeys[account] = account
        # The relay registers the worker on chain (the contract pays their storage).
        if not self.chain_job:
            return  # no relay at startup: local mode, nothing to register on chain
        result = chain.hire(account)
        if result.get("ok") or result.get("error") == "ERR_ALREADY_HIRED":
            self.hired_on_chain.add(account)

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
            self.pending_cards[task.id] = time.time()
            return card

    def answer(self, body: dict) -> dict:
        with self.lock:
            account = body.get("worker", "")
            signature = body.get("signature")
            if signature is None:
                key = self.fallback_keys.get(account)
                if key is None:
                    return {"error": "unknown key"}
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
                code = getattr(exc, "code", str(exc))
                if code == "ERR_UNKNOWN_TASK":
                    # the order rolled over while the card was open: a new one will be served
                    self.pending_cards.pop(body.get("task_id", ""), None)
                    return {"retry": True, "reason": "new order"}
                return {"error": code}
            self.pending_cards.pop(body.get("task_id", ""), None)
            worker = self.world.contract.get_worker(account)
            if worker["tasks_paid"] > before_paid:
                status, reason = "pay", "validated"
                tx = self._pay_on_chain(account, body["task_id"])
                if tx:
                    self.last_tx[account] = tx
            elif worker["tasks_rejected"] > before_ko:
                status, reason = "reject", self._last_reason(body["task_id"])
            else:
                status, reason = "pending", "waiting for other answers"
            return {"decisions": out["decisions"], "worker": worker,
                    "task_status": status, "reason": reason, "labels": out["labels"],
                    "chain_tx": self.last_tx.get(account), "chain_job": self.chain_job}

    def _pay_on_chain(self, account: str, task_id: str) -> str | None:
        """The same task is settled on chain: the visitor sees their transaction."""
        if not self.chain_job or not chain.available():
            return None
        item = {"task_id": f"site-{task_id}", "worker": account, "gold": False}
        result = chain.pay(self.chain_job, [item])
        refs = result.get("txs") or ([result["tx"]] if result.get("tx") else [])
        for ref in refs:
            if isinstance(ref, dict):
                return ref.get("tx") or ref.get("url")
            return ref
        return None

    def withdraw(self, body: dict) -> dict:
        """Withdrawal signed by the worker, relayed by the site.

        The browser signs when WebCrypto supports Ed25519; otherwise (fallback key
        generated server-side) the server signs on the visitor's behalf.
        Either way the private key never leaves its holder.
        """
        ticket = body.get("ticket") or {}
        worker = ticket.get("worker") or body.get("worker") or ""
        if not worker:
            return {"ok": False, "error": "ERR_BAD_REQUEST", "detail": "missing worker"}
        if not ticket.get("signature"):
            key = self.fallback_keys.get(worker)
            if key is None:
                return {"ok": False, "error": "ERR_BAD_SIGNATURE",
                        "detail": "sign the order in your browser"}
            due = self.world.contract.withdrawable.get(worker, 0)
            if due <= 0:
                return {"ok": False, "error": "ERR_INSUFFICIENT", "detail": "nothing to withdraw"}
            order = withdrawal.issue(key, due)
            ticket = order.to_dict()
        return chain.withdraw(ticket)

    def _last_reason(self, task_id: str) -> str:
        for entry in reversed(self.world.contract.ledger):
            if entry.kind == "reject" and task_id in entry.detail:
                return entry.reason
        return "rejected"

    # ------------------------------------------------------------------- reads
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
        if parsed.path == "/media/demo.mp4":
            return self._file("../media/demo.mp4", "video/mp4")
        if parsed.path in ("/scene", "/scene.html"):
            return self._file("scene.html", "text/html; charset=utf-8")
        if parsed.path in SCENE_JS:
            return self._file(parsed.path.lstrip("/"), "text/javascript; charset=utf-8")
        if parsed.path == "/v9.css":
            return self._file("v9.css", "text/css; charset=utf-8")
        if parsed.path in ("/", "/work", "/boss", "/ledger", "/demo", "/testnet", "/code", "/video"):
            return self._file("index.html", "text/html; charset=utf-8")
        if parsed.path in ("/app.js", "/views.js"):
            return self._file(parsed.path.lstrip("/"), "text/javascript; charset=utf-8")
        if parsed.path == "/style.css":
            return self._file("style.css", "text/css; charset=utf-8")
        if parsed.path == "/api/state":
            return self._json(self.live.snapshot())
        if parsed.path == "/api/task":
            worker = (parse_qs(parsed.query).get("worker") or [""])[0]
            card = self.live.task(worker)
            return self._json(card or {"empty": True})
        if parsed.path == "/api/chain":
            return self._json(chain.chain_state())
        if parsed.path == "/api/replay":
            return self._json(report.replay_report())
        if parsed.path == "/api/testnet":
            return self._json(report.testnet_report())
        if parsed.path == "/api/demo":
            return self._json(report.demo_report())
        if parsed.path == "/api/code":
            return self._json(report.code_report())
        if parsed.path == "/api/readme":
            return self._json({"text": report.readme_text()})
        if parsed.path == "/api/worker":
            return self._json(self.live.fallback_worker())
        return self._json({"error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._json({"error": "invalid json"}, 400)
        if self.path == "/api/answer":
            return self._json(self.live.answer(body))
        if self.path == "/api/worker":
            return self._json(self.live.fallback_worker())
        if self.path == "/api/withdraw":
            return self._json(self.live.withdraw(body))
        return self._json({"error": "not found"}, 404)

    # -------------------------------------------------------------------- helpers
    def _file(self, name: str, ctype: str) -> None:
        path = (WEB / name).resolve()
        if not str(path).startswith(str(WEB.parent.resolve())):
            return self._json({"error": "path refused"}, 400)
        if not path.exists():
            return self._json({"error": "file not found"}, 404)
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
    parser = argparse.ArgumentParser(description="Hireclaw — demo site")
    parser.add_argument("--port", type=int, default=8137)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)
    Handler.live = Live()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Hireclaw on http://{args.host}:{args.port}/work  (Ctrl-C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())