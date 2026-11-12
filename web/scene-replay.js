/* Hireclaw — plugs the REAL replay into the scene. Loaded after v9-ui.js.
   When GET /api/replay answers, each step of the built-in scenario is annotated
   with the matching ledger event (seq, kind, detail, reason, amount, robot name).
   When the API is absent (static copy, offline), the built-in scenario is left
   untouched. The engine is not modified: we mutate the shared STEPS array. */
(function () {
  "use strict";

  var ENDPOINT = "/api/replay";
  var BADGE_ID = "realBadge";

  // kind du registre → fx du moteur (table de correspondance du HANDOFF)
  var KIND_FX = {
    order: "order", accept: "margin", hire: "hire", payroll: "pay",
    fire: "fire", sale: "deliver", margin: "split", claim: "pay", cost: "margin"
  };

  function fxOf(ev) {
    if ("fx" in ev) return ev.fx;           // already computed by the server (null = no fx)
    if (ev.kind === "reject") return /too_fast/.test(ev.reason || "") ? "fast" : "minority";
    return KIND_FX[ev.kind] || null;
  }

  function usdc(micro) { return (Number(micro) / 1e6).toFixed(2); }

  function cleanDetail(ev) {
    // a rejection carries "t00094 / <account>": we show "dora · t00094"
    if (ev.kind === "reject" && ev.who) {
      return ev.who + " · " + String(ev.detail || "").split(" / ")[0];
    }
    if (ev.kind === "fire" && ev.who) return ev.who;   // the detail is the full account (64 hex)
    return ev.detail || "";
  }

  function badge(text, warn) {
    var acts = document.body;
    var el = document.getElementById(BADGE_ID);
    if (!el) {
      el = document.createElement("span");
      el.id = BADGE_ID;
      el.style.cssText = "position:fixed;z-index:15;left:24px;top:66px;font:500 11px/1 var(--f-mono,monospace);" +
        "padding:6px 10px;border:1px solid currentColor;border-radius:99px;white-space:nowrap;background:#fff";
      acts.appendChild(el);
    }
    el.textContent = text;
    el.style.color = warn ? "#b42318" : "#0a0a0b";
    el.title = warn
      ? "The real replay differs from the built-in scenario: the built-in scenario is shown."
      : "Each step is annotated with the real ledger event (GET /api/replay).";
  }

  function annotate(steps, events) {
    var used = {};
    var hits = 0;
    steps.forEach(function (s, i) {
      var ev = null;
      // when the step names a human (dora, eli), take that person's own event
      var named = /^(alice|bob|chloe|dora|eli)$/.test(s.b || "") ? s.b : null, pick = -1;
      for (var j = 0; j < events.length; j++) {
        if (used[j] || fxOf(events[j]) !== s.fx) continue;
        if (named && events[j].who !== named) { if (pick < 0) pick = j; continue; }
        pick = j; break;
      }
      if (pick >= 0 && named && events[pick].who !== named) pick = -1;
      if (pick >= 0) { ev = events[pick]; used[pick] = true; }
      if (!ev) return;
      hits++;
      var real = [];
      if (ev.kind) real.push(ev.kind);
      if (typeof ev.seq === "number") real.push("ledger #" + ev.seq);
      if (ev.amount) real.push(usdc(ev.amount) + " USDC");
      var det = cleanDetail(ev);
      if (det) real.push(det);
      if (ev.reason) real.push("reason: " + ev.reason);
      s.code = s.code + " · " + real.join(" · ");
      s.real = ev;
      var code = document.querySelector('#timeline li[data-i="' + i + '"] code');
      if (code) code.textContent = s.code;
    });
    return hits;
  }

  function sameMoney(job) {
    // the built-in scenario plays a 1.20 budget and 0.98 of payroll: check both
    // (the reserved margin drops to 0 after deliver, so it cannot be compared here)
    return Number(job.budget) === 1200000 && Number(job.payroll_spent) === 980000;
  }

  // static copy (GitHub Pages): no server, so read the replay recorded in replay.json
  var RECORDED = /github\.io$/.test(location.hostname);
  if (location.protocol === "file:") return;
  fetch(RECORDED ? "replay.json" : ENDPOINT).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data || !data.events || !window.HC9 || !window.HC9.STEPS) return;
    var steps = window.HC9.STEPS;
    var job = data.job || {};
    if (!sameMoney(job)) {
      badge("real replay · amounts differ", true);
      window.HC9_REAL = data;
      return;
    }
    var hits = annotate(steps, data.events);
    var sol = data.solvency || {};
    var ok = (data.attacks || []).filter(function (a) { return a.ok; }).length;
    badge((RECORDED ? "recorded replay · " : "real replay · ") + hits + "/" + steps.length + " steps on the ledger · " + ok + "/" +
      (data.attacks || []).length + " attacks refused · " + (sol.balanced ? "balanced: true" : "C-I1 VIOLATED"), false);
    window.HC9_REAL = data; window.HC9_RECORDED = RECORDED;
  }).catch(function () { /* offline: built-in scenario, no badge */ });
})();
