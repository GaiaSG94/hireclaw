// Scénario e2e réel sur NEAR testnet, rejouable :
// mint -> commande (ft_transfer_call) -> accept_job -> hire -> pay_batch -> reject
// -> deliver -> retrait du travailleur -> vérification de la solvabilité.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nearApi from "near-api-js";

const { Account, KeyPair, transactions } = nearApi;
const { JsonRpcProvider } = nearApi.providers;
const { PublicKey } = nearApi.utils;
const actions = transactions;

const RPC = process.env.NEAR_NODE_URL ?? "https://rpc.testnet.fastnear.com";
const CREDS = path.join(os.homedir(), ".near-credentials", "testnet");
const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const DEPLOYMENT = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "testnet-deployment.json"), "utf8"));

const { contract: CONTRACT, agent: AGENT, client: CLIENT, token: TOKEN } = DEPLOYMENT;
const OWNER = DEPLOYMENT.owner ?? "defraie.testnet";
// Le bailleur finance les travailleurs en NEAR (gas). defraie.testnet a servi à créer
// les comptes ; on bascule sur un autre compte financé quand il s'épuise.
// Bailleur du gas : le compte du contrat lui-même a de la marge libre, et il possède
// déjà les clés de ses sous-comptes (client, agent, travailleurs).
const PARENT = process.env.HIRECLAW_FUNDER ?? CONTRACT;
const provider = new JsonRpcProvider({ url: RPC });
const GAS = 100n * 10n ** 12n;
const GAS_TRANSFER_CALL = 300n * 10n ** 12n;
const ONE_YOCTO = 1n;
const NEAR = 10n ** 24n;
const EXPLORER = "https://testnet.nearblocks.io";

const WORKERS = ["alice", "bob", "chloe"];
const WORKER_NEAR = 0.12;
const RUN = Date.now().toString(36);
const txLog = [];

// ------------------------------------------------------------------ plomberie
function secretOf(accountId) {
  const raw = JSON.parse(fs.readFileSync(path.join(CREDS, `${accountId}.json`), "utf8"));
  return raw.private_key ?? raw.secret_key;
}

function signer(accountId) {
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  keyStore.setKey("testnet", accountId, KeyPair.fromString(secretOf(accountId)));
  const connection = nearApi.Connection.fromConfig({
    networkId: "testnet",
    provider: new JsonRpcProvider({ url: RPC }),
    signer: new nearApi.InMemorySigner(keyStore),
  });
  return new Account(connection, accountId);
}

function saveKey(accountId, keyPair) {
  fs.mkdirSync(CREDS, { recursive: true });
  fs.writeFileSync(
    path.join(CREDS, `${accountId}.json`),
    JSON.stringify({
      account_id: accountId,
      public_key: keyPair.getPublicKey().toString(),
      private_key: keyPair.toString(),
    }, null, 2),
    { mode: 0o600 },
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const usdc = (micro) => (Number(micro) / 1e6).toFixed(6);
const nearOf = (amount) => BigInt(Math.round(amount * 1000)) * (NEAR / 1000n);

async function view(accountId, methodName, args = {}) {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  // Le RPC public limite le débit : on patiente et on réessaie.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: accountId,
        method_name: methodName,
        args_base64: argsBase64,
      });
      if (res.error) throw new Error(`${methodName}: ${JSON.stringify(res.error).slice(0, 220)}`);
      return JSON.parse(Buffer.from(res.result).toString());
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(1200 * (attempt + 1));
    }
  }
  return null;
}

/** Lecture tolérante : les répliques RPC peuvent laguer derrière le bloc final. */
async function viewStable(accountId, methodName, args, predicate, tries = 6) {
  let value = await view(accountId, methodName, args);
  for (let i = 0; i < tries && !predicate(value); i += 1) {
    await sleep(1500);
    value = await view(accountId, methodName, args);
  }
  return value;
}

async function viewAccount(accountId) {
  try {
    return await provider.query({ request_type: "view_account", finality: "final", account_id: accountId });
  } catch {
    return null;
  }
}

async function call(account, contractId, methodName, args, { deposit = 0n, gas = GAS, label } = {}) {
  const outcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(methodName, args, gas, deposit)],
    waitUntil: "FINAL",
  });
  const tx = outcome.transaction_outcome?.id;
  const status = outcome.status ?? {};
  const ok = !status?.Failure;
  txLog.push({ step: label ?? methodName, ok, tx, url: `${EXPLORER}/txns/${tx}` });
  console.log(`  ${ok ? "✓" : "✗"} ${label ?? methodName} — ${EXPLORER}/txns/${tx}`);
  if (!ok) throw new Error(`${methodName} a échoué : ${JSON.stringify(status.Failure).slice(0, 400)}`);
  return outcome;
}

/** Recharge un compte depuis le bailleur : chaque transaction coûte du NEAR au signataire. */
async function topUp(accountId, target) {
  const account = await viewAccount(accountId);
  if (!account) return;
  const missing = target - BigInt(account.amount);
  if (missing <= 0n) return;
  await signer(PARENT).signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.transfer(missing)],
    waitUntil: "FINAL",
  });
  console.log(`  gas rechargé pour ${accountId} (+${(Number(missing) / 1e24).toFixed(2)} NEAR)`);
}

async function ensureWorker(name) {
  const accountId = `${name}.${CONTRACT}`;
  const target = nearOf(WORKER_NEAR);
  const existing = await viewAccount(accountId);
  if (!existing) {
    const keyPair = fs.existsSync(path.join(CREDS, `${accountId}.json`))
      ? KeyPair.fromString(secretOf(accountId))
      : KeyPair.fromRandom("ed25519");
    await signer(PARENT).signAndSendTransaction({
      receiverId: accountId,
      actions: [
        actions.createAccount(),
        actions.transfer(target),
        actions.addKey(PublicKey.from(keyPair.getPublicKey().toString()), actions.fullAccessKey()),
      ],
      waitUntil: "FINAL",
    });
    saveKey(accountId, keyPair);
    return accountId;
  }
  const missing = target - BigInt(existing.amount);
  if (missing > 0n) {
    await signer(PARENT).signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.transfer(missing)],
      waitUntil: "FINAL",
    });
  }
  return accountId;
}

/** Retrouve la commande qu'on vient de créer, par son spec_hash (robuste après réinit). */
async function findJobId(specHash, budget) {
  // Les répliques RPC peuvent laguer : on réessaie quelques secondes.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    for (let i = 1; i <= 12; i += 1) {
      const id = `job-${String(i).padStart(4, "0")}`;
      let job = null;
      try {
        job = await view(CONTRACT, "get_job", { job_id: id });
      } catch {
        job = null;
      }
      if (job && job.spec_hash === specHash && job.budget === budget) return id;
    }
    await sleep(1500);
  }
  throw new Error("commande introuvable après le transfert");
}

/** Payload canonique signé par l'agent : mêmes octets que le contrat Rust et Python. */
function ticketPayload(ticket) {
  const keys = ["agent", "amount", "issued_ms", "job_id", "reason", "task_id", "worker"];
  const ordered = {};
  for (const key of keys) ordered[key] = key === "amount" ? Number(ticket[key]) : ticket[key];
  return JSON.stringify(ordered);
}

function agentKeyPair() {
  const raw = JSON.parse(fs.readFileSync(path.join(CREDS, `${AGENT}.json`), "utf8"));
  return KeyPair.fromString(raw.private_key ?? raw.secret_key);
}

function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function signTicket(keyPair, ticket) {
  const signature = keyPair.sign(Buffer.from(ticketPayload(ticket), "utf8"));
  return toHex(signature.signature);
}

// ------------------------------------------------------------------- scénario
async function main() {
  console.log("=== Hireclaw — cycle complet on-chain (NEAR testnet) ===");
  console.log(`contrat  ${EXPLORER}/address/${CONTRACT}`);
  console.log(`agent    ${AGENT}`);
  console.log(`client   ${CLIENT}`);
  console.log(`jeton    ${TOKEN}`);
  console.log(`owner    ${OWNER}`);
  console.log(`bailleur ${PARENT} (finance le gas)\n`);

  const clientSigner = signer(CLIENT);
  const agentSigner = signer(AGENT);

  console.log("0. Fonds de gas (le client et l'agent paient leurs transactions)");
  await topUp(CLIENT, nearOf(0.5));
  await topUp(AGENT, nearOf(0.5));

  console.log("\n1. Le client se minte des USDC de test");
  await call(clientSigner, TOKEN, "mint", { account_id: CLIENT, amount: "5000000" }, { label: "mint 5.00 USDC" });
  console.log(`  solde client : ${usdc(await view(TOKEN, "ft_balance_of", { account_id: CLIENT }))} USDC`);

  console.log("\n2. Commande payée d'avance (ft_transfer_call)");
  const deadlineMs = Date.now() + 24 * 3600 * 1000;
  const specHash = `sentiment-12-avis-${RUN}`;
  const orderMsg = JSON.stringify({ action: "order", n_items: 12, deadline_ms: deadlineMs, spec_hash: specHash });
  await call(clientSigner, TOKEN, "ft_transfer_call",
    { receiver_id: CONTRACT, amount: "1200000", memo: `commande ${RUN}`, msg: orderMsg },
    { gas: GAS_TRANSFER_CALL, deposit: ONE_YOCTO, label: "ft_transfer_call 1.20 USDC" });
  const jobId = await findJobId(specHash, "1200000");

  console.log(`\n3. L'agent accepte ${jobId} : marge réservée, budget de paie figé`);
  const goldReveal = "r13:positif,r14:negatif,r15:neutre,r16:positif,r17:negatif";
  const goldCommit = crypto.createHash("sha256").update(goldReveal).digest("hex");
  await call(agentSigner, CONTRACT, "accept_job",
    { job_id: jobId, pay_per_task: "20000", gold_commit: goldCommit },
    { label: "accept_job 0.02 USDC/tâche" });
  const job = await viewStable(CONTRACT, "get_job", { job_id: jobId },
    (j) => j && Number(j.margin_reserved) > 0);
  console.log(`  marge réservée ${usdc(job.margin_reserved)} · budget de paie ${usdc(job.payroll_budget)}`);

  console.log("\n4. Embauche de trois travailleurs");
  const accounts = [];
  for (const name of WORKERS) {
    const accountId = await ensureWorker(name);
    accounts.push(accountId);
    try {
      await call(agentSigner, CONTRACT, "hire", { worker: accountId }, { label: `hire ${name}` });
    } catch (err) {
      if (!/ERR_ALREADY_HIRED/.test(String(err.message))) throw err;
      console.log(`  = ${name} déjà embauché (script rejoué)`);
    }
  }

  console.log("\n5. Paie par lots : 4 tâches validées par travailleur");
  for (let i = 0; i < accounts.length; i += 1) {
    const items = [0, 1, 2, 3].map((k) => ({
      task_id: `t-${RUN}-${i}${k}`,
      worker: accounts[i],
      gold: k === 0,
    }));
    await call(agentSigner, CONTRACT, "pay_batch", { job_id: jobId, items, amount: null },
      { label: `pay_batch ${WORKERS[i]} (4 tâches = 0.08 USDC)` });
  }

  console.log("\n6. Un refus motivé, public et on-chain");
  await call(agentSigner, CONTRACT, "reject",
    { job_id: jobId, task_id: `t-${RUN}-r`, worker: accounts[1], reason: "minority", gold: false },
    { label: "reject minority" });

  console.log("\n7bis. Le patron se tait : le bon de travail signé paie à sa place");
  const keyPair = agentKeyPair();
  const agentPkHex = toHex(keyPair.getPublicKey().data);
  await call(agentSigner, CONTRACT, "set_agent_key", { agent_pk: agentPkHex },
    { label: "set_agent_key (clé de signature de l'agent)" });

  const taskId = `t-claim-${RUN}`;
  const ticket = {
    job_id: jobId,
    task_id: taskId,
    worker: accounts[0],
    amount: "20000",
    reason: "validee mais jamais payee",
    issued_ms: Date.now(),
    agent: AGENT,
    signature: "",
  };
  ticket.signature = signTicket(keyPair, ticket);

  console.log("  attente du délai payer-ou-refuser (5 s)...");
  await sleep(7000);
  await call(signer(accounts[0]), CONTRACT, "claim_unpaid", { ticket },
    { label: "claim_unpaid (le travailleur réclame son bon)" });
  const aliceUsdcAfterClaim = await viewStable(TOKEN, "ft_balance_of", { account_id: accounts[0] }, (v) => Number(v) > 0);
  console.log(`  solde USDC d'${WORKERS[0]} après réclamation : ${usdc(aliceUsdcAfterClaim)}`);

  console.log("\n7. Livraison : révélation des contrôles, marge ventilée 60/30/10");
  await call(agentSigner, CONTRACT, "deliver",
    { job_id: jobId, result_hash: `sha256-jeu-${RUN}`, n_validated: 12, gold_reveal: goldReveal },
    { label: "deliver" });


  console.log("\n8. Le travailleur retire ses gains (ft_transfer sortant)");
  const aliceSigner = signer(accounts[0]);
  await call(aliceSigner, CONTRACT, "withdraw", { amount: null }, { label: "withdraw alice" });
  const aliceUsdc = await viewStable(TOKEN, "ft_balance_of", { account_id: accounts[0] }, (v) => Number(v) > 0);
  console.log(`  solde USDC d'${WORKERS[0]} : ${usdc(aliceUsdc)}`);
  const worker = await view(CONTRACT, "get_worker", { account: accounts[0] });
  console.log(`  compteur du travailleur : ${worker.tasks_paid} tâche(s) payée(s), exactitude ${worker.accuracy_pct}%`);

  console.log("\n9. Solvabilité et invariants on-chain");
  const solvency = await viewStable(CONTRACT, "get_solvency", {}, (s) => s.balanced === true);
  console.log(`  balance ${usdc(solvency.balance)} = sum ${usdc(solvency.sum)} → balanced ${solvency.balanced}`);
  console.log(`  poches : propriétaire ${usdc(solvency.buckets.owner)} · réserve ${usdc(solvency.buckets.reserve)} · contributeurs ${usdc(solvency.buckets.contributors)}`);
  if (!solvency.balanced) throw new Error("INVARIANT C-I1 VIOLÉ on-chain");

  const proof = {
    ...DEPLOYMENT,
    e2e_completed_at: new Date().toISOString(),
    job_id: jobId,
    transactions: txLog,
    solvency,
    job: await viewStable(CONTRACT, "get_job", { job_id: jobId }, (j) => j && j.state === "Delivered"),
  };
  fs.writeFileSync(path.join(ROOT_DIR, "testnet-proof.json"), JSON.stringify(proof, null, 2));
  console.log(`\nPreuves : testnet-proof.json (${txLog.length} transactions)`);
}

main().catch((err) => {
  console.error("ERREUR :", err.message ?? err);
  fs.writeFileSync(path.join(ROOT_DIR, "testnet-proof.json"), JSON.stringify({ failed: true, transactions: txLog }, null, 2));
  process.exit(1);
});