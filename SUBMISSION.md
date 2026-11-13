# Hireclaw — the boss agent

**Pitch.** Hireclaw is an AI that hires humans: it receives an order (label N
product reviews), splits it into micro-tasks, hires anyone with a browser, checks
quality, pays each validated task within seconds in USDC, delivers the result and
keeps a margin. Its labor code — wage floor, wage ceiling, firing, justified
rejections, daily caps — is written in the NEAR contract: the boss is an AI, and it
cannot deviate from these rules.

- Public repository: <https://github.com/GaiaSG94/hireclaw>
- Demo video (2:13, narrated): <https://gaiasg94.github.io/hireclaw/media/demo.mp4>
- Live site, no install: <https://hireclaw-35gv.onrender.com/work> (simulated ledger; kept warm by a scheduled ping, so the first visit is instant)
- No-install scene (static, recorded ledger): <https://gaiasg94.github.io/hireclaw/>
- Contract on NEAR testnet: `hireclaw.defraie.testnet`
- Explorer: <https://testnet.nearblocks.io/address/hireclaw.defraie.testnet>
- Other NEAR HACKATHON project by the same builder (independent): [Dry Run](https://github.com/GaiaSG94/dry-run), track Security

---

## 1. Target track

| Track | Why we claim it |
|---|---|
| agents / Agent Economy | This is the core of the project: an agent that is the *principal*, that hires, checks, pays, rejects and delivers. The other half of the agent economy — the half that produces human work at a machine's request — did not exist as a protocol. Here the agent depends on human recommendations, and those recommendations become a market with prices, checks and recourse, all inside the contract. The agent runs a single-function business on top of it (receive an order, produce a deliverable, collect payment) and all of its business logic — payroll budget, margin, reserves, kill switch — is executed by the contract, not by a spreadsheet, with the financial invariants verified on-chain (`get_solvency` → `balanced: true`). |

---

## 2. The problem

AI teams need human judgment at two moments: when the context is ambiguous
(nuance, sentiment, writing quality, fine-grained visual annotation) and when
automation has failed (taking over from an agent, quality control). Today both
needs go through the classic micro-work platforms, which have three flaws:

- **expensive**: commissions and minimum amounts are calibrated for batches of
  hundreds of dollars, not for tens of cents;
- **slow**: the hiring → validation → pay cycle is counted in days, which is
  incompatible with an agent loop;
- **geographically closed**: workers must belong to specific countries and
  jurisdictions, and payment goes through local rails.

And above all: **none of these platforms was designed for an agent acting as the
principal**. They collect human answers; an agent does not have, and cannot have,
a form. Access to Mechanical Turk can be automated, but the platform cannot be
forced to pay a human within two seconds, nor to guarantee the worker a wage
floor, nor to guarantee the client that a rejection will be justified and public.

That is why **0.02 USDC only makes sense if paying costs almost nothing and
arrives immediately**. At 0.02 USDC per task the margin is quickly gone: half of
the revenue goes into payment fees, and a three-day delay makes the agent loop
impossible. NEAR provides exactly the two missing properties: sub-second
finality, negligible fees, implicit accounts (key creation with no sign-up and no
transaction), and a contract able to carry the labor rules itself.

---

## 3. What is built

### 3.1 The contract (Rust, `near-sdk` v5)

| Item | Value |
|---|---|
| Network | NEAR testnet |
| Contract | `hireclaw.defraie.testnet` |
| Agent | `agent.hireclaw.defraie.testnet` |
| Client | `client.hireclaw.defraie.testnet` |
| Token | `usd.panneau.testnet` (NEP-141, 6 decimals) |
| WASM | 244.4 KB |
| ABI | NEAR 0.4.0, 31 methods in the repository; 30 deployed on testnet (`promote` is waiting for a redeployment, for lack of free NEAR on the contract account) |
| WASM sha256 | `bc2cdcd8be199d5ec1c84944acc8d1f4dbeaf6dd545aaea5fe541fdc88d9b4ca` |

Standards followed: NEP-141 receiver (`ft_on_transfer`), money leaves through a
cross-contract `ft_transfer` with an `on_payout` callback, `storage_deposit` paid
by the contract at hiring time (the worker never needs NEAR), NEP-297 events
(`EVENT_JSON`), NEP-330 metadata.

The contract is not a mock-up: it keeps the books (payroll budget, margin,
buckets), enforces the bounds, refuses the attacks and refuses to pay the same
(task, worker) pair twice.

### 3.2 The agent

Boss loop: serve → judge → pay in batches → hire → fire → deliver. It splits the
order into micro-tasks, computes the payroll budget and the margin before
accepting, and can never pay a task outside the bounds: if it does, the contract
rejects the transaction.

### 3.3 The quality engine

- 20% hidden checks (gold) injected into the flow;
- redundancy 3 on every item;
- majority rule (majority as soon as 2 answers agree);
- the ambiguous item is **paid** (the worker is not charged for the client's
  uncertainty);
- detection of answers that are too fast (under 300 ms on the same button:
  cheating bot detected);
- every rejection is justified and public in the ledger.

### 3.4 The deterministic demo (`make demo`)

| Quantity | Value |
|---|---|
| Order | 1.20 USDC for 12 items |
| Reserved margin | 0.18 USDC |
| Payroll budget | 1.02 USDC |
| Crew | 5 bots: 3 careful (95%), 1 sloppy (60%), 1 cheater (fixed button, 120 ms) |
| Firing | the cheater is fired at 5 checks / 0% |
| Delivery | 12/12 items correct |
| Payroll paid out | 0.98 USDC, i.e. 0.08 USDC per label |
| Margin split | 60% owner / 30% reserve / 10% contributors |
| Invariants | "INVARIANTS OK" |

### 3.5 The site (7 pages)

| Page | Content |
|---|---|
| `/work` | the visitor works and gets paid: Ed25519 key created in the browser, task, signed answer, payment |
| `/boss` | the boss's dashboard: progress, payroll budget, margin, workers, payments, decisions |
| `/ledger` | the ledger and the state of the testnet contract, read live |
| `/demo` | the demo replayed, with the 11 attacks refused |
| `/scene` | the scenario in 15 steps: every actor is a glass sphere, money is a liquid that moves from the client to the contract to the workers; annotated with the real ledger via `GET /api/replay` |
| `/testnet` | addresses, on-chain rules, solvency read from the chain, proof transactions, ABI |
| `/code` | repository inventory, tests, README |

Online: <https://hireclaw-35gv.onrender.com> (all 7 pages, simulated mode). Static scene:
<https://gaiasg94.github.io/hireclaw/>. Locally: `python -m boss.webapp`, then <http://127.0.0.1:8137/work>.

### 3.6 C-F14: the signed work ticket

A work ticket signed by the agent, plus `claim_unpaid(ticket)`: on-chain Ed25519
verification, "pay or reject" delay (`pay_or_reject_seconds`), double claim
impossible, bounds and caps enforced on this path too. If the boss stays silent,
the worker can claim what is owed directly.

---

## 4. The difference: the labor code is in the contract

Most micro-work platforms keep their rules in a database, editable by a human or
by a script. Here the rules are code executed by the chain, and the "boss" is an
AI with no power to make exceptions.

| Rule | Value | Enforced by |
|---|---|---|
| Wage floor per task | 0.02 USDC | contract |
| Wage ceiling per task | 0.10 USDC | contract |
| Daily payroll cap (global) | 20 USDC | contract |
| Cap per worker per day | 2 USDC | contract |
| Minimum margin set aside at acceptance | 15% | contract (guaranteed by construction: the payroll budget is derived from the reserved margin) |
| Task rejection | justified and public | agent, reason written to the ledger |
| Firing a worker | impossible without at least 5 checks and accuracy below 60% | contract (on-chain counters) |
| Claiming pay ("pay or reject") | bounded delay, signed ticket | contract (`claim_unpaid`) |
| Margin split | 60% owner / 30% reserve / 10% contributors | contract |
| Owner kill switch | Yes | owner (the only thing that cannot be overridden: the stop) |
| Payment outside the bounds | refused (`ERR_PAY_BELOW_MIN`, `ERR_PAY_ABOVE_MAX`) | contract |
| Caps exceeded | refused (`ERR_DAILY_CAP`, `ERR_WORKER_CAP`, `ERR_PAYROLL_BUDGET`) | contract |

These constraints also protect **the workers**, and this is the most important
point of the submission:

- the 0.02 USDC floor is guaranteed by the contract, not by the goodwill of the
  principal;
- the cap of 2 USDC per worker per day protects against draining;
- the justified, public rejection gives the worker a documented right to
  contest, instead of a ban with no reason;
- firing requires 5 checks and an accuracy threshold: an agent cannot "drop"
  someone on a single doubt;
- the signed work ticket provides recourse if the agent never pays.

In other words: nobody is asked to trust an intermediary. The rules are written
in the contract, and the boss is the first one bound by them.

---

## 5. Evidence

### 5.1 On-chain

- Contract: `hireclaw.defraie.testnet` — <https://testnet.nearblocks.io/address/hireclaw.defraie.testnet>
- Cycle executed: `mint` → `ft_transfer_call` (1.20 USDC order) → `accept_job` →
  hiring → `pay_batch` ×3 (0.08 USDC each) → `reject` "minority" →
  `deliver` → `withdraw`.
- The worker alice actually received her USDC on her account (`ft_transfer` withdrawal).
- `get_solvency` returns `balanced: true`: 1.20 USDC in custody = 1.20 USDC of liabilities.

The 14 public transactions of the cycle (job-0001), in order:

| # | Step | Transaction |
|---|---|---|
| 1 | `mint 5.00 USDC` — the client mints test USDC for itself (NEP-141 token) | [`3njZ8TizuLWG…`](https://testnet.nearblocks.io/txns/3njZ8TizuLWGVwRyYRssbwJtKqgaa7d9omw7pm6CaBSu) |
| 2 | `ft_transfer_call 1.20 USDC` — the order paid in advance, budget locked by the contract | [`61E1VSzpp1R7…`](https://testnet.nearblocks.io/txns/61E1VSzpp1R7qJDbvKKsEw6qMFCTxWCdKX4uxF5b7UwC) |
| 3 | `accept_job 0.02 USDC/task` — reserved margin 0.18 and payroll budget 1.02 frozen | [`A7GSj3TjCdHJ…`](https://testnet.nearblocks.io/txns/A7GSj3TjCdHJJBSs2x9EvgMRLBDB9GbmHTDqDFdCnTyk) |
| 4 | `hire alice` — hiring: the contract pays the token registration | [`EpuoLSes6Wyz…`](https://testnet.nearblocks.io/txns/EpuoLSes6WyzRDzRuoEvRBembYSECC3UUNRMUqWrHNfk) |
| 5 | `hire bob` — hiring (2nd worker) | [`HXJYw8h4mVn3…`](https://testnet.nearblocks.io/txns/HXJYw8h4mVn3BzrfQLG3D9uet8N9QwgEsbcy9VbtrcSH) |
| 6 | `hire chloe` — hiring (3rd worker) | [`woZbg8NMwuhA…`](https://testnet.nearblocks.io/txns/woZbg8NMwuhAfMjC7GCdJQxRUsKKg5GbEHanXKeoqHi) |
| 7 | `pay_batch alice (4 tasks = 0.08 USDC)` — batch pay for 4 validated tasks | [`2tnSvgDbc8FK…`](https://testnet.nearblocks.io/txns/2tnSvgDbc8FKjop1kpYtje98qhFU4QGW4evdjzPPE9AM) |
| 8 | `pay_batch bob (4 tasks = 0.08 USDC)` — batch pay (2nd worker) | [`DXdog27ZLJSg…`](https://testnet.nearblocks.io/txns/DXdog27ZLJSgSCiyaXNt1NGEpUQiZtphL3Wv8H5Q6Lzd) |
| 9 | `pay_batch chloe (4 tasks = 0.08 USDC)` — batch pay (3rd worker) | [`4a57r1DJmcrg…`](https://testnet.nearblocks.io/txns/4a57r1DJmcrg2itCRyocpAjDTrf2dK7P3hjBoqXKgXeG) |
| 10 | `reject minority` — justified, public rejection (minority answer) | [`9Z9YdcJZe541…`](https://testnet.nearblocks.io/txns/9Z9YdcJZe541U3eVAs4vp7pyLVRdTCsxMjBJeYCpNA93) |
| 11 | `set_agent_key (agent signing key)` — the agent publishes its ticket-signing key | [`9UAEACZGqfUx…`](https://testnet.nearblocks.io/txns/9UAEACZGqfUxA6dpJ55ioMdxUSLZTUDNGcAJJ1pLunwM) |
| 12 | `claim_unpaid (the worker claims their ticket)` — C-F14: silence means payment, signed ticket honored | [`Hmij56VviMDm…`](https://testnet.nearblocks.io/txns/Hmij56VviMDmcBbiCdCFSgCAoGUjpbyRwTDhPEpSGqrm) |
| 13 | `deliver` — delivery, margin split 60/30/10 | [`6xcspUs9KEkK…`](https://testnet.nearblocks.io/txns/6xcspUs9KEkKutETQR9PtSWRiYJRbjs58FgRxNpRzGVj) |
| 14 | `withdraw alice` — the worker cashes out in real USDC | [`aMgRgkYhAzBB…`](https://testnet.nearblocks.io/txns/aMgRgkYhAzBB1XKGd2nDGdDx2krjgVS6RGJ65hPteoK) |

The `testnet-proof.json` file in the repository contains these hashes and the
solvency state, with no secret.

### 5.2 Tests

| Suite | Volume | What it proves |
|---|---|---|
| Python (`make test`) | 47 tests | rules of the simulated contract, quality engine, hidden checks, signed work ticket (C-F14) |
| Rust unit tests (`make test-contract`) | 22 tests (`VMContextBuilder`) | pay bounds, caps, rejections, justified firing, double settlement |
| Integration (`make test-sandbox`) | 1 test on a real NEAR sandbox | full cycle, solvency `balanced: true` |

### 5.3 Eleven attacks refused, with their exact code

| Error code | Attack refused |
|---|---|
| `ERR_PAY_ABOVE_MAX` | paying more than the 0.10 USDC ceiling |
| `ERR_PAY_BELOW_MIN` | paying less than the 0.02 USDC floor |
| `ERR_ALREADY_SETTLED` | paying the same (task, worker) pair twice |
| `ERR_WORKER_FIRED` | paying a fired worker |
| `ERR_NOT_HIRED` | paying someone who was not hired |
| `ERR_PAYROLL_BUDGET` | exceeding the order's payroll budget |
| `ERR_FIRE_NOT_JUSTIFIED` | firing a good worker (insufficient check/accuracy counters) |
| `ERR_WORKER_CAP` | exceeding a worker's cap of 2 USDC/day |
| `ERR_DAILY_CAP` | exceeding the global cap of 20 USDC/day |
| `ERR_PAUSED` | hiring while the kill switch is engaged (×2) |

Ten rows for eleven attacks: `ERR_PAUSED` is refused twice (kill switch engaged
at hiring, then on a second attempt).

---

## 6. Business model (assumption, to be replaced by measurements)

The figures below come from the specification and are a **model assumption**, not
a production measurement. They are stated explicitly as assumptions: the first
thing to do in real conditions is to replace them with the success rates, task
duration and rejection rate observed on real orders.

| Item | Value | Comment |
|---|---|---|
| Sale price per label | 0.12 USDC | price charged to the client |
| Orders | 1,000 labels | monthly volume assumption |
| Revenue | 120 USDC | 1,000 × 0.12 |
| Tasks to perform | 3,750 | redundancy 3 + 20% hidden checks |
| Payroll cost | 75 USDC | 3,750 × 0.02 |
| Gross margin | 45 USDC (37.5%) | 120 − 75 |
| Margin with LLM pre-labeling + senior status | 82.5 USDC (69%) | average redundancy 1.5 instead of 3 |

What the table does not say, and what will have to be measured: the agreement
rate between workers and hidden checks (sets the real redundancy), the rejection
rate (sets the margin), the cost of pre-labeling inference and of the agent's
inference (paid from the margin, capped by the contract).

---

## 7. Five objections, five answers

**1. Quality is judged off-chain, so it is centralized.**
Yes, and it is a deliberate choice: the *grade* of an ambiguous label is a human
or model decision, not a cryptographic truth. What the chain guarantees is the
verifiable part: the pay bounds, the caps, the firing counters, the conservation
of funds, the immutability of justified rejections. Concretely, an agent that
cheats on quality loses its payroll budget and gets fired; it cannot pay above
the ceiling, nor exceed 20 USDC/day, nor make an already-settled worker
disappear. Quality is the only link that is not verifiable, and it is precisely
the one most tightly constrained by the other rules.

**2. Why humans when LLMs can label?**
Because it is not the same work. An LLM labels standard sentiment well; it is
less reliable on ambiguous cases, rare languages, reviews that mention a product
sarcastically, and it has no way to say "I don't know". Yet it is precisely the
ambiguous residue that decides the quality of a model. The human here is not a
cost: it is the hard and rare part of the work, the part that is outsourced to
people. The economic agent is the opposite of a crowdsourced labeling platform:
it hires only for what models do not do well, and it pays in proportion to the
rarity of the task.

**3. Is it fair to the workers?**
This is the question the contract is meant to answer, and we answered it with
constraints, not promises: 0.02 USDC floor guaranteed by the contract, cap of
2 USDC/day per worker, rejections always justified and public, firing impossible
without 5 checks and accuracy below 60%, and `claim_unpaid` to claim a validated
task oneself when the agent stays silent. A worker never needs a wallet, NEAR or
gas: the contract pays their `storage_deposit`. What remains to be proven is the
real pay rate above the floor; that is a measurement, not a promise.

**4. Why NEAR?**
Because the three properties the idea depends on are native here: implicit
accounts (an Ed25519 key is enough, no sign-up, no transaction), negligible fees
(at 0.02 USDC per task, payment fees cannot eat the economics), and an execution
that makes the rules credible. On a chain with high fees and heavy onboarding, a
0.02 USDC wage does not exist. And because a NEAR contract can receive USDC
(NEP-141) and send the money out cross-contract with a callback: the payment and
the work both happen in the same contract.

**5. What about click farms?**
A click farm is an account that cheats on quality; Hireclaw attacks it head-on,
and this is measured in the demo: the cheating bot (answer in 120 ms on the same
button) is caught by the too-fast-answer detection, then pursued by the hidden
checks, and fired at 5 checks / 0%. Firing a legitimate worker, on the other
hand, fails (`ERR_FIRE_NOT_JUSTIFIED`). Cheating does not increase the cheater's
income: the hidden checks and the majority rule carry the quality, and a cheater
loses the job instead of earning money. The structural brake remains the pay
rate: at 0.02 USDC the unit of work is so small that an industrialized farm
cannot live on it, whereas a well-equipped human, in a few minutes, can.

---

## 8. Known limits

- **The offline demo simulates the chain.** `make demo` replays a simulated world
  (simulated clock, micro-USDC balance kept by the simulated contract) so that it
  is deterministic and replayable in under two minutes. The real proof is the
  testnet cycle above, not the demo.
- **The static copy replays a recorded run.** <https://gaiasg94.github.io/hireclaw/>
  has no server behind it: its terminal prints the ledger of a recorded run
  (`web/replay.json`). To work on `/work`, use the hosted site <https://hireclaw-35gv.onrender.com/work>.
- **No meta-transaction for `claim_unpaid`.** The claim still requires the worker
  to send a transaction themselves (with an account funded in NEAR); the full
  implementation of the signed work ticket in a browser wallet is not done.
- **Photo tasks and cross-chain cash-out are not implemented.** The payment
  channel is a single NEP-141 token on NEAR testnet; cash-out to other chains and
  photo tasks (capture, visual check) are out of scope for this version.
- **Solvency is verified on testnet over a single cycle.** `balanced: true` was
  obtained on job-0001; it still has to be replayed over several consecutive
  orders.

---

## 9. Reproduce in 5 commands

```sh
git clone https://github.com/GaiaSG94/hireclaw && cd hireclaw
python3 -m venv .venv && . .venv/bin/activate && pip install -e .

make demo          # the full story offline, deterministic, "INVARIANTS OK"
make attack        # the 11 attacks, refused with their exact code
make test          # 47 Python tests
make test-contract # 22 Rust unit tests (VMContextBuilder)
make testnet-e2e   # full on-chain cycle on NEAR testnet (replayable)
```

`make testnet-e2e` replays the real cycle and rewrites `testnet-proof.json`: you
can check for yourself `get_solvency` → `balanced: true` and the amounts received
by the worker.
