# HireclawContract — contrat NEAR de Hireclaw (agent-patron)

Smart contract écrit avec `near-sdk` v5, compilé en wasm32 (`target/near/hireclaw_contract.wasm`, 237.9 Ko) avec ABI standard v0.4.0.

Applique **strictement** le code du travail défini par le propriétaire :
salaires plancher/plafond, marge réservée intouchable, plafonds journaliers
et par travailleur, double-paiement impossible, motifs de refus publics et
renvois obligatoirement justifiés par les compteurs de contrôles cachés.

## Structure du code

```
contract/
├── Cargo.toml
├── src/
│   ├── lib.rs       # point d'entrée, état, initialisation, roll_day, events NEP-297
│   ├── rules.rs     # structure de configuration, validation des bornes
│   ├── errors.rs    # constantes d'erreur normalisées (ERR_*)
│   ├── models.rs    # Job, Worker, Entry, Buckets
│   ├── order.rs     # NEP-141 receiver (ft_on_transfer), accept_job, hire
│   ├── payout.rs    # pay_batch (lots de 1 à 10), reject motivé, fire
│   ├── payouts.rs   # sorties réelles ft_transfer cross-contract et storage_deposit
│   ├── settle.rs    # deliver (marge split 60/30/10), refund, record_cost (inférence)
│   ├── admin.rs     # pause, resume, set_agent, set_rules, views (get_job, solvency, ledger)
│   └── tests.rs     # 11 tests unitaires VMContextBuilder
└── integration-tests/
    └── tests/t01_sandbox.rs # cycle complet sur sandbox NEAR réel
```

## Compilation et tests

```sh
# Tests unitaires Rust (11 tests, attaques et invariants)
cargo test

# Build WASM optimisé + génération ABI
cargo near build non-reproducible-wasm

# Tests d'intégration sandbox NEAR (cycle complet de vie)
NEAR_SANDBOX_BIN_PATH=~/.local/near-sandbox/near-sandbox \
  cargo test --manifest-path integration-tests/Cargo.toml --test t01_sandbox
```

## Déploiement testnet

```sh
# 1. Créer le compte du contrat
near account create-account sponsor-by-faucet-service hireclaw.<ton-compte>.testnet autogenerate-new-keypair save-to-keychain network-config testnet

# 2. Déployer
near contract deploy hireclaw.<ton-compte>.testnet \
  use-file target/near/hireclaw_contract.wasm \
  without-init-call network-config testnet

# 3. Initialiser
near contract call-function as-transaction hireclaw.<ton-compte>.testnet new \
  json-args '{"owner":"<owner>.testnet","agent":"<agent>.testnet","token":"usdc.fakes.testnet","rules":null}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  sign-as <owner>.testnet network-config testnet
```

## Méthodes publiques (24 fonctions)

### Commandes & Paie (Agent)
- `ft_on_transfer(sender_id, amount, msg)` : point d'entrée NEP-141 USDC pour passer une commande.
- `accept_job(job_id, pay_per_task, gold_commit)` : fige le tarif, réserve la marge minimale (15 %), calcule le budget de paie, ancre le commit sha256 des réponses de contrôle.
- `hire(worker)` : inscrit le travailleur et envoie le `storage_deposit` au jeton (payé par le contrat).
- `pay_batch(job_id, items, amount)` : paie jusqu'à 10 tâches par transaction, vérifie les 5 garde-fous (non réglé, non renvoyé, budget de paie, plafond travailleur, plafond jour).
- `reject(job_id, task_id, worker, reason, gold)` : enregistre publiquement un refus motivé (`minority`, `too_fast`, `gold_wrong`).
- `fire(worker)` : renvoi irréversible, bloqué si le travailleur a moins de 5 contrôles ou une exactitude ≥ 60 %.
- `deliver(job_id, result_hash, n_validated, gold_reveal)` : vérifie la révélation des contrôles (`gold_reveal` vs `gold_commit`), ventile la marge (60 % propriétaire, 30 % réserve, 10 % contributeurs).
- `record_cost(provider, amount, job_id)` : paie les coûts d'inférence de l'agent exclusivement sur la marge réservée de la commande.

### Client & Travailleurs
- `refund(job_id)` : le client récupère tout budget non dépensé si l'échéance est passée sans livraison.
- `withdraw(amount)` : travailleur ou client retire ses USDC par cross-contract `ft_transfer`.

### Propriétaire (Gouvernance)
- `pause(reason)` / `resume()` : coupe-circuit d'urgence.
- `set_agent(agent)` : rotation de la clé de l'agent.
- `set_rules(rules)` : mise à jour des paramètres du code du travail.

### Lectures (Publiques)
- `get_job(job_id)`
- `get_worker(account)`
- `get_rules()`
- `get_ledger(from, limit)`
- `get_solvency()` : vue de l'invariant de conservation comptable (`balanced == true`).

## Événements NEP-297
Le contrat émet des logs standards pour l'indexation :
- `order`, `hire`, `payroll`, `reject`, `fire`, `deliver`.