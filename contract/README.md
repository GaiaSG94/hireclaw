# HireclawContract — the NEAR contract of Hireclaw (boss agent)

Smart contract written with `near-sdk` v5, compiled to wasm32 (`target/near/hireclaw_contract.wasm`, 244.4 KB) with standard ABI v0.4.0.

It **strictly** enforces the labor code defined by the owner: wage floor and
ceiling, untouchable reserved margin, daily and per-worker caps, double payment
impossible, public rejection reasons, and firings that must be justified by the
hidden-check counters.

## Code structure

```
contract/
├── Cargo.toml
├── src/
│   ├── lib.rs       # entry point, state, initialization, roll_day, NEP-297 events
│   ├── rules.rs     # configuration struct, bounds validation
│   ├── errors.rs    # normalized error constants (ERR_*)
│   ├── models.rs    # Job, Worker, Entry, Buckets
│   ├── order.rs     # NEP-141 receiver (ft_on_transfer), accept_job, hire
│   ├── payout.rs    # pay_batch (batches of 1 to 10), justified reject, fire
│   ├── payouts.rs   # real cross-contract ft_transfer payouts and storage_deposit
│   ├── settle.rs    # deliver (margin split 60/30/10), refund, record_cost (inference)
│   ├── admin.rs     # pause, resume, set_agent, set_rules, views (get_job, solvency, ledger)
│   └── tests.rs     # 11 VMContextBuilder unit tests
└── integration-tests/
    └── tests/t01_sandbox.rs # full cycle on a real NEAR sandbox
```

## Build and tests

```sh
# Rust unit tests (22 tests, attacks and invariants)
cargo test

# Optimized WASM build + ABI generation
cargo near build non-reproducible-wasm

# NEAR sandbox integration tests (full life cycle)
NEAR_SANDBOX_BIN_PATH=~/.local/near-sandbox/near-sandbox \
  cargo test --manifest-path integration-tests/Cargo.toml --test t01_sandbox
```

## Testnet deployment

```sh
# 1. Create the contract account
near account create-account sponsor-by-faucet-service hireclaw.<your-account>.testnet autogenerate-new-keypair save-to-keychain network-config testnet

# 2. Deploy
near contract deploy hireclaw.<your-account>.testnet \
  use-file target/near/hireclaw_contract.wasm \
  without-init-call network-config testnet

# 3. Initialize
near contract call-function as-transaction hireclaw.<your-account>.testnet new \
  json-args '{"owner":"<owner>.testnet","agent":"<agent>.testnet","token":"usdc.fakes.testnet","rules":null}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  sign-as <owner>.testnet network-config testnet
```

## Public methods (24 functions)

### Orders & Payroll (Agent)
- `ft_on_transfer(sender_id, amount, msg)`: NEP-141 USDC entry point for placing an order.
- `accept_job(job_id, pay_per_task, gold_commit)`: freezes the rate, reserves the minimum margin (15%), computes the payroll budget, anchors the sha256 commit of the check answers.
- `hire(worker)`: registers the worker and sends the `storage_deposit` to the token (paid by the contract).
- `pay_batch(job_id, items, amount)`: pays up to 10 tasks per transaction, checks the 5 safeguards (not settled, not fired, payroll budget, worker cap, daily cap).
- `reject(job_id, task_id, worker, reason, gold)`: publicly records a justified rejection (`minority`, `too_fast`, `gold_wrong`).
- `fire(worker)`: irreversible firing, blocked if the worker has fewer than 5 checks or an accuracy ≥ 60%.
- `deliver(job_id, result_hash, n_validated, gold_reveal)`: verifies the reveal of the checks (`gold_reveal` vs `gold_commit`), splits the margin (60% owner, 30% reserve, 10% contributors).
- `record_cost(provider, amount, job_id)`: pays the agent's inference costs exclusively from the order's reserved margin.

### Gasless relay (the worker never signs a transaction)
- `claim_unpaid(ticket)`: anyone can submit a ticket signed by the agent; the money
  always goes to the beneficiary named in the signature ("silence means payment").
- `withdraw_signed(ticket)`: the worker signs `{amount, deadline_ms, nonce, worker}`
  with their Ed25519 key; a relay submits it. The public key is derived from the
  implicit account identifier (the hex of the key), so no registration is required.
  A unique nonce and a deadline prevent replay; amount and recipient are fixed.

### Client & Workers
- `refund(job_id)`: the client recovers any unspent budget if the deadline has passed without delivery.
- `withdraw(amount)`: a worker or client withdraws their USDC through a cross-contract `ft_transfer`.

### Owner (Governance)
- `pause(reason)` / `resume()`: emergency kill switch.
- `set_agent(agent)`: rotation of the agent key.
- `set_rules(rules)`: update of the labor-code parameters.

### Views (Public)
- `get_job(job_id)`
- `get_worker(account)`
- `get_rules()`
- `get_ledger(from, limit)`
- `get_solvency()`: view of the accounting conservation invariant (`balanced == true`).

- **Repository / testnet gap**: the repository compiles 31 methods; the build deployed on
  `hireclaw.defraie.testnet` exposes 30. The 31st (`promote`, senior status) is covered
  by unit and sandbox tests but is waiting for the next redeployment: the contract
  account has only 0.05 NEAR free left, and a redeployment requires covering the old
  and the new code at the same time. Verifiable: `promote` returns `MethodNotFound` on-chain.

## A NEAR lesson: redeploying does not clear the state

`#[init(ignore_state)]` rewrites the state root, but **not** the collections:
`LookupMap`/`Vector` live under their own storage keys and survive, which produces
an inconsistent hybrid state (a vector of length 0 next to its old entries).
Storage iteration (`storage_iter_prefix`) is also deprecated and refused by the
runtime.

Chosen workaround: **collection prefixes carry the state version**
(`b"j3"`, `b"w3"`, `b"s3"`, `b"m3"`, `b"n3"`…). A redeployment with a new version
therefore starts on fresh keys, hence on empty collections — without having to
delete the account. The old keys remain in storage (minimal cost) but are
unreachable.

## NEP-297 events
The contract emits standard logs for indexing:
- `order`, `hire`, `payroll`, `reject`, `fire`, `deliver`.
