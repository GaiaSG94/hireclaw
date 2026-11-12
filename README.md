# Hireclaw — an AI that hires humans

Built for **NEAR HACKATHON** (November 2026). Tracks: Autonomous Business,
Agent Economy.

- **Demo video** (2:13, narrated): <https://gaiasg94.github.io/hireclaw/media/demo.mp4>
- **No install**: the scene, online at <https://gaiasg94.github.io/hireclaw/>

**The product.** An AI agent takes a paid order (label N product reviews), splits
it into micro-tasks, hires anyone who has a key pair, checks the quality, pays
every validated task in USDC within seconds, delivers the result and keeps a
margin.

**The problem.** When the boss is software, who protects the worker? Platforms
answer with terms of service. Hireclaw puts the **labor rules inside a NEAR
smart contract**: pay floor, pay cap, daily caps, a margin set aside before any
work, public reasons for every rejection, dismissal only when counters justify
it. The agent gives orders; the contract holds the money and refuses any order
that breaks a rule. The agent cannot touch the funds.

**How NEAR fits in.** The contract (`contract/`, Rust, `near-sdk` v5) is deployed
on NEAR testnet as `hireclaw.defraie.testnet`. Workers are **implicit accounts**:
a browser-generated Ed25519 key is their account, so there is no wallet, no
sign-up and no gas on their side. The contract pays their token registration
(`storage_deposit`) when the agent hires them, and pays them in a NEP-141 token.

## Try it — do X, see Y

Requirements: Python ≥ 3.10. No secret, no network, no wallet needed for steps 1–5.

```sh
git clone https://github.com/GaiaSG94/hireclaw && cd hireclaw
python3 -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

| # | Do | See |
|---|---|---|
| 1 | `python -m boss.demo` | The full story, offline and deterministic, in under 2 minutes. It ends with `INVARIANTS OK`: 12/12 items delivered, 0.98 USDC paid out of a 1.20 USDC order, the cheater dismissed. |
| 2 | `python -m boss.attack` | 11 attempts by the agent to break the rules (overpay, underpay, pay twice, pay a dismissed worker, exceed a cap, dismiss a good worker…). Each one is refused with its exact `ERR_*` code. |
| 3 | `python -m pytest -q` | `47 passed`. |
| 4 | `python -m boss.webapp` then open <http://127.0.0.1:8137/scene> and click **Run the scenario** | 15 steps, each naming who acts on whom. Every actor is a glass sphere and money is a liquid: it leaves the client, fills the contract, then the workers. The agent's sphere never holds any. Each step shows the matching entry of the real ledger. |
| 5 | Open <http://127.0.0.1:8137/work> and answer a task | Your browser creates a key, you are hired, you label a review, and the task is paid (or rejected with a public reason) on the ledger. `/boss` and `/ledger` show it from the other side. |
| 6 | Open <http://127.0.0.1:8137/testnet> | The deployed contract read live over RPC: rules, solvency, and 14 proof transactions with explorer links. |

`make demo`, `make attack`, `make test` and `make web` are shortcuts for steps 1–4.

**No install:** the scene of step 4 is online at <https://gaiasg94.github.io/hireclaw/>.
It is a static page: its terminal prints the ledger of a recorded run
(`web/replay.json`, regenerate with `make replay-snapshot`) instead of calling the API.
Steps 5 and 6 need the Python server.

## What is real today, and what is not

- **Real, on NEAR testnet.** The contract is deployed and holds real testnet
  tokens. A full cycle was played on-chain — order of 1.20 USDC, job accepted,
  3 workers hired, 3 pay batches, a reasoned rejection, a signed work ticket
  claimed, delivery, and a withdrawal where the worker actually received
  0.16 USDC. The 14 transaction hashes are in `testnet-proof.json`. Replay it
  with `make testnet-e2e` (needs a funded testnet account, see below).
- **Real, in the website.** A visitor really works: key generated in the
  browser, answer signed and verified, quality judged against hidden checks and
  the majority, payment or rejection recorded. When the relay
  (`scripts/relay.mjs`, which holds the agent's testnet key) is running next to
  the site, the same task is also paid on-chain and the visitor gets a
  transaction link and a withdraw button.
- **Simulated.** Without the relay — the default when you clone the repo — the
  site runs against `boss/contract.py`, a Python model of the same rules, and
  payments are entries in a local ledger. The other workers are five scripted
  robots (three careful, one sloppy, one cheater), so that majorities form.
- **Not built.** There is no page for a client to post their own order: the
  site always runs the same 12-review job. The token is a test USDC with open
  minting, not Circle's USDC. Nothing runs on mainnet. The three "use cases" on
  `/scene` change the intro text and the network size only; the amounts played
  are always those of the real 1.20 USDC job.

## The labor rules (`config.yaml`)

| Parameter | Demo value | Enforced by |
|---|---|---|
| `task_pay_usdc.min` / `.max` | 0.02 / 0.10 | contract |
| `payroll_cap_usdc_per_day` | 20 | contract |
| `worker_cap_usdc_per_day` | 2 | contract |
| `min_margin_pct` | 15 | contract (set aside on acceptance) |
| `redundancy` | 3 | agent |
| `gold_share_pct` | 20 | agent |
| `min_golds_before_fire` / `fire_below_accuracy_pct` | 5 / 60 | contract |
| `pay_or_reject_seconds` | 120 | agent |
| `inference_max_spend_usdc_per_day` | 0.50 | contract (paid out of the margin) |
| `revenue_split` | 60/30/10 | contract |
| `kill_switch` | false | owner |

Invariants checked after every run:

- `C-I1` conservation: contract balance = locked payroll + margins + pockets + pending payouts.
- `C-I2` payroll never exceeds the payroll budget; inference is paid out of the margin.
- `C-I3` every payment is between floor and cap; a (task, worker) pair is settled once.
- `C-I4` daily caps, global and per worker.
- `C-I5` no dismissal without the required counters.
- `C-I6` the agent only pays hired workers; the worst case stays bounded by the caps.

## The website: 7 pages

| Page | Content |
|---|---|
| `/scene` | The scenario in 15 steps, playable, with a live terminal printing the real ledger (`GET /api/replay`) |
| `/work` | The visitor works: Ed25519 key in the browser, signed answer, payment or reasoned rejection |
| `/boss` | The boss's board: progress, payroll budget, margin, workers, payments, decisions |
| `/ledger` | The local ledger and a block read live from the testnet contract |
| `/demo` | The deterministic demo replayed on demand: order, crew, dismissals, 11 refused attacks, delivery, invariants |
| `/testnet` | The real contract: addresses, on-chain rules, solvency, 14 proof transactions, ABI, WASM hash |
| `/code` | Repository inventory: files, lines, limits, tests, commit, and this README |

The backend holds no signing key. Visitors' keys stay in their browser, and the
testnet pages only make RPC reads.

### Hosting it

The site is a single Python process with no database.

```sh
docker build -t hireclaw . && docker run -p 8137:8137 hireclaw   # http://localhost:8137/scene
```

`render.yaml` deploys the same image on Render (New → Blueprint → pick this
repository). Hosted this way the site runs in simulated mode, as described above.

## Architecture

| Module | Role |
|---|---|
| `contract/` | The production contract in Rust (`near-sdk` v5): escrow, bounded payroll, dismissals, delivery, ledger events |
| `boss/contract.py` | Python model of the same rules, used by the offline demo and the site |
| `boss/quality.py` | Hidden checks, redundancy, majority, ambiguity, behaviour signals |
| `boss/agent.py` | The boss loop: serve, judge, pay in batches, hire, dismiss, deliver |
| `boss/robots.py` | The client and five simulated workers |
| `boss/world.py` | The whole world with a simulated clock, shared by the demo and the site |
| `boss/webapp.py` | The website and its JSON API |
| `boss/attack.py` | The attack suite, one expected code per attack |
| `boss/chain.py`, `scripts/relay.mjs` | Optional bridge to testnet: the relay signs with the agent key |
| `web/` | The pages; `web/v9-*.js` is the scene (canvas 2D, no dependency) |

Amounts are integers in micro-USDC (`0.02` → `20000`), never floats.
Every file is under 500 lines and every function under 50 lines.

## The NEAR contract

```sh
make test-contract    # 22 unit tests (VMContextBuilder): attacks and rules
make build-contract   # optimised WASM + ABI (target/near/hireclaw_contract.wasm, 244.4 KB)
make test-sandbox     # integration test on a real NEAR sandbox (full cycle)
```

NEAR building blocks used:

- **Implicit accounts** — a worker's account is the hex of their Ed25519 public key.
- **NEP-141** — the contract is a token receiver (`ft_on_transfer`) and pays out
  with a cross-contract `ft_transfer` and an `on_payout` callback.
- **Storage management** — the contract pays the worker's `storage_deposit` on hiring.
- **NEP-297** events (`EVENT_JSON`) and **NEP-330** contract metadata.
- **Standard NEAR ABI** 0.4.0 — 31 methods in this repository.
- **Sub-accounts** — `hireclaw.`, `agent.hireclaw.` and `client.hireclaw.` under one funded account.

More detail in `contract/README.md`.

## Testnet

```sh
make testnet-deploy   # idempotent; FORCE_REDEPLOY=1 to reflash the code
make testnet-e2e      # full on-chain cycle, replayable
```

- Contract: `hireclaw.defraie.testnet` — [explorer](https://testnet.nearblocks.io/address/hireclaw.defraie.testnet)
- Agent: `agent.hireclaw.defraie.testnet` · client: `client.hireclaw.defraie.testnet`
- Token: `usd.panneau.testnet` (NEP-141, 6 decimals, open `mint` for testing)
- Keys live in `~/.near-credentials/testnet/`, never in the repository.
- The public faucet is rate-limited, so accounts are created as sub-accounts of a
  funded account (`HIRECLAW_PARENT` / `HIRECLAW_FUNDER` to change it).

## Known limits

- **Repository vs deployed build.** The repository compiles 31 methods; the build
  deployed on testnet exposes 30. The 31st (`promote`, senior status) is covered
  by unit and sandbox tests but waits for the next redeploy: the contract account
  has too little free NEAR to hold the old and the new code at once. You can
  check it: `promote` returns `MethodNotFound` on-chain.
- `claim_unpaid` is implemented and proven on-chain, but without a
  meta-transaction: the worker sends the transaction or goes through a relay.
- Senior status exists in the contract and the agent, but the demo is too short
  to reach it.
- Photo tasks, dynamic pay and cross-chain cash-out are not implemented.

## Disclosures

- **Code written with AI assistance.** Large parts of this repository were written
  with AI coding agents (Claude Code, opencode) under human direction and review.
- **Dependencies.** Python: `cryptography`, `PyYAML`, `pytest` (dev). Rust:
  `near-sdk` v5 and the crates in `contract/Cargo.lock`. Node (testnet scripts
  only): the packages in `scripts/package.json`. The website has no dependency
  and loads nothing from a CDN.
- **Timeline.** Every commit is dated within the hackathon window.
- **Licence.** MIT, see `LICENSE`.
