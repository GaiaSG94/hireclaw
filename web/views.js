// Hireclaw — "proof" views: replayed demo, testnet contract, code inventory.
// Loaded before app.js: it registers its renderers in window.HIRECLAW_VIEWS.
const usdc6 = (micro) => (Number(micro) / 1e6).toFixed(6);
const usdc2 = (micro) => (Number(micro) / 1e6).toFixed(2) + " USDC";
const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;

function table(headers, rows) {
  return `<table><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${rows.join("")}</table>`;
}

// ---------------------------------------------------------------------- demo
async function renderDemo() {
  const d = await api("/api/demo");
  $("demo-head").innerHTML = cells([
    ["job", d.job.id],
    ["prepaid budget", usdc2(d.job.budget)],
    ["margin reserved", usdc2(d.job.margin_reserved)],
    ["payroll budget", usdc2(d.job.payroll_budget)],
    ["payroll paid", usdc2(d.job.payroll_spent)],
    ["inference (from margin)", usdc6(d.job.inference_spent)],
    ["delivered accuracy", `${d.delivery.correct}/${d.delivery.total}`],
    ["cost per label", usdc6(d.delivery.cost_per_label)],
    ["tasks served", d.steps],
    ["duration", d.elapsed_s + " s"],
  ]);

  $("demo-crew").innerHTML = table(
    ["bot", "profile", "simulated accuracy", "implicit account"],
    d.crew.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.profile)}</td>
      <td class="num">${r.accuracy}%</td><td class="mono">${esc(r.account.slice(0, 20))}…</td></tr>`),
  );

  $("demo-workers").innerHTML = table(
    ["worker", "status", "paid", "rejected", "checks", "accuracy", "earned"],
    d.workers.map((w) => `<tr><td class="mono">${esc(w.account.slice(0, 10))}…</td>
      <td><span class="tag ${esc(w.status)}">${esc(w.status)}</span></td>
      <td class="num">${w.tasks_paid}</td><td class="num">${w.tasks_rejected}</td>
      <td class="num">${w.golds}</td><td class="num">${w.accuracy_pct}%</td>
      <td class="num">${usdc2(w.earned_total)}</td></tr>`),
  );

  $("demo-attacks").innerHTML = table(
    ["attack", "expected code", "actual", ""],
    d.attacks.map((a) => `<tr><td>${esc(a.label)}</td><td class="mono">${esc(a.expected)}</td>
      <td class="mono">${esc(a.actual)}</td><td>${a.ok ? "✅" : "❌"}</td></tr>`),
  );

  const b = d.delivery.buckets;
  const s = d.solvency;
  $("demo-close").innerHTML = cells([
    ["delivered dataset hash", d.delivery.result_hash.slice(0, 24) + "…"],
    ["margin → owner", usdc2(b.owner)],
    ["margin → reserve", usdc2(b.reserve)],
    ["margin → contributors", usdc2(b.contributors)],
    ["contract balance", usdc2(s.balance)],
    ["total liabilities", usdc2(s.sum)],
    ["conservation", s.balance === s.sum ? "verified" : "VIOLATED"],
    ["invariants", d.invariants.join(", ")],
  ]);
  $("demo-fired").textContent = d.fired.length ? d.fired.join(" · ") : "no firings";
}

// ------------------------------------------------------------------- testnet
async function renderTestnet() {
  const t = await api("/api/testnet");
  if (!t.available) {
    $("chain-head").innerHTML = cells([["state", t.reason || "not deployed"]]);
    return;
  }
  const proof = t.proof || {};
  const sol = t.solvency || {};
  $("chain-head").innerHTML = cells([
    ["network", t.network],
    ["contract", t.contract],
    ["agent", t.agent],
    ["client", t.client],
    ["NEP-141 token", t.token],
    ["WASM", t.wasm?.built ? `${(t.wasm.bytes / 1024).toFixed(0)} KB` : "not built"],
    ["sha256", (t.wasm?.sha256 || "").slice(0, 16) + "…"],
    ["explorer", link(t.explorer, "nearblocks")],
  ]);

  $("chain-live").innerHTML = cells([
    ["USDC balance", usdc6(sol.balance)],
    ["payroll locked", usdc6(sol.payroll_held)],
    ["margins reserved", usdc6(sol.margins_held)],
    ["owner", usdc6(sol.buckets?.owner)],
    ["reserve", usdc6(sol.buckets?.reserve)],
    ["contributors", usdc6(sol.buckets?.contributors)],
    ["pending withdrawal", usdc6(sol.withdrawable_total)],
    ["invariant C-I1", sol.balanced ? "balanced ✅" : "VIOLATED ❌"],
  ]);

  const txs = proof.transactions || [];
  $("chain-tx").innerHTML = txs.length
    ? table(["step", "status", "transaction"], txs.map((x) => `<tr><td>${esc(x.step)}</td>
        <td>${x.ok ? "✅" : "❌"}</td><td class="mono">${link(x.url, (x.tx || "").slice(0, 12) + "…")}</td></tr>`))
    : "<p class='muted'>No proof transaction: run <code>make testnet-e2e</code>.</p>";

  const abi = t.abi || [];
  $("chain-abi-note").textContent = abi.length
    ? "Repository ABI (local build). The build deployed on testnet exposes one method fewer: "
      + "promote (senior status) ships with the next redeployment."
    : "";
  $("chain-abi").innerHTML = abi.length
    ? table(["method", "type"], abi.map((f) => `<tr><td class="mono">${esc(f.name)}</td><td>${esc(f.kind)}</td></tr>`))
    : "<p class='muted'>ABI missing: run <code>make build-contract</code>.</p>";

  if (t.rules && !t.rules.error) {
    $("chain-rules").innerHTML = cells([
      ["floor / cap", `${usdc6(t.rules.task_pay_min)} / ${usdc6(t.rules.task_pay_max)}`],
      ["minimum margin", t.rules.min_margin_pct + "%"],
      ["worker cap/day", usdc6(t.rules.worker_cap_per_day)],
      ["payroll cap/day", usdc6(t.rules.payroll_cap_per_day)],
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
    ["repository", link(c.repo.github, "GaiaSG94/hireclaw")],
    ["branch", c.repo.branch],
    ["commit", c.repo.commit],
    ["last message", c.repo.subject],
    ["date", c.repo.date],
    ["files", t.files],
    ["lines of code", t.lines],
    ["longest file", `${t.max_file} (${t.max_file_lines}/${t.limit_file})`],
  ]);
  $("code-tests").innerHTML = cells([
    ["Python tests", c.tests.python],
    ["Rust unit tests", c.tests.rust_unit],
    ["NEAR sandbox test", c.tests.rust_sandbox],
    ["attacks verified", c.tests.attacks],
    ["function limit", "< " + t.limit_fn + " lines"],
  ]);
  const byLang = {};
  c.files.forEach((f) => {
    byLang[f.lang] = byLang[f.lang] || { n: 0, lines: 0 };
    byLang[f.lang].n += 1;
    byLang[f.lang].lines += f.lines;
  });
  $("code-files").innerHTML = table(
    ["language", "files", "lines"],
    Object.entries(byLang).map(([lang, v]) => `<tr><td>${esc(lang)}</td>
      <td class="num">${v.n}</td><td class="num">${v.lines}</td></tr>`),
  );
  const doc = await api("/api/readme");
  $("code-readme").textContent = doc.text || "(README missing)";
  $("code-tree").innerHTML = table(
    ["file", "lines"],
    c.files.map((f) => `<tr><td class="mono">${esc(f.path)}</td><td class="num">${f.lines}</td></tr>`),
  );
}

window.HIRECLAW_VIEWS = { demo: renderDemo, testnet: renderTestnet, code: renderCode };