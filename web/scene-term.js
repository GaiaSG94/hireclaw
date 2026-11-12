/* Hireclaw — the live terminal of the scene. Black on white reversed: it prints,
   step by step, what is being written to the ledger. With GET /api/replay the
   lines are the real ledger events; in the static copy they come from the scenario.
   Position: ?term=right (default) · ?term=below · ?term=off. Listens to "hc9:step". */
(function () {
  "use strict";
  var mode = (new URLSearchParams(location.search).get("term") || "right");
  if (mode === "off") return;
  var WHO = { client: "client", contract: "contract", agent: "agent", workers: "workers", paid: "workers", dora: "dora", eli: "eli", all: "everyone" };

  var box = document.createElement("aside");
  box.className = "term";
  box.innerHTML = '<header><i></i><i></i><i></i><b>ledger — live</b><span id="termSrc">built-in scenario</span></header><pre id="termOut"></pre>';
  document.body.appendChild(box);
  var out = box.querySelector("#termOut"), queue = [], busy = false, lastStep = -2;

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function pad(s, n) { s = String(s); return s.length >= n ? s : s + new Array(n - s.length + 1).join(" "); }
  function usdc(micro) { var v = Number(micro) / 1e6; return v.toFixed(v < 0.01 ? 4 : 2); }

  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    var line = queue.shift(), el = document.createElement("div");
    el.className = line.cls || ""; el.innerHTML = line.html;
    out.appendChild(el);
    while (out.childNodes.length > 80) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
    setTimeout(function () { busy = false; pump(); }, line.wait || 110);
  }
  function say(html, cls, wait) { queue.push({ html: html, cls: cls, wait: wait }); pump(); }

  // the real ledger events that belong to a step: same fx, and the same human when the step names one
  function realEvents(step) {
    var data = window.HC9_REAL;
    if (!data || !data.events) return [];
    var named = /^(alice|bob|chloe|dora|eli)$/.test(step.b || "") ? step.b : null;
    return data.events.filter(function (e) {
      if (e.fx !== step.fx || (named && e.who !== named)) return false;
      return !(step.fx === "margin" && e.kind !== "accept");   // inference costs share the fx: keep the acceptance only
    }).slice(0, 4);
  }

  function printStep(i, step, total) {
    var head = pad(String(i + 1).padStart(2, "0") + "/" + total, 6) + WHO[step.a] + (step.b ? " → " + WHO[step.b] : "");
    say('<b>' + esc(head) + '</b>  <u>' + esc(step.code.split(" · ")[0]) + "</u>", "h", 160);
    var evs = realEvents(step);
    if (evs.length) {
      document.getElementById("termSrc").textContent = window.HC9_RECORDED ? "real ledger · recorded" : "real ledger · /api/replay";
      evs.forEach(function (e) {
        var who = /^(alice|bob|chloe|dora|eli)$/.test(e.who || "") ? e.who : "";
        var bits = ["#" + pad(e.seq, 3), pad(e.kind, 8)]; if (who) bits.push(pad(who, 6));
        if (e.amount) bits.push(usdc(e.amount) + " USDC");
        if (e.reason) bits.push(e.reason);
        else if (e.detail && e.kind !== "fire" && e.kind !== "hire") bits.push(e.detail);
        say("  " + esc(bits.join("  ")), /reject|fire/.test(e.kind) ? "x" : "");
      });
    } else {
      say("  " + esc(step.lab ? step.lab : step.t.toLowerCase()), step.k === "refus" ? "x" : "");
    }
    if (step.fx === "balance") say("  <b>balanced: true</b> — 1.20 held = 1.20 owed", "ok", 200);
  }

  document.addEventListener("hc9:step", function (ev) {
    var d = ev.detail;
    if (d.i < 0) { out.innerHTML = ""; queue = []; lastStep = -2; say("$ waiting — press “Run the scenario”", "dim"); return; }
    if (d.i === lastStep) return;
    if (d.i === 0 || d.i < lastStep) { out.innerHTML = ""; queue = []; say("$ hireclaw replay --job job-0001", "dim", 200); }
    lastStep = d.i;
    printStep(d.i, d.step, d.total);
  });
  say("$ waiting — press “Run the scenario”", "dim");
})();
