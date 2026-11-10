// Hireclaw — front minimal : clé dans le navigateur, tâche, réponse signée, paiement.
const state = { account: null, privateKey: null, fallback: false, task: null, shownAt: 0, busy: false };

const $ = (id) => document.getElementById(id);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const usdc = (n) => (n / 1e6).toFixed(2) + " USDC";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

function toast(text, bad = false) {
  const node = $("toast");
  node.textContent = text;
  node.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (node.className = "toast"), 2200);
}

function currentView() {
  if (location.pathname.startsWith("/boss")) return "boss";
  if (location.pathname.startsWith("/ledger")) return "ledger";
  return "work";
}

// ------------------------------------------------------------------ identité
async function makeKey() {
  if (!crypto.subtle || !crypto.subtle.generateKey) return false;
  try {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    state.privateKey = pair.privateKey;
    state.account = hex(raw);
    return true;
  } catch (err) {
    return false;
  }
}

async function fallbackWorker() {
  const data = await api("/api/worker", { method: "POST", body: "{}" });
  state.account = data.account;
  state.fallback = true;
}

async function signPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, state.privateKey, bytes);
  return hex(signature);
}

// --------------------------------------------------------------------- travail
async function workInit() {
  const local = await makeKey();
  if (!local) await fallbackWorker();
  $("identity").textContent =
    "compte implicite " + state.account.slice(0, 24) + "…" +
    (state.fallback ? " — clé de secours générée par le serveur (WebCrypto Ed25519 indisponible)" : " — clé créée dans ce navigateur");
  const snap = await api("/api/state");
  $("cap").textContent = usdc(snap.rules.worker_cap);
  await nextTask();
}

async function nextTask() {
  if (state.busy) return;
  state.busy = true;
  $("task-card").classList.add("hidden");
  $("idle-card").classList.remove("hidden");
  $("idle-text").textContent = "Recherche d'une tâche…";
  const card = await api(`/api/task?worker=${state.account}`);
  if (card.empty) {
    $("idle-text").textContent = "Aucune tâche libre pour l'instant : les robots finissent la commande en cours. Une nouvelle arrive dans quelques secondes.";
    state.busy = false;
    setTimeout(nextTask, 2500);
    return;
  }
  state.task = card;
  state.shownAt = performance.now();
  $("task-meta").textContent = `tâche ${card.task_id} · ${usdc(card.pay_usdc)} par réponse validée`;
  $("task-text").textContent = card.text;
  const box = $("choices");
  box.innerHTML = "";
  card.choices.forEach((choice) => {
    const button = document.createElement("button");
    button.textContent = choice;
    button.onclick = () => submit(choice);
    box.appendChild(button);
  });
  $("idle-card").classList.add("hidden");
  $("task-card").classList.remove("hidden");
  state.busy = false;
}

async function submit(choice) {
  const card = state.task;
  if (!card) return;
  const latency = Math.round(performance.now() - state.shownAt);
  const payload = { choice, latency_ms: latency, task_id: card.task_id, worker: state.account };
  const body = { ...payload };
  if (!state.fallback) body.signature = await signPayload(payload);
  document.querySelectorAll("#choices button").forEach((b) => (b.disabled = true));
  const res = await api("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.error) toast("Refusé : " + res.error, true);
  else if (res.task_status === "pay") toast("+ " + usdc(card.pay_usdc));
  else if (res.task_status === "reject") toast("Refusé : " + res.reason, true);
  else toast("En attente d'autres réponses");
  if (res.worker) updateStats(res.worker);
  state.task = null;
  setTimeout(nextTask, 1000);
}

function updateStats(worker) {
  $("earned").textContent = usdc(worker.earned_today);
  $("paid").textContent = worker.tasks_paid;
  $("golds").textContent = worker.golds + (worker.golds ? ` (${worker.accuracy_pct}%)` : "");
}

// --------------------------------------------------------------------- patron
function cells(rows) {
  return rows.map(([label, value]) =>
    `<div class="cell"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
}

async function renderBoss() {
  const snap = await api("/api/state");
  const job = snap.job;
  $("boss-head").innerHTML = cells([
    ["commande", job.id],
    ["état", job.state],
    ["budget bloqué", usdc(job.budget)],
    ["budget de paie restant", usdc(job.payroll_budget - job.payroll_spent)],
    ["paie versée", usdc(job.payroll_spent)],
    ["marge réservée", usdc(job.margin_reserved + job.payroll_left)],
    ["tarif par tâche", usdc(job.pay_per_task)],
    ["contrôles cachés", snap.rules.gold_pct + " %"],
  ]);
  const done = snap.progress.validated;
  const pct = Math.round((100 * done) / Math.max(1, snap.progress.total));
  $("progress-bar").style.width = pct + "%";
  $("progress-text").textContent = `${done}/${snap.progress.total} éléments validés (${pct} %) · ` +
    (snap.last_delivery ? `dernière livraison ${snap.last_delivery.correct}/${snap.last_delivery.total} corrects` : "aucune livraison encore");

  $("workers").innerHTML =
    "<tr><th>Travailleur</th><th>Statut</th><th>Payées</th><th>Refusées</th><th>Contrôles</th><th>Exactitude</th><th>Gagné</th></tr>" +
    snap.workers.map((w) => `<tr><td class="mono">${esc(w.account.slice(0, 10))}…</td>
      <td><span class="tag ${esc(w.status)}">${esc(w.status)}</span></td>
      <td class="num">${w.tasks_paid}</td><td class="num">${w.tasks_rejected}</td>
      <td class="num">${w.golds}</td><td class="num">${w.accuracy_pct}%</td>
      <td class="num">${usdc(w.earned_total)}</td></tr>`).join("");

  const money = snap.ledger.filter((e) => ["payroll", "reject", "cost", "sale", "margin", "withdraw"].includes(e.kind)).slice(-12).reverse();
  $("payments").innerHTML =
    "<tr><th>#</th><th>Type</th><th>Montant</th><th>Détail</th></tr>" +
    money.map((e) => `<tr><td class="mono">${e.seq}</td><td>${esc(e.kind)}</td>
      <td class="num">${e.amount ? usdc(e.amount) : "—"}</td>
      <td>${esc(e.detail || e.reason)}</td></tr>`).join("");

  $("decisions").innerHTML = snap.decisions.slice(-8).reverse()
    .map((d) => `<li><strong>${esc(d.detail)}</strong> — ${esc(d.reason)}</li>`).join("");
}

// ------------------------------------------------------------------- registre
async function renderLedger() {
  const snap = await api("/api/state");
  const rules = snap.rules;
  $("rules").innerHTML = cells([
    ["salaire plancher", usdc(rules.pay_min)],
    ["plafond par tâche", usdc(rules.pay_max)],
    ["marge mini", rules.margin_pct + " %"],
    ["redondance", rules.redundancy + " réponses"],
    ["contrôles cachés", rules.gold_pct + " %"],
    ["plafond travailleur/jour", usdc(rules.worker_cap)],
    ["payer ou refuser", rules.pay_or_reject_s + " s"],
    ["pause", snap.paused ? "active" : "non"],
  ]);
  $("ledger").innerHTML =
    "<tr><th>#</th><th>Type</th><th>Acteur</th><th>Montant</th><th>Détail</th></tr>" +
    snap.ledger.slice().reverse().map((e) => `<tr><td class="mono">${e.seq}</td>
      <td>${esc(e.kind)}</td><td class="mono">${esc(e.actor.slice(0, 10))}…</td>
      <td class="num">${e.amount ? usdc(e.amount) : "—"}</td>
      <td>${esc(e.detail || e.reason)}</td></tr>`).join("");
}

// ------------------------------------------------------------------ on-chain
async function renderChain() {
  const data = await api("/api/testnet");
  if (!data.available) {
    $("chain-note").textContent = "Contrat testnet non déployé : " + (data.reason || "");
    return;
  }
  const sol = data.solvency || {};
  $("chain-note").innerHTML =
    `Contrat <a class="mono" href="${esc(data.explorer)}" target="_blank" rel="noopener">${esc(data.contract)}</a> ` +
    `· jeton ${esc(data.token)} · déployé le ${esc((data.deployed_at || "").slice(0, 10))}`;
  $("chain").innerHTML = cells([
    ["solde USDC", usdc(Number(sol.balance || 0))],
    ["somme des engagements", usdc(Number(sol.sum || 0))],
    ["invariant C-I1", sol.balanced ? "équilibré" : "VIOLÉ"],
    ["paie bloquée", usdc(Number(sol.payroll_held || 0))],
    ["marges réservées", usdc(Number(sol.margins_held || 0))],
    ["propriétaire", usdc(Number((sol.buckets || {}).owner || 0))],
    ["réserve", usdc(Number((sol.buckets || {}).reserve || 0))],
    ["contributeurs", usdc(Number((sol.buckets || {}).contributors || 0))],
  ]);
  const rows = Array.isArray(data.ledger) ? data.ledger.slice(-12).reverse() : [];
  $("chain-ledger").innerHTML =
    "<tr><th>#</th><th>Type</th><th>Montant</th><th>Détail</th></tr>" +
    rows.map((e) => `<tr><td class="mono">${e.seq}</td><td>${esc(e.kind)}</td>
      <td class="num">${Number(e.amount) ? usdc(Number(e.amount)) : "—"}</td>
      <td>${esc(e.detail || e.reason)}</td></tr>`).join("");
}

// ----------------------------------------------------------------------- init
function markNav() {
  const view = currentView();
  document.querySelectorAll("nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) =>
    section.classList.toggle("hidden", section.id !== "view-" + view));
}

document.addEventListener("DOMContentLoaded", async () => {
  markNav();
  const view = currentView();
  if (view === "work") {
    await workInit();
    return;
  }
  const render = view === "boss" ? renderBoss : () => Promise.all([renderLedger(), renderChain()]);
  await render();
  setInterval(render, 2000);
});