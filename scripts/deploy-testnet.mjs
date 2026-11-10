// Déploiement idempotent de Hireclaw sur NEAR testnet.
// Comptes : sous-comptes de defraie.testnet (le faucet public est limité à 10 comptes / 3 h / IP).
// Re-run sans FORCE_REDEPLOY=1 : réutilise le compte, le code et l'état existants.
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
const WASM = path.join(ROOT_DIR, "contract/target/near/hireclaw_contract.wasm");
const FORCE = process.env.FORCE_REDEPLOY === "1";
const RESET = process.env.RESET === "1"; // supprime et recrée le compte contrat

// Règles du propriétaire. `pay_or_reject_seconds` est raccourci à 5 s pour la démo :
// c'est le délai après lequel un bon de travail signé peut être présenté (claim_unpaid).
const RULES = {
  task_pay_min: "20000",
  task_pay_max: "100000",
  payroll_cap_per_day: "20000000",
  worker_cap_per_day: "2000000",
  min_margin_pct: 15,
  redundancy: 3,
  gold_share_pct: 20,
  min_golds_before_fire: 5,
  fire_below_accuracy_pct: 60,
  pay_or_reject_seconds: Number(process.env.HIRECLAW_PAY_OR_REJECT_S ?? 5),
  inference_max_spend_per_day: "500000",
  revenue_split: [60, 30, 10],
  kill_switch: false,
};

const PARENT = process.env.HIRECLAW_PARENT ?? "defraie.testnet";
const CONTRACT_NAME = process.env.HIRECLAW_CONTRACT ?? `hireclaw.${PARENT}`;
const CONTRACT = CONTRACT_NAME.includes(".") ? CONTRACT_NAME : `${CONTRACT_NAME}.${PARENT}`;
const AGENT = `agent.${CONTRACT}`;
const OWNER = process.env.HIRECLAW_OWNER ?? PARENT; // propriétaire humain, distinct du contrat
const CLIENT = `client.${CONTRACT}`;
const TOKEN = process.env.HIRECLAW_TOKEN ?? "usd.panneau.testnet"; // NEP-141, 6 décimales
const FUNDER = process.env.HIRECLAW_FUNDER ?? "ledger-v2.grid-hour-c.testnet";

const provider = new JsonRpcProvider({ url: RPC });
const CALL_GAS = 100n * 10n ** 12n; // 100 Tgas
const NEAR = 10n ** 24n;

// ------------------------------------------------------------------ credentials
function credPath(accountId) {
  return path.join(CREDS, `${accountId}.json`);
}

function secretOf(accountId) {
  const raw = JSON.parse(fs.readFileSync(credPath(accountId), "utf8"));
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
    credPath(accountId),
    JSON.stringify({
      account_id: accountId,
      public_key: keyPair.getPublicKey().toString(),
      private_key: keyPair.toString(),
    }, null, 2),
    { mode: 0o600 },
  );
}

// --------------------------------------------------------------------- on-chain
async function viewAccount(accountId) {
  try {
    return await provider.query({ request_type: "view_account", finality: "final", account_id: accountId });
  } catch {
    return null;
  }
}

async function viewMethod(contractId, methodName, args = {}) {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const res = await provider.query({
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
  });
  if (res.error) throw new Error(`${methodName}: ${JSON.stringify(res.error).slice(0, 200)}`);
  return JSON.parse(Buffer.from(res.result).toString());
}

function nearAmount(nearFloat) {
  return BigInt(Math.round(nearFloat * 1000)) * (NEAR / 1000n);
}

async function ensureSubaccount(accountId, parentId, nearAmountFloat) {
  if (await viewAccount(accountId)) {
    console.log(`  ${accountId} existe déjà`);
    return;
  }
  const keyPair = fs.existsSync(credPath(accountId))
    ? KeyPair.fromString(secretOf(accountId))
    : KeyPair.fromRandom("ed25519");
  console.log(`  création de ${accountId} depuis ${parentId} (+${nearAmountFloat} NEAR)...`);
  const outcome = await signer(parentId).signAndSendTransaction({
    receiverId: accountId,
    actions: [
      actions.createAccount(),
      actions.transfer(nearAmount(nearAmountFloat)),
      actions.addKey(PublicKey.from(keyPair.getPublicKey().toString()), actions.fullAccessKey()),
    ],
    waitUntil: "FINAL",
  });
  if (outcome?.status?.Failure) throw new Error(`échec ${accountId}: ${JSON.stringify(outcome.status)}`);
  saveKey(accountId, keyPair);
  console.log(`  créé : tx ${outcome.transaction_outcome?.id}`);
}

/** Recharge un compte depuis le bailleur : le storage du WASM est pris sur son solde. */
async function topUp(accountId, targetNear) {
  const account = await viewAccount(accountId);
  const target = BigInt(Math.round(targetNear * 1000)) * (NEAR / 1000n);
  const missing = target - BigInt(account.amount);
  if (missing <= 0n) {
    console.log(`  ${accountId} : ${(Number(account.amount) / 1e24).toFixed(2)} NEAR (suffisant)`);
    return;
  }
  try {
    const outcome = await signer(FUNDER).signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.transfer(missing)],
      waitUntil: "FINAL",
    });
    console.log(`  +${(Number(missing) / 1e24).toFixed(2)} NEAR vers ${accountId} — tx ${outcome.transaction_outcome?.id}`);
  } catch (err) {
    // Plus de NEAR libre sur la machine : on continue avec ce qu'il y a.
    console.log(`  rechargement impossible (${String(err.message ?? err).slice(0, 60)}) : on continue`);
  }
}

/**
 * Remise à zéro du compte contrat et de ses sous-comptes :
 * on les supprime (le NEAR revient au parent) puis on recrée. Les USDC restent
 * chez le jeton sous le même identifiant : le contrat les réconciliera.
 */
async function resetContract() {
  console.log("  suppression des sous-comptes et du compte contrat...");
  for (const name of ["alice", "bob", "chloe", "agent", "client"]) {
    const accountId = `${name}.${CONTRACT}`;
    if (!(await viewAccount(accountId))) continue;
    try {
      const outcome = await signer(accountId).signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.deleteAccount(PARENT)],
        waitUntil: "FINAL",
      });
      console.log(`  ${accountId} supprimé : tx ${outcome.transaction_outcome?.id}`);
    } catch (err) {
      console.log(`  ${accountId} : ${String(err.message ?? err).slice(0, 70)}`);
    }
  }
  if (!(await viewAccount(CONTRACT))) return true;
  try {
    const outcome = await signer(CONTRACT).signAndSendTransaction({
      receiverId: CONTRACT,
      actions: [actions.deleteAccount(PARENT)],
      waitUntil: "FINAL",
    });
    console.log(`  ${CONTRACT} supprimé : tx ${outcome.transaction_outcome?.id}`);
    return true;
  } catch (err) {
    console.log(`  suppression du contrat refusée : ${String(err.message ?? err).slice(0, 90)}`);
    return false;
  }
}

/** Le stub est un contrat minimal : le déployer libère le stockage du vieux code. */
async function freeStorage(accountId) {
  const stub = path.join(ROOT_DIR, "contract/target/near/stub.wasm");
  if (!fs.existsSync(stub)) {
    console.log("  stub absent : build tools/stub-contract d'abord");
    return false;
  }
  const outcome = await signer(accountId).signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.deployContract(fs.readFileSync(stub))],
    waitUntil: "FINAL",
  });
  console.log(`  stub déployé (stockage libéré) : tx ${outcome.transaction_outcome?.id}`);
  return true;
}

async function deployWasm(accountId) {
  const code = fs.readFileSync(WASM);
  console.log(`  taille WASM : ${(code.length / 1024).toFixed(1)} KB`);
  const outcome = await signer(accountId).signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.deployContract(code)],
    waitUntil: "FINAL",
  });
  console.log(`  déployé : tx ${outcome.transaction_outcome?.id}`);
}

async function initContract() {
  // Auto-appel : le contrat s'appelle lui-même, seule clé du compte contrat peut le faire.
  const outcome = await signer(CONTRACT).signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall("new", { owner: OWNER, agent: AGENT, token: TOKEN, rules: RULES }, CALL_GAS, 0n)],
    waitUntil: "FINAL",
  });
  console.log(`  initialisé : tx ${outcome.transaction_outcome?.id}`);
}

// ------------------------------------------------------------------------- main
async function main() {
  console.log("=== Hireclaw — déploiement NEAR testnet ===");
  console.log(`contrat ${CONTRACT} · agent ${AGENT} · owner ${OWNER} · client ${CLIENT}\ntoken   ${TOKEN}${FORCE ? " · FORCE_REDEPLOY=1" : ""}`);

  console.log("\n1. Comptes");
  if (RESET) {
    const wiped = await resetContract();
    if (!wiped) {
      console.log("  le compte contrat n'a pas pu être supprimé : on continue en place");
    } else {
      await topUp(PARENT, 9.0);
    }
  }
  await ensureSubaccount(CONTRACT, PARENT, Number(process.env.HIRECLAW_CONTRACT_NEAR ?? 2.9));
  await ensureSubaccount(AGENT, CONTRACT, 0.15);
  await ensureSubaccount(CLIENT, CONTRACT, 0.15);

  console.log("\n2. Contrat");
  await topUp(CONTRACT, 6.2);
  if (process.env.FREE_STORAGE === "1") {
    await freeStorage(CONTRACT);
  } // le storage WASM est prélevé sur le solde du contrat
  const account = await viewAccount(CONTRACT);
  const hasCode = account && account.code_hash !== "11111111111111111111111111111111";
  if (FORCE || !hasCode) await deployWasm(CONTRACT);
  else console.log("  code déjà en place (FORCE_REDEPLOY=1 pour le remplacer)");

  let initialized = false;
  try {
    await viewMethod(CONTRACT, "get_rules");
    initialized = true;
  } catch { /* pas encore initialisé */ }
  if (FORCE || !initialized) await initContract();
  else console.log("  état déjà initialisé");

  console.log("\n3. État on-chain");
  console.log("  règles      :", JSON.stringify(await viewMethod(CONTRACT, "get_rules")));
  console.log("  solvabilité :", JSON.stringify(await viewMethod(CONTRACT, "get_solvency")));
  const contractAccount = await viewAccount(CONTRACT);
  console.log(`  solde NEAR  : ${(Number(contractAccount.amount) / 1e24).toFixed(2)} NEAR`);

  const info = {
    network: "testnet",
    contract: CONTRACT,
    agent: AGENT,
    client: CLIENT,
    token: TOKEN,
    deployed_at: new Date().toISOString(),
    owner: OWNER,
    rules: RULES,
    wasm_sha256: (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(WASM)).digest("hex"),
    explorer: `https://testnet.nearblocks.io/address/${CONTRACT}`,
  };
  fs.writeFileSync(path.join(ROOT_DIR, "testnet-deployment.json"), JSON.stringify(info, null, 2));
  console.log(`\nOK — ${info.explorer}`);
}

main().catch((err) => {
  console.error("ERREUR :", err.message ?? err);
  process.exit(1);
});