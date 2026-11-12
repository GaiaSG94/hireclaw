/* Hireclaw — project data shown by the scene (/scene). Single source for that page.
   Everything comes from the repository: boss/, contract/, config.yaml, testnet-proof.json. */
(function () {
  "use strict";

  // The first case is the one the code really runs. The other two only change
  // the intro text and the size of the network: the amounts played stay 1.20 USDC.
  const USE_CASES = [
    {
      id: "individual", label: "Individual",
      title: "Which e-bike should I buy?",
      who: "Camille · 34 · Bordeaux",
      need: "200 conflicting reviews to read, rate and summarise",
      budget: "12 USDC", tasks: "200 reviews", workers: 5
    },
    {
      id: "sme", label: "E-commerce SME",
      title: "50,000 reviews to moderate every month",
      who: "A shoe retailer · €40M revenue",
      need: "Classify reviews, flag fake ones, enrich product pages",
      budget: "6,000 USDC / month", tasks: "50,000 reviews", workers: 18
    },
    {
      id: "lab", label: "AI lab",
      title: "Human taste to train the model",
      who: "A foundation-model lab · design",
      need: "Rank pairs of mock-ups — modern, beautiful, dated — with a reason",
      budget: "250,000 USDC / month", tasks: "1.2M comparisons", workers: 36
    }
  ];

  // the 9 stages of the rail
  const STAGES = [
    ["Order", "1.20 USDC locked"],
    ["Margin", "0.18 set aside"],
    ["Hiring", "registration paid"],
    ["Checks", "hidden gold, 1 in 5"],
    ["Majority", "2 out of 3 is enough"],
    ["Payroll", "batches of 10"],
    ["Rejections", "public reasons"],
    ["Dismissal", "5 checks, 0%"],
    ["Delivery", "12/12 · 60/30/10"]
  ];

  // 48 features in four groups — shown in the "Whole project" sheet
  const FEATURES = [
    ["the money", [
      ["order paid upfront", "ft_transfer_call"], ["budget locked", "1.20"],
      ["margin set aside on acceptance", "15%"], ["payroll budget derived", "1.02"],
      ["pay floor", "0.02"], ["pay cap", "0.10"],
      ["cap per worker per day", "2.00"], ["payroll cap per day", "20.00"],
      ["paid in batches", "≤ 10"], ["a pair is settled only once", "C-I3"],
      ["inference paid out of the margin", "≤ 0.50/day"], ["margin split", "60/30/10"]
    ]],
    ["the work", [
      ["hired without signing up", "hire"], ["token registration paid for them", "storage_deposit"],
      ["implicit account = public key", "ed25519"], ["answer signed and verified", "verify"],
      ["latency measured", "ms"], ["grades Trial → Active → Senior", "promote"],
      ["dismissal justified by counters", "fire"], ["automatic promotion", "≥ 2 / 20"],
      ["signed work ticket", "claim_unpaid"], ["silence means payment", "120 s"],
      ["owner kill switch", "kill_switch"], ["delivery + hash", "sha256"]
    ]],
    ["the quality", [
      ["hidden checks injected", "20%"], ["never flagged", "gold"],
      ["2 trial checks on hiring", "trial"], ["redundancy per item", "3"],
      ["majority from 2 matching answers", "majority"], ["minority rejected", "minority"],
      ["ambiguous item still paid", "ambiguous"], ["too-fast answer flagged", "< 300 ms"],
      ["rejections reasoned and public", "ledger"], ["commitment on the checks", "gold_commit"],
      ["reveal verified", "ERR_GOLD_MISMATCH"], ["only hired workers get paid", "C-I6"]
    ]],
    ["the chain", [
      ["NEP-141 token receiver", "ft_on_transfer"], ["cross-contract payout", "ft_transfer"],
      ["confirmation callback", "on_payout"], ["NEP-297 events", "EVENT_JSON"],
      ["NEP-330 metadata", "metadata"], ["standard NEAR ABI 0.4.0", "31 methods"],
      ["compiled WASM", "244.4 KB"], ["Rust tests", "22"],
      ["sandbox integration", "1"], ["Python tests", "47"],
      ["financial invariants", "C-I1..C-I6"], ["on-chain proof transactions", "14"]
    ]]
  ];

  const BENCH = [
    ["cost per delivered label", "0.08", "USDC"],
    ["floor for one task", "0.02", "USDC"],
    ["answer → payment", "seconds", ""],
    ["worker sign-up", "none", ""],
    ["delivered accuracy", "12/12", ""],
    ["attacks refused", "11/11", ""],
    ["financial invariants", "6/6", ""],
    ["on-chain proofs", "14", "tx"]
  ];

  const REFUS = [
    ["ERR_PAY_ABOVE_MAX", "pay more than 0.10"], ["ERR_PAY_BELOW_MIN", "pay less than 0.02"],
    ["ERR_ALREADY_SETTLED", "pay twice"], ["ERR_WORKER_FIRED", "pay a dismissed worker"],
    ["ERR_NOT_HIRED", "pay someone not hired"], ["ERR_PAYROLL_BUDGET", "exceed the payroll"],
    ["ERR_FIRE_NOT_JUSTIFIED", "dismiss a good worker"], ["ERR_WORKER_CAP", "exceed 2 per day"],
    ["ERR_DAILY_CAP", "exceed 20 per day"], ["ERR_PAUSED", "act under the kill switch"],
    ["ERR_GOLD_MISMATCH", "tamper with the checks"], ["ERR_BAD_SIGNATURE", "forged ticket"]
  ];

  const NETWORK = {
    contract: "hireclaw.defraie.testnet",
    agent: "agent.hireclaw.defraie.testnet",
    client: "client.hireclaw.defraie.testnet",
    token: "usd.panneau.testnet",
    wasm: "244.4 KB",
    abi: "31 methods · NEAR 0.4.0"
  };

  window.HC = { USE_CASES, STAGES, FEATURES, BENCH, REFUS, NETWORK };
})();
