/* Hireclaw — the scenario, step by step (split out of v9-engine.js so every
   file stays under the repository's 500-line limit). */
(function () {
  "use strict";

  /* Each step says who acts, towards whom, with what.
     k: usdc (liquid / solid beads) · data (hollow beads) · refus (a bead that is stopped). */
  const STEPS = [
    { st: 0, a: "client", b: "contract", k: "usdc", lab: "1.20 USDC", fx: "order",
      t: "The client pays upfront", d: "1.20 USDC leave the client and enter the contract before any work starts.", code: "ft_transfer_call" },
    { st: 0, a: "contract", fx: "lock",
      t: "The budget is locked", d: "The contract holds the money. The agent cannot touch it: it only gives orders, and the contract checks each one.", code: "ft_on_transfer" },
    { st: 1, a: "agent", b: "contract", k: "data", lab: "accept_job", fx: "margin",
      t: "The agent accepts the job", d: "A 15% margin is set aside: 0.18. Payroll budget: 1.02. Rate: 0.02 per task.", code: "accept_job" },
    { st: 2, a: "contract", b: "workers", k: "data", lab: "hire", fx: "hire",
      t: "Hired without signing up", d: "Five humans. Their account is just a key created in the browser; the contract pays their token registration.", code: "hire · storage_deposit" },
    { st: 2, a: "agent", b: "workers", k: "data", lab: "2 trials", fx: "trial",
      t: "Trial period", d: "Every new hire first gets two trial checks.", code: "trial" },
    { st: 3, a: "agent", b: "workers", k: "data", lab: "tasks", fx: "gold",
      t: "Hidden checks", d: "One task in five has a known answer. Nothing tells it apart from the others.", code: "gold · 20%" },
    { st: 4, a: "workers", b: "agent", k: "data", lab: "signed answers", fx: "answers",
      t: "The humans answer", d: "Each answer is signed with the worker's key, verified, and its latency measured.", code: "ed25519 · verify" },
    { st: 4, a: "agent", fx: "majority",
      t: "The majority decides", d: "Three answers per item. Two matching answers are enough.", code: "majority · redundancy 3" },
    { st: 5, a: "contract", b: "paid", k: "usdc", lab: "0.02 / task", fx: "pay",
      t: "Paid in batches of 10", d: "The contract sends USDC straight to the workers. The agent orders, the contract pays.", code: "pay_batch" },
    { st: 6, a: "contract", b: "dora", k: "refus", lab: "minority", fx: "minority",
      t: "A reasoned rejection", d: "Dora answered against the majority: this task is not paid. The reason is public.", code: "minority" },
    { st: 6, a: "contract", b: "eli", k: "refus", lab: "too_fast · 120 ms", fx: "fast",
      t: "Rejected: too fast", d: "Eli answers in 120 ms, always the same button. Rejected, and the reason goes on the ledger.", code: "too_fast" },
    { st: 7, a: "agent", b: "eli", k: "refus", lab: "fire", fx: "fire",
      t: "A justified dismissal", d: "5 hidden checks, 0% accuracy. The contract verifies the counters before it accepts the dismissal.", code: "fire" },
    { st: 8, a: "agent", b: "client", k: "data", lab: "12/12 · sha256", fx: "deliver",
      t: "Delivery", d: "12 items out of 12 delivered to the client, with their hash. 0.98 USDC paid out in total.", code: "deliver" },
    { st: 8, a: "contract", fx: "split",
      t: "The margin is split", d: "What is left in the contract is the margin. It is split 60% / 30% / 10%.", code: "60 / 30 / 10" },
    { st: 8, a: "all", fx: "balance",
      t: "The books balance", d: "1.20 held = 1.20 owed. Anyone can check it.", code: "get_solvency → balanced: true" }
  ];

  const ROLE_LABEL = {
    client: ["Client", "pays upfront"],
    contract: ["Contract", "holds the money, enforces the rules"],
    agent: ["AI agent", "organises the work"]
  };

  window.HC9_STEPS = STEPS;
  window.HC9_ROLE_LABEL = ROLE_LABEL;
})();
