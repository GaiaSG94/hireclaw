# Hireclaw — l'agent-patron

**Pitch.** Hireclaw est une IA qui embauche des humains : elle reçoit une commande
(étiqueter N avis de produits), la découpe en micro-tâches, embauche n'importe qui a
un navigateur, contrôle la qualité, paie chaque tâche validée en quelques secondes en
USDC, livre le résultat et garde une marge. Son code du travail — salaire plancher,
plafond, renvoi, refus motivés, plafonds journaliers — est écrit dans le contrat
NEAR : le patron est une IA, il ne peut pas déroger à ces règles.

- Dépôt public : <https://github.com/BaptisteFaisy/hireclaw>
- Contrat sur NEAR testnet : `hireclaw.defraie.testnet`
- Explorateur : <https://testnet.nearblocks.io/address/hireclaw.defraie.testnet>

---

## 1. Tracks visés

| Track | Pourquoi nous y claimons |
|---|---|
| business / Autonomous Business | L'agent est une entreprise à une seule fonction : recevoir une commande, produire un livrable, encaisser. Toute la logique d'entreprise (budget de paie, marge, réserves, clés d'arrêt) est exécutée par un contrat, pas par une feuille de calcul : c'est une activité autonome avec ses invariants financiers vérifiés (`get_solvency` → `balanced: true`). |
| realworld / Real-World Money | Les règles sont écrites en USDC et appliquées en USDC, sans intermédiaire : le client avance 1,20 USDC, le contrat bloque la paie et la marge, le travailleur reçoit 0,08 USDC par tâche, le reste est ventilé 60/30/10. L'argent du travail et les conditions du travail sont le même objet on-chain. |
| agents / Agent Economy | C'est le cœur du projet : un agent qui est *donneur d'ordre*, qui embauche, qui contrôle, qui paie, qui refuse, qui livre. L'autre moitié de l'économie des agents — celle qui produit le travail humain à la demande d'une machine — n'existait pas comme protocole. Ici, l'agent est dépendant de recommandations humaines, et ces recommandations deviennent un marché avec des prix, des contrôles et des recours, le tout dans le contrat. |

---

## 2. Le problème

Les équipes d'IA ont besoin d'un jugement humain à deux moments : quand le
contexte est ambigu (nuance, sentiment, qualité rédactionnelle, annotation
visuelle fine) et quand l'automatisation a échoué (relève d'un agent, contrôle
qualité). Ces deux besoins passent aujourd'hui par les plateformes de
micro-travail classiques, qui ont trois défauts :

- **coûteuses** : les commissionnements et les montants minimums sont calibrés
  pour des lots de centaines de dollars, pas pour des dizaines de centimes ;
- **lentes** : le cycle embossage → validation → paie se compte en jours, ce qui est
  incompatible avec une boucle agent ;
- **géographiquement fermées** : les travailleurs doivent appartenir à des pays et
  à des juridictions précises, et le paiement passe par des rails locaux.

Et surtout : **aucune de ces plateformes n'a été pensée pour un agent donneur
d'ordre**. Elles collectent des réponses humaines ; un agent n'a ni ne peut avoir
de formulaire. On peut automatiser l'accès à Mechanical Turk, mais on ne peut pas
contraindre la plateforme à payer un humain en deux secondes, ni garantir au
travailleur un plancher de salaire, ni garantir au client qu'un refus sera motivé
et public.

C'est pourquoi **0,02 USDC n'a de sens que si payer ne coûte presque rien et
arrive tout de suite**. À 0,02 USDC la tâche, la marge est vite faite : la
moitié du revenu part dans les frais de paiement, et un délai de trois jours
rend la boucle agent impossible. NEAR donne exactement les deux propriétés
manquantes : finalité sub-seconde, frais négligeables, comptes implicites
(création de clé sans inscription ni transaction), et un contrat capable de
porter les règles du travail lui-même.

---

## 3. Ce qui est construit

### 3.1 Le contrat (Rust, `near-sdk` v5)

| Élément | Valeur |
|---|---|
| Réseau | NEAR testnet |
| Contrat | `hireclaw.defraie.testnet` |
| Agent | `agent.hireclaw.defraie.testnet` |
| Client | `client.hireclaw.defraie.testnet` |
| Jeton | `usd.panneau.testnet` (NEP-141, 6 décimales) |
| WASM | 214 Ko |
| ABI | NEAR 0.4.0, 31 méthodes dans le dépôt ; 30 déployées sur testnet (`promote` attend un redéploiement, faute de NEAR libre sur le compte contrat) |
| sha256 du WASM | `bc2cdcd8be199d5ec1c84944acc8d1f4dbeaf6dd545aaea5fe541fdc88d9b4ca` |

Standards respectés : récepteur NEP-141 (`ft_on_transfer`), sortie d'argent en
cross-contract `ft_transfer` avec callback `on_payout`, `storage_deposit` payé par
le contrat à l'embauche (le travailleur n'a jamais besoin de NEAR), événements
NEP-297 (`EVENT_JSON`), metadata NEP-330.

Le contrat n'est pas une maquette : il tient les comptes (budget de paie, marge,
poches), applique les bornes, refuse les attaques et refuse de payer deux fois la
même paire (tâche, travailleur).

### 3.2 L'agent

Boucle de patron : servir → juger → payer par lots → embaucher → renvoyer →
livrer. Il découpe la commande en micro-tâches, calcule le budget de paie et la
marge avant d'accepter, et ne peut jamais payer une tâche hors bornes : s'il le
fait, le contrat rejette la transaction.

### 3.3 Le moteur de qualité

- 20 % de contrôles cachés (gold) injectés dans le flux ;
- redondance 3 sur chaque élément ;
- règle de majorité (majorité dès 2 réponses concordantes) ;
- l'élément ambigu est **payé** (on ne paie pas l'incertitude du client) ;
- détection des réponses trop rapides (moins de 300 ms sur le même bouton : robot
  tricheur détecté) ;
- chaque refus est motivé et public dans le registre.

### 3.4 La démonstration déterministe (`make demo`)

| Grandeur | Valeur |
|---|---|
| Commande | 1,20 USDC pour 12 éléments |
| Marge réservée | 0,18 USDC |
| Budget de paie | 1,02 USDC |
| Équipage | 5 robots : 3 soigneux (95 %), 1 brouillon (60 %), 1 tricheur (bouton fixe, 120 ms) |
| Renvoi | le tricheur est renvoyé à 5 contrôles / 0 % |
| Livraison | 12/12 éléments corrects |
| Paie versée | 0,98 USDC, soit 0,08 USDC par étiquette |
| Marge ventilée | 60 % propriétaire / 30 % réserve / 10 % contributeurs |
| Invariants | « INVARIANTS OK » |

### 3.5 Le site (6 pages)

| Page | Contenu |
|---|---|
| `/work` | le visiteur travaille et est payé : clé Ed25519 créée dans le navigateur, tâche, réponse signée, paiement |
| `/boss` | le tableau du patron : avancement, budget de paie, marge, travailleurs, paiements, décisions |
| `/ledger` | le registre et l'état du contrat testnet lu en direct |
| `/demo` | la démo rejouée, avec les 11 attaques refusées |
| `/testnet` | adresses, règles on-chain, solvabilité lue sur la chaîne, transactions de preuve, ABI |
| `/code` | inventaire du dépôt, tests, README |

URL : `http://100.120.194.92:8137/work` (tailnet stable) et
`https://beijing-gave-locking-examine.trycloudflare.com/work` (tunnel Cloudflare
public temporaire).

### 3.6 C-F14 : le bon de travail signé

Un bon de travail signé par l'agent, plus `claim_unpaid(ticket)` : vérification
Ed25519 on-chain, délai « payer ou refuser » (`pay_or_reject_seconds`), double
réclamation impossible, bornes et plafonds appliqués même dans ce chemin. Si le
patron se tait, le travailleur peut réclamer lui-même ce qui lui est dû.

---

## 4. La différence : le code du travail est dans le contrat

La plupart des plateformes de micro-travail ont des règles dans une base de
données, modifiables par un humain ou par un script. Ici, les règles sont du code
exécuté par la chaîne, et le « patron » est une IA qui n'a aucun pouvoir
d'exception.

| Règle | Valeur | Qui l'applique |
|---|---|---|
| Salaire plancher par tâche | 0,02 USDC | contrat |
| Salaire plafond par tâche | 0,10 USDC | contrat |
| Plafond de paie journalier (global) | 20 USDC | contrat |
| Plafond par travailleur et par jour | 2 USDC | contrat |
| Marge minimale mise de côté à l'acceptation | 15 % | contrat (garantie par construction : le budget de paie est dérivé de la marge réservée) |
| Refus de tâche | motivé et public | agent, motif inscrit au registre |
| Renvoi d'un travailleur | impossible sans au moins 5 contrôles et sous 60 % d'exactitude | contrat (compteurs on-chain) |
| Réclamation de la paie (« payer ou refuser ») | délai borné, ticket signé | contrat (`claim_unpaid`) |
| Répartition de la marge | 60 % propriétaire / 30 % réserve / 10 % contributeurs | contrat |
| Coupe-circuit du propriétaire |Oui | propriétaire (seule chose non dérogable : l'arrêt) |
| Paiement hors bornes | refusé (`ERR_PAY_BELOW_MIN`, `ERR_PAY_ABOVE_MAX`) | contrat |
| Plafonds dépassés | refusé (`ERR_DAILY_CAP`, `ERR_WORKER_CAP`, `ERR_PAYROLL_BUDGET`) | contrat |

Ces contraintes protègent aussi **les travailleurs**, et c'est le point le plus
important du dossier :

- le plancher de 0,02 USDC est garanti par le contrat, pas par la bonne volonté du
  donneur d'ordre ;
- le plafond de 2 USDC par travailleur et par jour protège des drainages ;
- le refus motivé et public donne au travailleur un droit de contestation
  documenté, au lieu d'un bannissement sans motif ;
- le renvoi exige 5 contrôles et un seuil d'exactitude : un agent ne peut pas
  « désengager » quelqu'un sur un seul doute ;
- le bon de travail signé donne un recours si l'agent ne paie jamais.

Autrement dit : on ne demande pas la confiance à un intermédiaire. On écrit les
règles dans le contrat, et le patron est le premier soumis.

---

## 5. Preuves

### 5.1 Sur la chaîne

- Contrat : `hireclaw.defraie.testnet` — <https://testnet.nearblocks.io/address/hireclaw.defraie.testnet>
- Cycle joué : `mint` → `ft_transfer_call` (commande 1,20 USDC) → `accept_job` →
  embauche → `pay_batch` ×3 (0,08 USDC chacun) → `reject` « minority » →
  `deliver` → `withdraw`.
- La travailleuse alice a réellement reçu ses USDC sur son compte (retrait `ft_transfer`).
- `get_solvency` renvoie `balanced: true` : 1,20 USDC en garde = 1,20 USDC d'engagements.

Les 14 transactions publiques du cycle (job-0001), dans l'ordre :

| # | Étape | Transaction |
|---|---|---|
| 1 | `mint 5.00 USDC` — le client se minte des USDC de test (jeton NEP-141) | [`3njZ8TizuLWG…`](https://testnet.nearblocks.io/txns/3njZ8TizuLWGVwRyYRssbwJtKqgaa7d9omw7pm6CaBSu) |
| 2 | `ft_transfer_call 1.20 USDC` — la commande payée d'avance, budget bloqué par le contrat | [`61E1VSzpp1R7…`](https://testnet.nearblocks.io/txns/61E1VSzpp1R7qJDbvKKsEw6qMFCTxWCdKX4uxF5b7UwC) |
| 3 | `accept_job 0.02 USDC/tâche` — marge réservée 0,18 et budget de paie 1,02 figés | [`A7GSj3TjCdHJ…`](https://testnet.nearblocks.io/txns/A7GSj3TjCdHJJBSs2x9EvgMRLBDB9GbmHTDqDFdCnTyk) |
| 4 | `hire alice` — embauche : le contrat paie l'inscription au jeton | [`EpuoLSes6Wyz…`](https://testnet.nearblocks.io/txns/EpuoLSes6WyzRDzRuoEvRBembYSECC3UUNRMUqWrHNfk) |
| 5 | `hire bob` — embauche (2e travailleur) | [`HXJYw8h4mVn3…`](https://testnet.nearblocks.io/txns/HXJYw8h4mVn3BzrfQLG3D9uet8N9QwgEsbcy9VbtrcSH) |
| 6 | `hire chloe` — embauche (3e travailleur) | [`woZbg8NMwuhA…`](https://testnet.nearblocks.io/txns/woZbg8NMwuhAfMjC7GCdJQxRUsKKg5GbEHanXKeoqHi) |
| 7 | `pay_batch alice (4 tâches = 0.08 USDC)` — paie par lot de 4 tâches validées | [`2tnSvgDbc8FK…`](https://testnet.nearblocks.io/txns/2tnSvgDbc8FKjop1kpYtje98qhFU4QGW4evdjzPPE9AM) |
| 8 | `pay_batch bob (4 tâches = 0.08 USDC)` — paie par lot (2e travailleur) | [`DXdog27ZLJSg…`](https://testnet.nearblocks.io/txns/DXdog27ZLJSgSCiyaXNt1NGEpUQiZtphL3Wv8H5Q6Lzd) |
| 9 | `pay_batch chloe (4 tâches = 0.08 USDC)` — paie par lot (3e travailleur) | [`4a57r1DJmcrg…`](https://testnet.nearblocks.io/txns/4a57r1DJmcrg2itCRyocpAjDTrf2dK7P3hjBoqXKgXeG) |
| 10 | `reject minority` — refus motivé et public (réponse minoritaire) | [`9Z9YdcJZe541…`](https://testnet.nearblocks.io/txns/9Z9YdcJZe541U3eVAs4vp7pyLVRdTCsxMjBJeYCpNA93) |
| 11 | `set_agent_key (clé de signature de l'agent)` — l'agent publie sa clé de signature de bons | [`9UAEACZGqfUx…`](https://testnet.nearblocks.io/txns/9UAEACZGqfUxA6dpJ55ioMdxUSLZTUDNGcAJJ1pLunwM) |
| 12 | `claim_unpaid (le travailleur réclame son bon)` — C-F14 : le silence vaut paiement, bon signé honoré | [`Hmij56VviMDm…`](https://testnet.nearblocks.io/txns/Hmij56VviMDmcBbiCdCFSgCAoGUjpbyRwTDhPEpSGqrm) |
| 13 | `deliver` — livraison, marge ventilée 60/30/10 | [`6xcspUs9KEkK…`](https://testnet.nearblocks.io/txns/6xcspUs9KEkKutETQR9PtSWRiYJRbjs58FgRxNpRzGVj) |
| 14 | `withdraw alice` — la travailleuse encaisse en USDC réels | [`aMgRgkYhAzBB…`](https://testnet.nearblocks.io/txns/aMgRgkYhAzBB1XKGd2nDGdDx2krjgVS6RGJ65hPteoK) |

Le fichier `testnet-proof.json` du dépôt contient ces hachages et l'état de
solvabilité, sans aucun secret.

### 5.2 Tests

| Suite | Volume | Ce qu'elle prouve |
|---|---|---|
| Python (`make test`) | 47 tests | règles du contrat simulé, moteur de qualité, contrôles cachés, bon de travail signé (C-F14) |
| Rust unitaires (`make test-contract`) | 22 tests (`VMContextBuilder`) | bornes de paie, plafonds, refus, renvoi justifié, double règlement |
| Intégration (`make test-sandbox`) | 1 test sur sandbox NEAR réel | cycle complet, solvabilité `balanced: true` |

### 5.3 Onze attaques refusées, avec leur code exact

| Code d'erreur | Attaque refusée |
|---|---|
| `ERR_PAY_ABOVE_MAX` | payer plus que le plafond de 0,10 USDC |
| `ERR_PAY_BELOW_MIN` | payer moins que le plancher de 0,02 USDC |
| `ERR_ALREADY_SETTLED` | payer deux fois la même paire (tâche, travailleur) |
| `ERR_WORKER_FIRED` | payer un travailleur renvoyé |
| `ERR_NOT_HIRED` | payer quelqu'un qui n'a pas été embauché |
| `ERR_PAYROLL_BUDGET` | dépasser le budget de paie de la commande |
| `ERR_FIRE_NOT_JUSTIFIED` | renvoyer un bon travailleur (compteurs de contrôles/exactitude insuffisants) |
| `ERR_WORKER_CAP` | dépasser le plafond de 2 USDC/jour d'un travailleur |
| `ERR_DAILY_CAP` | dépasser le plafond global de 20 USDC/jour |
| `ERR_PAUSED` | embaucher alors que le coupe-circuit est fermé (×2) |

Dix lignes pour onze attaques : `ERR_PAUSED` est refusée deux fois (coupe-circuit
fermé à l'embauche, puis à une seconde tentative).

---

## 6. Modèle économique (hypothèse, à remplacer par des mesures)

Les chiffres ci-dessous viennent du cahier des charges et sont une **hypothèse de
modèle**, pas une mesure de production. Ils sont posés explicitement comme
hypothèses : la première chose à faire en conditions réelles est de les remplacer
par les taux de succès, la durée de tâche et le taux de refus observés sur des
commandes réelles.

| Poste | Valeur | Commentaire |
|---|---|---|
| Prix de vente par étiquette | 0,12 USDC | prix de vente au client |
| Commandes | 1 000 étiquettes | hypothèse de volume mensuel |
| Chiffre d'affaires | 120 USDC | 1 000 × 0,12 |
| Tâches à réaliser | 3 750 | redondance 3 + 20 % de contrôles cachés |
| Coût de la paie | 75 USDC | 3 750 × 0,02 |
| Marge brute | 44 USDC (37 %) | 120 − 75 |
| Marge avec pré-étiquetage LLM + statut senior | 81 USDC (68 %) | redondance moyenne 1,5 au lieu de 3 |

Ce que la table ne dit pas, et qui devra être mesuré : le taux d'accord entre
travailleurs et contrôleurs cachés (fixe la redondance réelle), le taux de
rejet (fixe la marge), le coût d'inférence pré-étiquetage et d'inférence de
l'agent (payé sur la marge, plafonné par le contrat).

---

## 7. Cinq objections, cinq réponses

**1. La qualité est jugée hors chaîne, donc c'est centralisé.**
Oui, et c'est un choix assumé : la *note* d'une étiquette ambiguë est une décision
humaine ou modèle, pas une vérité cryptographique. Ce que la chaîne garantit,
c'est la partie vérifiable : les bornes de paie, les plafonds, les compteurs de
renvoi, la conservation des fonds, l'immuabilité des refus motivés. Concrètement,
un agent qui triche sur la qualité perd son budget de paie et se fait renvoyer ; il
ne peut pas payer au-dessus du plafond, ni dépasser 20 USDC/jour, ni escamoter un
travailleur déjà réglé. La qualité est le seul maillon non vérifiable, et c'est
précisément celui qui est le mieux contraint par les autres règles.

**2. Pourquoi des humains alors que les LLM étiquettent ?**
Parce que ce n'est pas le même travail. Un LLM étiquette bien le sentiment
standard ; il est moins fiable sur les cas ambigus, les langues rares, les
critiques qui citent un produit par sarcasme, et il n'a aucun moyen de dire
« je ne sais pas ». Or c'est précisément le résidu ambigu qui décide de la
qualité d'un modèle. L'humain, ici, n'est pas un coût : c'est la partie difficile
et rare du travail, celle qu'on sous-traite à des gens. L'agent économique est
l'inverse d'une plateforme de label crowdsourcing : il n'embauche que pour ce que
les modèles ne font pas bien, et il paie proportionnellement à la rareté de la
tâche.

**3. Est-ce correct vis-à-vis des travailleurs ?**
C'est la question à laquelle le contrat est censé répondre, et nous y avons
répondu par des contraintes, pas par des promesses : plancher de 0,02 USDC garanti
par le contrat, plafond de 2 USDC/jour par travailleur, refus toujours motivés et
publics, renvoi impossible sans 5 contrôles et sous 60 % d'exactitude, et
`claim_unpaid` pour réclamer soi-même une tâche validée quand l'agent se tait. Un
travailleur n'a jamais besoin de wallet, de NEAR ni de gas : le contrat paie son
`storage_deposit`. Ce qui reste à prouver, c'est le taux de rémunération réel
au-dessus du plancher ; c'est une mesure, pas une promesse.

**4. Pourquoi NEAR ?**
Parce que les trois propriétés dont l'idée dépend sont natives ici : des comptes
implicites (une clé Ed25519 suffit, aucune inscription, aucune transaction), des
frais négligeables (à 0,02 USDC la tâche, les frais de paiement ne peuvent pas
manger l'économie), et une exécution qui rend les règles crédibles. Sur une
chaîne à frais élevés et à onboarding lourd, un salaire de 0,02 USDC n'existe pas.
Et parce qu'un contrat NEAR peut recevoir l'USDC (NEP-141) et sortir l'argent
en cross-contract avec callback : le paiement comme le travail se passent dans le
même contrat.

**5. Et les fermes à clics ?**
Une ferme à clics, c'est un compte qui triche sur la qualité ; Hireclaw
l'attaque frontalement, et c'est mesuré dans la démo : le robot tricheur (réponse en
120 ms sur le même bouton) est détecté par la détection de réponses trop rapides, puis
poursuivi par les contrôles cachés, et renvoyé à 5 contrôles / 0 %. Renoyer un
travailleur légitime, lui, échoue (`ERR_FIRE_NOT_JUSTIFIED`). L'anti-triche
n'améliore pas son revenu : les contrôles cachés et la règle de majorité portent
la qualité, et un tricheur perd son poste au lieu de gagner de l'argent. Le
frein structurel reste le taux de paie : à 0,02 USDC, l'unité de travail est si
petite qu'une ferme industrialisée ne peut pas y vivre, alors qu'un humain bien
outillé, en quelques minutes, peut.

---

## 8. Limites assumées

- **La démo hors ligne simule la chaîne.** `make demo` rejoue un monde simulé
  (horloge simulée, solde en micro-USDC tenu par le contrat simulé) pour être
  déterministe et rejouable en moins de deux minutes. La preuve réelle est le
  cycle testnet ci-dessus, pas la démo.
- **L'URL publique est temporaire.** Le tunnel Cloudflare
  (`beijing-gave-locking-examine.trycloudflare.com`) est un tunnel de session ; il
  tombera. L'URL tailnet `http://100.120.194.92:8137/work` n'est stable que dans
  le réseau de l'équipe. Le dépôt reste la source durable.
- **Pas de méta-transaction pour `claim_unpaid`.** La réclamation exige encore
  que le travailleur envoie lui-même une transaction (avec un compte approvisionné
  en NEAR) ;
  l'implémentation complète du bon de travail signé dans un portefeuille
  navigateur n'est pas faite.
- **Tâches photo et encaissement inter-chaînes non implémentés.** Le canal de
  paiement est un NEP-141 unique sur NEAR testnet ; l'encaissement vers d'autres
  chaînes et les tâches photo (capture, contrôle visuel) sont hors périmètre de
  cette version.
- **La solvabilité est vérifiée en testnet sur un seul cycle.** `balanced: true` a
  été obtenu sur le job-0004 ; il reste à le rejouer sur plusieurs commandes
  consécutives.

---

## 9. Reproduire en 5 commandes

```sh
git clone https://github.com/BaptisteFaisy/hireclaw && cd hireclaw
python3 -m venv .venv && . .venv/bin/activate && pip install -e .

make demo          # l'histoire complète hors ligne, déterministe, « INVARIANTS OK »
make attack        # les 11 attaques, refusées avec leur code exact
make test          # 47 tests Python
make test-contract # 22 tests unitaires Rust (VMContextBuilder)
make testnet-e2e   # cycle complet on-chain sur NEAR testnet (rejouable)
```

`make testnet-e2e` rejoue le cycle réel et réécrit `testnet-proof.json` : on peut
constater soi-même `get_solvency` → `balanced: true` et les montants reçus par la
travailleuse.
