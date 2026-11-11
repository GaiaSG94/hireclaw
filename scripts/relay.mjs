// Relais HTTP local du contrat Hireclaw (NEAR testnet).
//
// À quoi ça sert : le site de démo tourne dans un navigateur (autre port, autre
// origine) et ne peut ni parler JSON-RPC directement sans CORS bloqué, ni signer
// des transactions avec la clé de l'agent. Ce petit serveur fait le pont :
//   GET  /health          → identité du relais
//   GET  /state?job=...   → {job, solvency, rules, workers} (cache 3 s)
//   POST /hire            → embauche un travailleur (clé de l'agent)
//   POST /pay             → pay_batch, découpé en lots de 10 maximum
//   POST /reject          → refus motivé d'une tâche
//   POST /withdraw        → withdraw_signed : le relais TRANSMET le ticket signé
//                           par le navigateur du travailleur, il ne le signe jamais
//   GET  /tx/:hash        → statut simplifié d'une transaction
//
// Pourquoi 127.0.0.1 seulement : ce processus détient la clé de l'agent (elle
// signe hire/pay/reject et paie de l'USDC réel, même en testnet). L'écouter sur
// loopback garantit qu'aucune autre machine du réseau ne peut déclencher un
// paiement. Le CORS `*` ne sert alors qu'au site local servi sur un autre port
// du même poste. Les clés ne quittent jamais ~/.near-credentials : lues à la
// demande, jamais copiées dans le dépôt, jamais loggées.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nearApi from "near-api-js";

const { Account, KeyPair, transactions } = nearApi;
const { JsonRpcProvider } = nearApi.providers;
const actions = transactions;

const RPC = process.env.NEAR_NODE_URL ?? "https://rpc.testnet.fastnear.com";
const CREDS = path.join(os.homedir(), ".near-credentials", "testnet");
const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const DEPLOYMENT = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "testnet-deployment.json"), "utf8"));
const { contract: CONTRACT, agent: AGENT, network: NETWORK } = DEPLOYMENT;
const EXPLORER = "https://testnet.nearblocks.io";
const GAS = 100n * 10n ** 12n;
const STATE_TTL_MS = 3000;
const MAX_BATCH = 10;
const MAX_BODY = 256 * 1024;

const provider = new JsonRpcProvider({ url: RPC });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRateLimited = (err) => /-429|Too many requests|rate/i.test(String(err?.message ?? err));

/** Seul point de lecture des credentials : lu du disque à chaque transaction, jamais conservé. */
function agentSigner() {
  const raw = JSON.parse(fs.readFileSync(path.join(CREDS, `${AGENT}.json`), "utf8"));
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  keyStore.setKey(NETWORK, AGENT, KeyPair.fromString(raw.private_key ?? raw.secret_key));
  const connection = nearApi.Connection.fromConfig({
    networkId: NETWORK,
    provider: new JsonRpcProvider({ url: RPC }),
    signer: new nearApi.InMemorySigner(keyStore),
  });
  return new Account(connection, AGENT);
}

/** Lecture de vue avec retries : le RPC public limite le débit (-429). */
async function view(methodName, args = {}, tries = 6) {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: CONTRACT,
        method_name: methodName,
        args_base64: argsBase64,
      });
      if (res.error) throw new Error(`${methodName}: ${JSON.stringify(res.error).slice(0, 200)}`);
      return JSON.parse(Buffer.from(res.result).toString());
    } catch (err) {
      if (attempt >= tries - 1 || !isRateLimited(err)) throw err;
      await sleep(1200 * (attempt + 1));
    }
  }
}

/** Extrait le code métier ERR_* d'un message d'erreur quelconque. */
function errCode(err) {
  const text = String(err?.message ?? err);
  const match = text.match(/ERR_[A-Z_]+/);
  return match ? match[0] : "ERR_RELAY";
}

function txRef(outcome) {
  const tx = outcome?.transaction_outcome?.id ?? null;
  return { tx, url: tx ? `${EXPLORER}/txns/${tx}` : null };
}

/** Transaction signée par l'agent. Ne logge que la méthode et le hash — jamais d'arguments. */
async function callAgent(methodName, args) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const outcome = await agentSigner().signAndSendTransaction({
        receiverId: CONTRACT,
        actions: [actions.functionCall(methodName, args, GAS, 0n)],
        waitUntil: "FINAL",
      });
      const ref = txRef(outcome);
      console.log(`tx ${methodName} → ${ref.tx}`);
      if (outcome?.status?.Failure) {
        throw new Error(`${methodName}: ${JSON.stringify(outcome.status.Failure).slice(0, 300)}`);
      }
      return ref;
    } catch (err) {
      if (attempt >= 2 || !isRateLimited(err)) throw err;
      await sleep(1200 * (attempt + 1));
    }
  }
}

// ------------------------------------------------------------------ état en cache
const cache = { at: 0, jobId: null, snap: null };
const scan = { from: 0, workers: new Set(), jobId: null };

/** Parcourt le registre par pages de 50 (incrémental) : travailleurs embauchés + dernière commande. */
async function scanLedger() {
  for (;;) {
    const page = await view("get_ledger", { from: scan.from, limit: 50 });
    for (const entry of page) {
      if (entry.kind === "hire" && entry.detail) scan.workers.add(entry.detail);
      if (/^job-\d{4}$/.test(entry.job ?? "")) scan.jobId = entry.job;
    }
    scan.from += page.length;
    if (page.length < 50) return;
    await sleep(150);
  }
}

async function fetchWorkers() {
  const workers = {};
  for (const account of scan.workers) {
    try {
      workers[account] = await view("get_worker", { account });
    } catch {
      workers[account] = null;
    }
  }
  return workers;
}

async function buildSnapshot(jobId) {
  await scanLedger();
  const id = jobId ?? DEPLOYMENT.site_job ?? scan.jobId;
  const [job, solvency, rules, workers] = await Promise.all([
    id ? view("get_job", { job_id: id }).catch(() => null) : Promise.resolve(null),
    view("get_solvency").catch(() => null),
    view("get_rules").catch(() => null),
    fetchWorkers(),
  ]);
  return { jobId: id ?? null, job, solvency, rules, workers };
}

async function getState(jobId) {
  const fresh = cache.snap && Date.now() - cache.at < STATE_TTL_MS;
  if (fresh && (!jobId || jobId === cache.jobId)) return cache.snap;
  if (fresh && jobId) {
    // Cache encore valide mais commande différente : on ne recharge que la commande.
    const job = await view("get_job", { job_id: jobId }).catch(() => null);
    cache.jobId = jobId;
    cache.snap = { ...cache.snap, jobId, job };
    return cache.snap;
  }
  cache.snap = await buildSnapshot(jobId);
  cache.jobId = cache.snap.jobId;
  cache.at = Date.now();
  return cache.snap;
}

// ------------------------------------------------------------------ validations
const IMPLICIT_RE = /^[0-9a-f]{64}$/;
const NAMED_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function validAccount(value) {
  if (typeof value !== "string" || value.length < 2 || value.length > 64) return false;
  return IMPLICIT_RE.test(value) || NAMED_RE.test(value);
}

function validItems(items) {
  return Array.isArray(items) && items.length > 0 && items.every(
    (it) => it && typeof it.task_id === "string" && validAccount(it.worker) && typeof it.gold === "boolean",
  );
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ------------------------------------------------------------------ routes POST
async function routeHire(body) {
  if (!validAccount(body.worker)) return { ok: false, error: "ERR_BAD_REQUEST", detail: "compte invalide" };
  try {
    const ref = await callAgent("hire", { worker: body.worker });
    return { ok: true, ...ref };
  } catch (err) {
    if (errCode(err) === "ERR_ALREADY_HIRED") {
      console.log(`hire ${body.worker} : déjà embauché (idempotent)`);
      return { ok: true, already: true, tx: null, url: null };
    }
    return { ok: false, error: errCode(err), detail: String(err.message).slice(0, 200) };
  }
}

async function routePay(body) {
  if (typeof body.job_id !== "string" || !validItems(body.items)) {
    return { ok: false, error: "ERR_BAD_REQUEST", detail: "job_id ou items invalides" };
  }
  const refs = [];
  try {
    for (const group of chunk(body.items, MAX_BATCH)) {
      refs.push(await callAgent("pay_batch", { job_id: body.job_id, items: group, amount: null }));
    }
    const last = refs[refs.length - 1];
    return { ok: true, tx: last.tx, url: last.url, txs: refs };
  } catch (err) {
    return { ok: false, error: errCode(err), detail: String(err.message).slice(0, 200), txs: refs };
  }
}

async function routeReject(body) {
  const { job_id: jobId, task_id: taskId, worker, reason, gold } = body;
  if (typeof jobId !== "string" || typeof taskId !== "string" || !validAccount(worker)
    || typeof reason !== "string" || typeof gold !== "boolean") {
    return { ok: false, error: "ERR_BAD_REQUEST", detail: "arguments invalides" };
  }
  try {
    const ref = await callAgent("reject", { job_id: jobId, task_id: taskId, worker, reason, gold });
    return { ok: true, ...ref };
  } catch (err) {
    return { ok: false, error: errCode(err), detail: String(err.message).slice(0, 200) };
  }
}

function normalizeTicket(ticket) {
  if (!ticket || !validAccount(ticket.worker)) return null;
  const amount = BigInt(ticket.amount ?? -1);
  const sig = String(ticket.signature ?? "");
  if (amount <= 0n || !/^[0-9a-fA-F]{128}$/.test(sig)) return null;
  if (!Number.isFinite(Number(ticket.nonce)) || !Number.isFinite(Number(ticket.deadline_ms))) return null;
  // U128 : le contrat attend le montant en chaîne. La signature du navigateur
  // porte sur le JSON canonique (amount numérique) : on ne touche jamais à `signature`.
  return {
    worker: ticket.worker,
    amount: amount.toString(),
    nonce: Number(ticket.nonce),
    deadline_ms: Number(ticket.deadline_ms),
    signature: sig,
  };
}

async function routeWithdraw(body) {
  const ticket = normalizeTicket(body.ticket);
  if (!ticket) return { ok: false, error: "ERR_BAD_REQUEST", detail: "ticket invalide" };
  console.log(`withdraw relayé pour ${ticket.worker} (montant ${ticket.amount})`);
  try {
    const ref = await callAgent("withdraw_signed", { ticket });
    return { ok: true, ...ref };
  } catch (err) {
    return { ok: false, error: errCode(err), detail: String(err.message).slice(0, 200) };
  }
}

/** Méthode RPC « tx » brute : répond immédiatement (provider.txStatus, lui, sonde sans fin). */
async function txOutcome(hash) {
  return Promise.race([
    provider.sendJsonRpc("tx", [hash, AGENT]),
    sleep(10000).then(() => { throw new Error("ERR_TIMEOUT"); }),
  ]);
}

async function routeTx(hash) {
  if (!/^[0-9a-zA-Z]{32,64}$/.test(hash)) return { ok: false, error: "ERR_BAD_REQUEST" };
  try {
    const outcome = await txOutcome(hash);
    const logs = [
      ...(outcome.transaction_outcome?.outcome?.logs ?? []),
      ...(outcome.receipts_outcome ?? []).flatMap((r) => r?.outcome?.logs ?? []),
    ];
    const status = outcome.status?.Failure ? "failure" : outcome.status?.SuccessValue !== undefined ? "success" : "unknown";
    return { ok: status === "success", status, logs };
  } catch (err) {
    if (/doesn't exist|not found|UnknownTransaction|ERR_TIMEOUT/i.test(String(err?.message ?? err))) {
      return { ok: false, status: "pending", logs: [] };
    }
    return { ok: false, status: "error", logs: [], error: errCode(err) };
  }
}

// ------------------------------------------------------------------ serveur HTTP
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (part) => {
      size += part.length;
      if (size > MAX_BODY) {
        reject(new Error("ERR_BAD_REQUEST"));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const route = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && route === "/health") {
    sendJson(res, 200, { ok: true, contract: CONTRACT, agent: AGENT, network: NETWORK });
    return;
  }
  if (req.method === "GET" && route === "/state") {
    const snap = await getState(url.searchParams.get("job") || null);
    sendJson(res, 200, { job: snap.job, solvency: snap.solvency, rules: snap.rules, workers: snap.workers, job_id: snap.jobId });
    return;
  }
  if (req.method === "GET" && route.startsWith("/tx/")) {
    sendJson(res, 200, await routeTx(decodeURIComponent(route.slice(4))));
    return;
  }
  if (req.method === "POST" && ["/hire", "/pay", "/reject", "/withdraw"].includes(route)) {
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      sendJson(res, 400, { ok: false, error: "ERR_BAD_REQUEST", detail: "JSON invalide" });
      return;
    }
    const handler = { "/hire": routeHire, "/pay": routePay, "/reject": routeReject, "/withdraw": routeWithdraw }[route];
    sendJson(res, 200, await handler(body));
    return;
  }
  sendJson(res, 404, { ok: false, error: "ERR_NOT_FOUND" });
}

function parsePort(argv) {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? Number(argv[index + 1]) : Number(process.env.RELAY_PORT ?? 8790);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error("port invalide");
    process.exit(1);
  }
  return value;
}

const PORT = parsePort(process.argv.slice(2));
const server = http.createServer((req, res) => {
  cors(res);
  handleRequest(req, res).catch((err) => {
    // Aucune erreur ne doit faire tomber le processus : on répond, on logge le code.
    console.error(`erreur ${req.method} ${req.url} : ${errCode(err)}`);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: errCode(err) });
    else res.end();
  });
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`relais hireclaw sur 127.0.0.1:${PORT} — contrat ${CONTRACT}, agent ${AGENT}`);
});
