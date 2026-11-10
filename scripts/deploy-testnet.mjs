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

const PARENT = process.env.HIRECLAW_PARENT ?? "defraie.testnet";
const CONTRACT = `hireclaw.${PARENT}`;
const AGENT = `agent.${CONTRACT}`;
const CLIENT = `client.${CONTRACT}`;
const TOKEN = process.env.HIRECLAW_TOKEN ?? "usd.panneau.testnet"; // NEP-141, 6 décimales

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
  const outcome = await signer(CONTRACT).signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall("new", { owner: CONTRACT, agent: AGENT, token: TOKEN, rules: null }, CALL_GAS, 0n)],
    waitUntil: "FINAL",
  });
  console.log(`  initialisé : tx ${outcome.transaction_outcome?.id}`);
}

// ------------------------------------------------------------------------- main
async function main() {
  console.log("=== Hireclaw — déploiement NEAR testnet ===");
  console.log(`contrat ${CONTRACT} · agent ${AGENT} · client ${CLIENT}\ntoken   ${TOKEN}${FORCE ? " · FORCE_REDEPLOY=1" : ""}`);

  console.log("\n1. Comptes");
  await ensureSubaccount(CONTRACT, PARENT, 3.8);
  await ensureSubaccount(AGENT, CONTRACT, 0.4);
  await ensureSubaccount(CLIENT, CONTRACT, 0.4);

  console.log("\n2. Contrat");
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