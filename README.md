# Hireclaw — l'agent-patron

Une IA qui embauche des humains. Elle reçoit une commande (étiqueter N avis), la
découpe en micro-tâches, embauche quiconque a une paire de clés, contrôle la
qualité, paie chaque tâche validée en quelques secondes, livre le résultat et
garde une marge. **Le code du travail est écrit dans le contrat** : salaire
plancher, plafond, délais, motifs de refus publics, plafonds journaliers.

Spécification : `C-agent-patron.md` (cahier des charges du hackathon NEAR).

## Démarrage

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -e .

make demo     # l'histoire complète, hors ligne, < 2 min, « INVARIANTS OK »
make attack   # chaque refus du contrat, avec son code
make test     # 24 tests
make web      # http://127.0.0.1:8137/work
```

Aucun secret, aucun réseau : la démo est déterministe (graine fixe), les clés
Ed25519 sont générées localement, le « jeton USDC » est un solde en micro-USDC
tenu par le contrat.

## Ce que `make demo` prouve

1. Le client paie 1,20 USDC d'avance ; le contrat bloque le budget, réserve la
   marge (0,18) et fixe le budget de paie (1,02).
2. Cinq robots sont embauchés — l'inscription au jeton est payée par le contrat,
   le travailleur n'envoie aucune transaction.
3. Les deux premières tâches de chacun sont des contrôles (essai payé), puis une
   tâche sur cinq. Redondance 3, majorité dès 2 réponses concordantes, minorité
   refusée (`minority`), élément ambigu payé (`ambiguous`), réponse en moins de
   300 ms toujours sur le même bouton refusée (`too_fast`).
4. Les paiements partent par lots de 10 ; chaque refus est motivé et public.
5. Le tricheur atteint 5 contrôles à 0 % : le contrat accepte son renvoi. Une
   tentative de renvoi d'un bon travailleur échoue (`ERR_FIRE_NOT_JUSTIFIED`).
6. Onze attaques sont refusées avec leur code exact (bornes, double paiement,
   plafonds, pause, budget de paie).
7. Livraison : 12/12 éléments corrects face aux réponses de référence, paie
   versée 0,98 USDC (≤ budget de paie), marge ventilée 60/30/10, conservation
   vérifiée (`INVARIANTS OK`).
8. Le coupe-circuit bloque l'embauche (`ERR_PAUSED`).

## Architecture

| Module | Rôle |
|---|---|
| `boss/contract.py` | état, budgets, paie bornée, renvois, livraison, registre, invariants |
| `boss/quality.py` | contrôles cachés, redondance, majorité, ambiguïté, signaux de comportement |
| `boss/agent.py` | boucle du patron : servir, juger, payer par lots, embaucher, renvoyer, livrer |
| `boss/robots.py` | client et cinq travailleurs simulés (3 soigneux, 1 brouillon, 1 tricheur) |
| `boss/world.py` | monde complet, horloge simulée, partagé par la démo et le site |
| `boss/webapp.py` | `/work`, `/boss`, `/ledger` et l'API de tâches |
| `boss/attack.py` | la suite d'attaques, code attendu par code |
| `web/` | page unique : carte de travail, tableau du patron, registre |

Montants : entiers en micro-USDC (`0.02` → `20000`), jamais de flottants.
Fichiers < 500 lignes, fonctions < 50 lignes.

## Le code du travail (`config.yaml`)

| Paramètre | Démo | Appliqué par |
|---|---|---|
| `task_pay_usdc.min` / `.max` | 0.02 / 0.10 | contrat |
| `payroll_cap_usdc_per_day` | 20 | contrat |
| `worker_cap_usdc_per_day` | 2 | contrat |
| `min_margin_pct` | 15 | contrat (mise de côté à l'acceptation) |
| `redundancy` | 3 | agent |
| `gold_share_pct` | 20 | agent |
| `min_golds_before_fire` / `fire_below_accuracy_pct` | 5 / 60 | contrat |
| `pay_or_reject_seconds` | 120 | agent |
| `inference_max_spend_usdc_per_day` | 0.50 | contrat (payée sur la marge) |
| `revenue_split` | 60/30/10 | contrat |
| `kill_switch` | false | propriétaire |

## Invariants vérifiés

- `C-I1` conservation : solde du contrat = paies bloquées + marges + poches + versements en attente.
- `C-I2` la paie ne dépasse jamais le budget de paie ; l'inférence est payée sur la marge.
- `C-I3` tout paiement est entre plancher et plafond ; un couple (tâche, travailleur) est réglé une seule fois.
- `C-I4` plafonds journaliers, global et par travailleur.
- `C-I5` aucun renvoi sans les compteurs requis.
- `C-I6` l'agent ne paie que des travailleurs embauchés ; le pire cas reste borné par les plafonds.

## Le site : tout le projet en six pages

| Page | Contenu |
|---|---|
| `/work` | Le visiteur travaille : clé Ed25519 dans le navigateur, réponse signée, **payé on-chain** (lien de transaction), bouton de retrait relayé |
| `/boss` | Le tableau du patron : avancement, budget de paie, marge, travailleurs, paiements, décisions |
| `/ledger` | Le registre local **et** un bloc lu en direct du contrat testnet |
| `/demo` | La démo déterministe rejouée à la demande : commande, équipage, renvois, **11 attaques refusées**, livraison, invariants |
| `/testnet` | Le contrat réel : adresses, règles on-chain, solvabilité lue sur la chaîne, **14 transactions de preuve**, ABI (31 méthodes), empreinte du WASM |
| `/code` | L'inventaire du dépôt : fichiers, lignes, limites respectées, tests, commit, et le README intégral |

URL publique (tunnel Cloudflare, `make public-url` pour l'afficher) :
`/work` est la page d'entrée. Le backend ne détient aucune clé de signature :
les clés des visiteurs restent dans leur navigateur, et les pages testnet ne font
que des lectures RPC.

`/work` crée une paire de clés dans le navigateur (WebCrypto Ed25519 ; si le
navigateur ne le supporte pas, une clé de secours est générée côté serveur et
l'interface le dit). La réponse est signée, le compte implicite est le
hexadécimal de la clé publique : aucune inscription, aucune transaction côté
travailleur. `/boss` montre l'avancement, le budget de paie, les travailleurs et
le fil des paiements ; `/ledger` publie les règles en vigueur et tout le registre.

Les robots tournent en fond pour que les majorités se forment ; une commande
livrée est immédiatement remplacée par la suivante.

## Contrat NEAR en Rust (aux normes)

Le smart contract de production est écrit en Rust avec `near-sdk` v5 dans `contract/` :

```sh
make test-contract   # 11 tests unitaires VMContextBuilder (attaques et règles)
make build-contract  # build WASM optimisé + ABI (target/near/hireclaw_contract.wasm, 244.4 Ko)
make test-sandbox   # test d'intégration sur sandbox NEAR réel (cycle complet)
```

- **Standards respectés** : NEP-141 receiver (`ft_on_transfer`), sortie cross-contract `ft_transfer` avec callback `on_payout`, `storage_deposit` payé par le contrat à l'embauche pour les comptes implicites, NEP-297 pour les événements (`EVENT_JSON`), NEP-330 metadata, ABI standard NEAR 0.4.0 (31 méthodes).
- **Règles de code** : 100 % des fichiers < 500 lignes (max 294 l `tests.rs`), 100 % des fonctions < 50 lignes (vérifié par scanner).
- Documentation détaillée du contrat dans `contract/README.md`.

## Testnet (réel, vérifiable)

```sh
make testnet-deploy   # idempotent ; FORCE_REDEPLOY=1 pour reflasher le code
make testnet-e2e      # cycle complet on-chain, rejouable (job-000N suivant)
make serve-public     # services systemd + tunnel public
make public-url       # affiche l'URL publique et l'état des services
```

- Contrat : `hireclaw.defraie.testnet` — [explorateur](https://testnet.nearblocks.io/address/hireclaw.defraie.testnet)
- Agent : `agent.hireclaw.defraie.testnet` · client : `client.hireclaw.defraie.testnet`
- Jeton : `usd.panneau.testnet` (NEP-141, 6 décimales, `mint` ouvert pour le test)
- Le cycle joué : `mint` → `ft_transfer_call` (commande 1,20 USDC) → `accept_job`
  (marge 0,18 / paie 1,02) → `hire` × 3 → `pay_batch` × 3 → `reject minority` →
  `deliver` (marge 60/30/10) → `withdraw` (**0,16 USDC réellement reçus** par la
  travailleuse) → `get_solvency` : `balanced: true`.
- Les hachages de transaction sont dans `testnet-proof.json` (public, sans secret).
- Le faucet public est limité (HTTP 429) : les comptes sont créés comme
  sous-comptes d'un compte financé, `HIRECLAW_PARENT` / `HIRECLAW_FUNDER` pour changer.
- Clés : `~/.near-credentials/testnet/`, jamais dans le dépôt.

## Limites connues

- **Décalage dépôt / testnet** : le dépôt compile 31 méthodes ; le build déployé sur
  `hireclaw.defraie.testnet` en expose 30. La 31ᵉ (`promote`, statut senior) est testée
  en unitaire et sur sandbox mais attend le prochain redéploiement : le compte contrat
  n'a plus que 0,05 NEAR libre et un redéploiement exige de couvrir l'ancien et le
  nouveau code simultanément. Vérifiable : `promote` renvoie `MethodNotFound` on-chain.

- `claim_unpaid` est implémenté et prouvé on-chain, mais sans méta-transaction :
  le travailleur doit envoyer lui-même la transaction (ou passer par un relais).
- L'engagement sur les contrôles est vérifié par empreinte (`ERR_GOLD_MISMATCH`)
  dans la démo et sur testnet.
- Le statut senior existe dans le contrat et l'agent, mais la démo ne dure pas
  assez longtemps pour l'atteindre.
- Tâches photo, paie dynamique et encaissement inter-chaînes : non implémentés
  (V1/MAX).