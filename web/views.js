// Hireclaw — vues « preuves » : démo rejouée, contrat testnet, inventaire du code.
// Chargé avant app.js : il enregistre ses rendus dans window.HIRECLAW_VIEWS.
const usdc6 = (micro) => (Number(micro) / 1e6).toFixed(6);
const usdc2 = (micro) => (Number(micro) / 1e6).toFixed(2) + " USDC";
const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;

function table(headers, rows) {
  return `<table><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.join("")}</table>`;
}

// ---------------------------------------------------------------------- démo
async function renderDemo() {
  const d = await api("/api/demo");
  $("demo-head").innerHTML = cells([
    ["commande", d.job.id],
    ["budget payé d'avance", usdc2(d.job.budget)],
    ["marge réservée", usdc2(d.job.margin_reserved)],
    ["budget de paie", usdc2(d.job.payroll_budget)],
    ["paie versée", usdc2(d.job.payroll_spent)],
    ["inférence (sur la marge)", usdc6(d.job.inference_spent)],
    ["exactitude livrée", `${d.delivery.correct}/${d.delivery.total}`],
    ["coût par étiquette", usdc6(d.delivery.cost_per_label)],
    ["tâches servies", d.steps],
    ["durée", d.elapsed_s + " s"],
  ]);

  $("demo-crew").innerHTML = table(
    ["robot", "profil", "exactitude simulée", "compte implicite"],
    d.crew.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.profile)}</td>
      <td class="num">${r.accuracy}%</td><td class="mono">${esc(r.account.slice(0, 20))}…</td></tr>`),
  );

  $("demo-workers").innerHTML = table(
    ["travailleur", "statut", "payées", "refusées", "contrôles", "exactitude", "gagné"],
    d.workers.map((w) => `<tr><td class="mono">${esc(w.account.slice(0, 10))}…</td>
      <td><span class="tag ${esc(w.status)}">${esc(w.status)}</span></td>
      <td class="num">${w.tasks_paid}</td><td class="num">${w.tasks_rejected}</td>
      <td class="num">${w.golds}</td><td class="num">${w.accuracy_pct}%</td>
      <td class="num">${usdc2(w.earned_total)}</td></tr>`),
  );

  $("demo-attacks").innerHTML = table(
    ["attaque", "code attendu", "obtenu", ""],
    d.attacks.map((a) => `<tr><td>${esc(a.label)}</td><td class="mono">${esc(a.expected)}</td>
      <td class="mono">${esc(a.actual)}</td><td>${a.ok ? "✅" : "❌"}</td></tr>`),
  );

  const b = d.delivery.buckets;
  const s = d.solvency;
  $("demo-close").innerHTML = cells([
    ["empreinte du jeu livré", d.delivery.result_hash.slice(0, 24) + "…"],
    ["marge → propriétaire", usdc2(b.owner)],
    ["marge → réserve", usdc2(b.reserve)],
    ["marge → contributeurs", usdc2(b.contributors)],
    ["solde du contrat", usdc2(s.balance)],
    ["total des engagements", usdc2(s.sum)],
    ["conservation", s.balance === s.sum ? "vérifiée" : "VIOLÉE"],
    ["invariants", d.invariants.join(", ")],
  ]);
  $("demo-fired").textContent = d.fired.length ? d.fired.join(" · ") : "aucun renvoi";
}

// ------------------------------------------------------------------- testnet
async function renderTestnet() {
  const t = await api("/api/testnet");
  if (!t.available) {
    $("chain-head").innerHTML = cells([["état", t.reason || "non déployé"]]);
    return;
  }
  const proof = t.proof || {};
  const sol = t.solvency || {};
  $("chain-head").innerHTML = cells([
    ["réseau", t.network],
    ["contrat", t.contract],
    ["agent", t.agent],
    ["client", t.client],
    ["jeton NEP-141", t.token],
    ["WASM", t.wasm?.built ? `${(t.wasm.bytes / 1024).toFixed(0)} KB` : "non compilé"],
    ["sha256", (t.wasm?.sha256 || "").slice(0, 16) + "…"],
    ["explorateur", link(t.explorer, "nearblocks")],
  ]);

  $("chain-live").innerHTML = cells([
    ["solde USDC", usdc6(sol.balance)],
    ["paie bloquée", usdc6(sol.payroll_held)],
    ["marges réservées", usdc6(sol.margins_held)],
    ["propriétaire", usdc6(sol.buckets?.owner)],
    ["réserve", usdc6(sol.buckets?.reserve)],
    ["contributeurs", usdc6(sol.buckets?.contributors)],
    ["en attente de retrait", usdc6(sol.withdrawable_total)],
    ["invariant C-I1", sol.balanced ? "équilibré ✅" : "VIOLÉ ❌"],
  ]);

  const txs = proof.transactions || [];
  $("chain-tx").innerHTML = txs.length
    ? table(["étape", "état", "transaction"], txs.map((x) => `<tr><td>${esc(x.step)}</td>
        <td>${x.ok ? "✅" : "❌"}</td><td class="mono">${link(x.url, (x.tx || "").slice(0, 12) + "…")}</td></tr>`))
    : "<p class='muted'>Aucune transaction de preuve : lance <code>make testnet-e2e</code>.</p>";

  const abi = t.abi || [];
  $("chain-abi").innerHTML = abi.length
    ? table(["méthode", "type"], abi.map((f) => `<tr><td class="mono">${esc(f.name)}</td><td>${esc(f.kind)}</td></tr>`))
    : "<p class='muted'>ABI absente : lance <code>make build-contract</code>.</p>";

  if (t.rules && !t.rules.error) {
    $("chain-rules").innerHTML = cells([
      ["plancher / plafond", `${usdc6(t.rules.task_pay_min)} / ${usdc6(t.rules.task_pay_max)}`],
      ["marge minimale", t.rules.min_margin_pct + " %"],
      ["plafond travailleur/jour", usdc6(t.rules.worker_cap_per_day)],
      ["plafond de paie/jour", usdc6(t.rules.payroll_cap_per_day)],
      ["split", t.rules.revenue_split.join(" / ")],
      ["kill switch", String(t.rules.kill_switch)],
    ]);
  }
}

// ---------------------------------------------------------------------- code
async function renderCode() {
  const c = await api("/api/code");
  const t = c.totals;
  $("code-head").innerHTML = cells([
    ["dépôt", link(c.repo.github, "BaptisteFaisy/hireclaw")],
    ["branche", c.repo.branch],
    ["commit", c.repo.commit],
    ["dernier message", c.repo.subject],
    ["date", c.repo.date],
    ["fichiers", t.files],
    ["lignes de code", t.lines],
    ["plus long fichier", `${t.max_file} (${t.max_file_lines}/${t.limit_file})`],
  ]);
  $("code-tests").innerHTML = cells([
    ["tests Python", c.tests.python],
    ["tests unitaires Rust", c.tests.rust_unit],
    ["test sandbox NEAR", c.tests.rust_sandbox],
    ["attaques vérifiées", c.tests.attacks],
    ["limite fonction", "< " + t.limit_fn + " lignes"],
  ]);
  const byLang = {};
  c.files.forEach((f) => {
    byLang[f.lang] = byLang[f.lang] || { n: 0, lines: 0 };
    byLang[f.lang].n += 1;
    byLang[f.lang].lines += f.lines;
  });
  $("code-files").innerHTML = table(
    ["langage", "fichiers", "lignes"],
    Object.entries(byLang).map(([lang, v]) => `<tr><td>${esc(lang)}</td>
      <td class="num">${v.n}</td><td class="num">${v.lines}</td></tr>`),
  );
  $("code-tree").innerHTML = table(
    ["fichier", "lignes"],
    c.files.map((f) => `<tr><td class="mono">${esc(f.path)}</td><td class="num">${f.lines}</td></tr>`),
  );
}

window.HIRECLAW_VIEWS = { demo: renderDemo, testnet: renderTestnet, code: renderCode };