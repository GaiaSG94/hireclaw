/* Hireclaw v9 — le scenario, etape par etape (extrait de v9-engine.js).
   Ce fichier existe pour tenir sous la limite de 500 lignes du depot ;
   le contenu est celui de la reference verrouillee, a l'identique. */
(function () {
  "use strict";

  /* Le scénario, étape par étape. Chaque étape dit : qui agit, vers qui, avec quoi.
     k : usdc (liquide/billes pleines) · data (billes creuses) · refus (bille arrêtée). */
  const STEPS = [
    { st: 0, a: "client", b: "contract", k: "usdc", lab: "1.20 USDC", fx: "order",
      t: "Le client paie d'avance", d: "1.20 USDC quittent le client et entrent dans le contrat, avant tout travail.", code: "ft_transfer_call" },
    { st: 0, a: "contract", fx: "lock",
      t: "Le budget est bloqué", d: "Le contrat garde l'argent. L'agent ne peut pas y toucher : il ne fait que donner des ordres que le contrat vérifie.", code: "ft_on_transfer" },
    { st: 1, a: "agent", b: "contract", k: "data", lab: "accept_job", fx: "margin",
      t: "L'agent accepte la commande", d: "Marge de 15 % mise de côté : 0.18. Budget de paie : 1.02. Tarif : 0.02 par tâche.", code: "accept_job" },
    { st: 2, a: "contract", b: "workers", k: "data", lab: "hire", fx: "hire",
      t: "Embauche sans inscription", d: "Cinq humains. Leur compte est une simple clé créée dans le navigateur ; le contrat paie leur inscription.", code: "hire · storage_deposit" },
    { st: 2, a: "agent", b: "workers", k: "data", lab: "2 essais", fx: "trial",
      t: "Période d'essai", d: "Chaque nouvel embauché reçoit d'abord deux contrôles d'essai.", code: "trial" },
    { st: 3, a: "agent", b: "workers", k: "data", lab: "tâches", fx: "gold",
      t: "Contrôles cachés", d: "Une tâche sur cinq a une réponse déjà connue. Rien ne la distingue des autres.", code: "gold · 20 %" },
    { st: 4, a: "workers", b: "agent", k: "data", lab: "réponses signées", fx: "answers",
      t: "Les humains répondent", d: "Chaque réponse est signée par la clé du travailleur, vérifiée, et sa latence mesurée.", code: "ed25519 · verify" },
    { st: 4, a: "agent", fx: "majority",
      t: "La majorité tranche", d: "Trois réponses par élément. Deux réponses concordantes suffisent.", code: "majority · redondance 3" },
    { st: 5, a: "contract", b: "paid", k: "usdc", lab: "0.02 / tâche", fx: "pay",
      t: "Paie par lots de 10", d: "Le contrat verse les USDC directement aux travailleurs. L'agent ordonne, le contrat paie.", code: "pay_batch" },
    { st: 6, a: "contract", b: "dora", k: "refus", lab: "minority", fx: "minority",
      t: "Refus motivé", d: "Dora a répondu contre la majorité : cette tâche n'est pas payée. Le motif est public.", code: "minority" },
    { st: 6, a: "contract", b: "eli", k: "refus", lab: "too_fast · 120 ms", fx: "fast",
      t: "Refus : trop rapide", d: "Eli répond en 120 ms, toujours le même bouton. Refusé, motif inscrit au registre.", code: "too_fast" },
    { st: 7, a: "agent", b: "eli", k: "refus", lab: "fire", fx: "fire",
      t: "Renvoi justifié", d: "5 contrôles cachés, 0 % d'exactitude. Le contrat vérifie les compteurs avant d'accepter le renvoi.", code: "fire" },
    { st: 8, a: "agent", b: "client", k: "data", lab: "12/12 · sha256", fx: "deliver",
      t: "Livraison", d: "12 éléments sur 12 livrés au client, avec leur empreinte. 0.98 USDC versés au total.", code: "deliver" },
    { st: 8, a: "contract", fx: "split",
      t: "La marge est ventilée", d: "Ce qui reste dans le contrat est la marge. Elle est répartie 60 % / 30 % / 10 %.", code: "60 / 30 / 10" },
    { st: 8, a: "all", fx: "balance",
      t: "Les comptes tombent juste", d: "1.20 en garde = 1.20 d'engagements. N'importe qui peut le vérifier.", code: "get_solvency → balanced: true" }
  ];

  const ROLE_LABEL = {
    client: ["Client", "paie d'avance"],
    contract: ["Contrat", "garde l'argent, applique les règles"],
    agent: ["Agent IA", "organise le travail"]
  };

  window.HC9_STEPS = STEPS;
  window.HC9_ROLE_LABEL = ROLE_LABEL;
})();
