"""Read-only access to the contract deployed on testnet: what /ledger shows is real.

No key, no transaction: only `call_function` queries with `finality: final`
on the public RPC. The `testnet-deployment.json` file (written by
`scripts/deploy-testnet.mjs`) gives the contract address.
"""
from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEPLOYMENT = ROOT / "testnet-deployment.json"
RPC = "https://rpc.testnet.fastnear.com"
EXPLORER = "https://testnet.nearblocks.io"
CACHE_S = 5

_cache: dict[str, Any] = {"at": 0.0, "data": None}


def deployment() -> dict | None:
    if not DEPLOYMENT.exists():
        return None
    return json.loads(DEPLOYMENT.read_text(encoding="utf-8"))


def view(contract: str, method: str, args: dict | None = None, *, rpc: str = RPC) -> Any:
    """A NEAR view call, with no external dependency."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "query",
        "params": {
            "request_type": "call_function",
            "finality": "final",
            "account_id": contract,
            "method_name": method,
            "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode(),
        },
    }
    request = urllib.request.Request(
        rpc, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read().decode())
    result = body.get("result", {})
    if result.get("error"):
        raise RuntimeError(f"{method}: {result['error']}")
    raw = bytes(result.get("result", [])).decode()
    return json.loads(raw) if raw else None


def _safe(contract: str, method: str, args: dict | None = None) -> Any:
    try:
        return view(contract, method, args)
    except (RuntimeError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {"error": str(exc)[:200]}


def state() -> dict:
    """Real state of the testnet contract, cached for 5 seconds."""
    info = deployment()
    if not info:
        return {"available": False, "reason": "testnet-deployment.json missing: run make testnet-deploy"}
    now = time.time()
    if _cache["data"] and now - _cache["at"] < CACHE_S:
        return _cache["data"]
    contract = info["contract"]
    data = {
        "available": True,
        "network": info.get("network", "testnet"),
        "contract": contract,
        "agent": info.get("agent"),
        "client": info.get("client"),
        "token": info.get("token"),
        "explorer": f"{EXPLORER}/address/{contract}",
        "deployed_at": info.get("deployed_at"),
        "wasm_sha256": info.get("wasm_sha256"),
        "rules": _safe(contract, "get_rules"),
        "solvency": _safe(contract, "get_solvency"),
        "ledger": _safe(contract, "get_ledger", {"from": 0, "limit": 25}),
        "job": _safe(contract, "get_job", {"job_id": "job-0001"}),
        "workers": [_safe(contract, "get_worker", {"account": f"{n}.{contract}"})
                    for n in ("alice", "bob", "chloe")],
    }
    _cache.update(at=now, data=data)
    return data