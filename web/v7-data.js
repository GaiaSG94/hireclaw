/* Hireclaw v7 — données du projet (une seule source de vérité pour la scène 3D).
   Tout vient du dépôt : boss/, contract/, config.yaml, testnet-proof.json. */
(function () {
  "use strict";

  const PALETTE = {
    bg: "#070b14",
    bgDeep: "#04060d",
    human: "#f2ede4",
    money: "#ffc24b",
    agent: "#5ee6c8",
    reject: "#ff6b6b",
    muted: "#6b7691",
    line: "rgba(120,150,200,0.16)"
  };

  // visages : tons de peau, cheveux, styles — tirés de façon déterministe
  const SKIN = ["#f6ddc5", "#f0c9a4", "#e0ac7d", "#c98d63", "#a26a42", "#7a4c2c", "#5c3821"];
  const HAIR = ["#16161a", "#2f2419", "#4a3320", "#6f4a2a", "#9a6b3a", "#c9a87a", "#3a3a44", "#7a7a86"];
  const CLOTH = ["#2b3550", "#3a2f4a", "#24404a", "#40332b", "#2f3d33", "#3b2f3f", "#26313f"];

  const USE_CASES = [
    {
      id: "particulier", label: "Particulier",
      title: "Quel vélo électrique acheter ?",
      who: "Camille · 34 ans · Bordeaux",
      need: "200 avis contradictoires à lire, noter et synthétiser",
      budget: "12 USDC", tasks: "200 avis", crew: "4", eta: "18 min",
      out: "synthèse classée + 200 avis étiquetés",
      workers: 5, price: "0.02 / tâche"
    },
    {
      id: "pme", label: "PME e-commerce",
      title: "50 000 avis à modérer chaque mois",
      who: "Maison Colbert · chaussures · 40 M€ CA",
      need: "Classer les avis, détecter les faux, enrichir les fiches",
      budget: "6 000 USDC/mois", tasks: "50 000 avis", crew: "300", eta: "continu",
      out: "avis modérés + faux avis signalés",
      workers: 18, price: "0.02 / tâche"
    },
    {
      id: "lab", label: "Lab IA",
      title: "Du goût humain pour entraîner le modèle",
      who: "lab de modèle de fondation · design",
      need: "Classer des paires de maquettes : moderne, beau, daté — avec justification",
      budget: "250 000 USDC/mois", tasks: "1,2 M comparaisons", crew: "12 000", eta: "continu",
      out: "données de préférence esthétique (RLHF)",
      workers: 36, price: "préférence / paire"
    }
  ];

  // les 9 étapes visibles dans l'espace
  const STAGES = [
    ["Commande", "1.20 USDC bloqués"],
    ["Marge", "0.18 mise de côté"],
    ["Embauche", "inscription payée"],
    ["Contrôles", "or caché, 1 sur 5"],
    ["Majorité", "2 sur 3 suffisent"],
    ["Paie", "lots de 10"],
    ["Refus", "motifs publics"],
    ["Renvoi", "5 contrôles, 0 %"],
    ["Livraison", "12/12 · 60/30/10"]
  ];

  // le scénario : 12 temps, chacun avec sa cible de caméra
  const SCRIPT = [
    { st: 0, cam: "client", ev: "le client paie d'avance — 1.20 USDC bloqués au contrat", code: "ft_transfer_call", fx: "order" },
    { st: 1, cam: "agent", ev: "l'agent accepte : marge 0.18 réservée, budget de paie 1.02, tarif 0.02", code: "accept_job", fx: "margin", money: { margin: 0.18 } },
    { st: 2, cam: "wide", ev: "embauche — le contrat paie l'inscription au jeton, personne n'envoie de transaction", code: "hire", fx: "hire" },
    { st: 3, cam: "workers", ev: "contrôles cachés servis : la bonne réponse est connue, jamais annoncée", code: "gold", fx: "gold" },
    { st: 4, cam: "workers", ev: "3 réponses par élément, majorité dès 2 concordantes", code: "majority", fx: "answers" },
    { st: 5, cam: "workers", ev: "paie par lots de 10 — chaque pièce part vers un visage", code: "pay_batch", fx: "pay", money: { pay: 0.48 } },
    { st: 6, cam: "workers", ev: "refus minority — le motif est inscrit au registre public", code: "minority", fx: "reject", bad: true },
    { st: 6, cam: "cheater", ev: "refus too_fast — 120 ms, toujours le même bouton", code: "too_fast", fx: "reject2", bad: true },
    { st: 7, cam: "cheater", ev: "renvoi : 5 contrôles, 0 % d'exactitude. Le contrat accepte", code: "fire", fx: "fire" },
    { st: 8, cam: "agent", ev: "livraison 12/12 — marge ventilée 60 % / 30 % / 10 %", code: "deliver", fx: "deliver", money: { pay: 0.98, inf: 0.048 } },
    { st: 8, cam: "client", ev: "le livrable repart au client", code: "sale", fx: "result" },
    { st: 8, cam: "wide", ev: "invariant C-I1 : 1.20 en garde = 1.20 d'engagements", code: "get_solvency", fx: "balance", balanced: true }
  ];

  // 48 fonctions, groupées — affichées dans le panneau immersif
  const FEATURES = [
    ["l'argent", [
      ["commande payée d'avance", "ft_transfer_call"], ["budget bloqué", "1.20"],
      ["marge réservée à l'acceptation", "15 %"], ["budget de paie dérivé", "1.02"],
      ["plancher de paie", "0.02"], ["plafond de paie", "0.10"],
      ["plafond / travailleur / jour", "2.00"], ["plafond de paie / jour", "20.00"],
      ["paie par lots", "≤ 10"], ["une paire réglée une seule fois", "C-I3"],
      ["inférence payée sur la marge", "≤ 0.50/j"], ["marge ventilée", "60/30/10"]
    ]],
    ["le travail", [
      ["embauche sans inscription", "hire"], ["inscription au jeton payée", "storage_deposit"],
      ["compte implicite = clé publique", "ed25519"], ["réponse signée et vérifiée", "verify"],
      ["latence mesurée", "ms"], ["grades Trial → Active → Senior", "promote"],
      ["renvoi justifié par les compteurs", "fire"], ["promotion automatique", "≥ 2 / 20"],
      ["bon de travail signé", "claim_unpaid"], ["le silence vaut paiement", "120 s"],
      ["coupe-circuit propriétaire", "kill_switch"], ["livraison + empreinte", "sha256"]
    ]],
    ["la qualité", [
      ["contrôles cachés injectés", "20 %"], ["jamais signalés", "gold"],
      ["2 contrôles d'essai à l'embauche", "trial"], ["redondance par élément", "3"],
      ["majorité dès 2 concordantes", "majority"], ["minorité refusée", "minority"],
      ["élément ambigu payé", "ambiguous"], ["réponse trop rapide signalée", "< 300 ms"],
      ["refus motivés et publics", "ledger"], ["engagement sur les contrôles", "gold_commit"],
      ["révélation vérifiée", "ERR_GOLD_MISMATCH"], ["seuls les embauchés sont payés", "C-I6"]
    ]],
    ["la chaîne", [
      ["récepteur de jeton NEP-141", "ft_on_transfer"], ["sortie cross-contract", "ft_transfer"],
      ["callback de confirmation", "on_payout"], ["événements NEP-297", "EVENT_JSON"],
      ["métadonnées NEP-330", "metadata"], ["ABI standard NEAR 0.4.0", "29 méthodes"],
      ["WASM compilé", "237.9 ko"], ["tests Rust", "22"],
      ["intégration sandbox", "1"], ["tests Python", "47"],
      ["invariants financiers", "C-I1..C-I6"], ["cycles on-chain publiés", "14"]
    ]]
  ];

  const BENCH = [
    ["coût / étiquette livrée", "0.08", "USDC"],
    ["plancher d'une tâche", "0.02", "USDC"],
    ["réponse → paiement", "secondes", ""],
    ["inscription du travailleur", "zéro", ""],
    ["exactitude livrée", "12/12", ""],
    ["attaques refusées", "11/11", ""],
    ["invariants financiers", "6/6", ""],
    ["preuves on-chain", "14", "tx"]
  ];

  const REFUS = [
    ["ERR_PAY_ABOVE_MAX", "payer plus que 0.10"], ["ERR_PAY_BELOW_MIN", "payer moins que 0.02"],
    ["ERR_ALREADY_SETTLED", "payer deux fois"], ["ERR_WORKER_FIRED", "payer un renvoyé"],
    ["ERR_NOT_HIRED", "payer un non-embauché"], ["ERR_PAYROLL_BUDGET", "dépasser la paie"],
    ["ERR_FIRE_NOT_JUSTIFIED", "renvoyer un bon"], ["ERR_WORKER_CAP", "dépasser 2/jour"],
    ["ERR_DAILY_CAP", "dépasser 20/jour"], ["ERR_PAUSED", "agir sous coupe-circuit"],
    ["ERR_GOLD_MISMATCH", "fausser les contrôles"], ["ERR_BAD_SIGNATURE", "bon falsifié"]
  ];

  const NETWORK = {
    contract: "hireclaw.defraie.testnet",
    agent: "agent.hireclaw.defraie.testnet",
    client: "client.hireclaw.defraie.testnet",
    token: "usd.panneau.testnet",
    wasm: "237.9 ko · sha256 841e19dd…",
    abi: "29 méthodes · NEAR 0.4.0"
  };

  window.HC = {
    PALETTE, SKIN, HAIR, CLOTH, USE_CASES, STAGES, SCRIPT,
    FEATURES, BENCH, REFUS, NETWORK
  };
})();
