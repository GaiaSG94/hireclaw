/* Hireclaw — branchement du rejeu RÉEL sur la scène verrouillée (V10).
   Chargé après v9-ui.js. Si GET /api/replay répond, chaque étape du scénario
   embarqué est annotée avec l'événement réel du registre (seq, kind, détail,
   motif, montant, nom du robot). Si l'API est absente (page ouverte hors ligne,
   en fichier local), le scénario embarqué reste inchangé : rien ne casse.

   Aucune modification du moteur : on mutate le tableau STEPS partagé
   (window.HC9.STEPS), que le moteur relit à chaque étape. */
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
    if ("fx" in ev) return ev.fx;           // déjà calculé par le serveur (null = aucun fx)
    if (ev.kind === "reject") return /too_fast/.test(ev.reason || "") ? "fast" : "minority";
    return KIND_FX[ev.kind] || null;
  }

  function usdc(micro) { return (Number(micro) / 1e6).toFixed(2); }

  function cleanDetail(ev) {
    // un refus porte "t00094 / <compte>" : on préfère "t00094 · dora"
    if (ev.kind === "reject" && ev.who) {
      return ev.who + " · " + String(ev.detail || "").split(" / ")[0];
    }
    if (ev.kind === "fire" && ev.who) return ev.who;   // le détail est le compte complet (64 hex)
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
      ? "Le rejeu réel diffère du scénario embarqué : le scénario embarqué est affiché."
      : "Chaque étape est annotée avec l'événement réel du registre (GET /api/replay).";
  }

  function annotate(steps, events) {
    var used = {};
    var hits = 0;
    steps.forEach(function (s, i) {
      var ev = null;
      // si l étape nomme un humain (dora, eli), on prend son événement à lui
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
      if (typeof ev.seq === "number") real.push("registre #" + ev.seq);
      if (ev.amount) real.push(usdc(ev.amount) + " USDC");
      var det = cleanDetail(ev);
      if (det) real.push(det);
      if (ev.reason) real.push("motif : " + ev.reason);
      s.code = s.code + " · " + real.join(" · ");
      s.real = ev;
      var code = document.querySelector('#timeline li[data-i="' + i + '"] code');
      if (code) code.textContent = s.code;
    });
    return hits;
  }

  function sameMoney(job) {
    // le scénario embarqué joue 1.20 de budget et 0.98 de paie : on vérifie
    // (la marge réservée retombe à 0 après deliver, elle n'est pas comparable ici)
    return Number(job.budget) === 1200000 && Number(job.payroll_spent) === 980000;
  }

  fetch(ENDPOINT).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data || !data.events || !window.HC9 || !window.HC9.STEPS) return;
    var steps = window.HC9.STEPS;
    var job = data.job || {};
    if (!sameMoney(job)) {
      badge("rejeu réel · montants différents", true);
      window.HC9_REAL = data;
      return;
    }
    var hits = annotate(steps, data.events);
    var sol = data.solvency || {};
    var ok = (data.attacks || []).filter(function (a) { return a.ok; }).length;
    badge("rejeu réel · " + hits + "/" + steps.length + " étapes au registre · " + ok + "/" +
      (data.attacks || []).length + " attaques refusées · " + (sol.balanced ? "balanced: true" : "C-I1 VIOLÉ"), false);
    window.HC9_REAL = data;
  }).catch(function () { /* hors ligne : scénario embarqué, aucun badge */ });
})();
