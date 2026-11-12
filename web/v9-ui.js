/* Hireclaw v9 — les 10 planches (configuration) + l'interface en surimpression.
   Une seule source : chaque page v9-NN-*.html ne fait que nommer sa planche. */
(function () {
  "use strict";
  const GROT = '"Inter","Geist","SF Pro Display","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif';
  const SERIF = '"Sitka Display","Sitka Heading","New York","Iowan Old Style",Georgia,serif';
  const MONO = '"Geist Mono","SF Mono","Cascadia Mono",Consolas,ui-monospace,monospace';

  const PLATES = {
    "01": { name: "Ligne", file: "v9-01-ligne.html", layout: "ligne", ortho: true, yaw: -.5, pitch: .55, explain: "timeline", ox: .11, spanX: 12.6, spanY: 7.6, labelSide: "right", focus: [-.7, .1, .4],
      pitchline: "Lecture de gauche à droite, les 15 étapes toujours visibles à gauche." },
    "02": { name: "Strates", file: "v9-02-strates.html", layout: "strates", ortho: true, yaw: -.5, pitch: .4, floor: "planes", link: "drop", explain: "ruler", spanX: 13, spanY: 10.5, ox: .06, focus: [0, .2, 0],
      pitchline: "Trois étages de verre : qui commande, qui garde l'argent, qui travaille. L'argent descend." },
    "03": { name: "Orbite", file: "v9-03-orbite.html", layout: "orbite", persp: 16, yaw: .25, pitch: .62, floor: "rings", explain: "ruler", spanX: 14.5, spanY: 8.6, focus: [-.9, 0, 0],
      pitchline: "Le contrat au centre, les humains en orbite. Tout passe par le centre." },
    "04": { name: "Plan", file: "v9-04-plan.html", layout: "ligne", ortho: true, yaw: 0, pitch: 1.22, sway: 0, floor: "dots", link: "ortho", explain: "inscene", type: "mono", spanX: 13, spanY: 9.4, labelSide: "right", focus: [-.6, 0, .9],
      pitchline: "Vue de dessus, trame de points, l'explication se pose à côté de l'action." },
    "05": { name: "Scène", file: "v9-05-scene.html", layout: "scene", persp: 13, yaw: 0, pitch: .44, sway: .07, explain: "caption", type: "serif", spanX: 12, spanY: 6.2, oy: -.07, focus: [0, 1, 1.6],
      pitchline: "Caméra basse, une phrase à la fois en grande serif. Le plus cinéma." },
    "06": { name: "Colonne", file: "v9-06-colonne.html", layout: "colonne", ortho: true, yaw: -.45, pitch: .44, floor: "rings", link: "drop", explain: "timeline", ox: .1, accent: "#1f3fff", spanX: 11, spanY: 9.6, focus: [.6, .9, 0],
      pitchline: "Vertical : l'argent tombe du client vers les humains. Seul l'argent est bleu." },
    "07": { name: "Grille", file: "v9-07-grille.html", layout: "grille", ortho: true, yaw: -.6, pitch: .6, floor: "grid", explain: "ruler", useCase: 1, spanX: 13, spanY: 8.6, focus: [-.4, .6, 0],
      pitchline: "L'échelle : 18 humains en rangs, l'agent au-dessus du contrat." },
    "08": { name: "Pur", file: "v9-08-pur.html", layout: "eventail", persp: 18, yaw: -.12, pitch: .5, links: "active", explain: "caption", type: "thin", spanX: 12.5, spanY: 7.4, oy: -.05, focus: [-.2, 0, .6],
      pitchline: "Rien que les sphères. Un lien n'apparaît que lorsqu'il sert." },
    "09": { name: "Schéma", file: "v9-09-schema.html", layout: "schema", ortho: true, yaw: 0, pitch: 0, sway: 0, shadow: false, explain: "timeline", ox: .11, spanX: 12.4, spanY: 8, labelSide: "right", focus: [-.6, 1, 0],
      pitchline: "De face, comme un schéma d'ingénieur — mais en verre, et on peut tourner autour." },
    "10": { name: "Cercle", file: "v9-10-cercle.html", layout: "cercle", ortho: true, yaw: 0, pitch: .72, sway: .16, floor: "rings", link: "curve", explain: "ruler", accent: "#00a26b", spanX: 13, spanY: 7.6, focus: [0, 0, 0],
      pitchline: "Tous sur un même cercle, l'argent en vert traverse la table." }
  };
  window.V9_PLATES = PLATES;
  if (!document.body || !document.body.dataset.plate) return;

  const id = document.body.dataset.plate, cfg = Object.assign({}, PLATES[id]);
  const embed = /[?&]embed/.test(location.search);
  cfg.pad = cfg.pad || { timeline: [84, 56, 130, 392], ruler: [100, 56, 236, 56], caption: [96, 80, 320, 80], inscene: [84, 56, 130, 56] }[cfg.explain];
  if (embed) cfg.pad = [50, 60, 250, 60];
  cfg.fontUI = cfg.type === "mono" ? MONO : GROT; cfg.fontMono = MONO;
  if (embed) { cfg.loop = true; cfg.beatMs = 2600; cfg.ox = 0; }
  const R = document.documentElement.style;
  R.setProperty("--f-ui", cfg.type === "mono" ? MONO : GROT);
  R.setProperty("--f-display", cfg.type === "serif" ? SERIF : cfg.type === "mono" ? MONO : GROT);
  R.setProperty("--f-mono", MONO);
  R.setProperty("--acc", cfg.accent || "#0a0a0b");
  document.body.className = "x-" + cfg.explain + " t-" + (cfg.type || "grot") + (embed ? " embed" : "");
  document.title = "Hireclaw — " + id + " " + cfg.name;

  const STEPS = window.HC9.STEPS, HC = window.HC;
  const seg = (idn, lab, opts) => '<div class="ctl"><span>' + lab + '</span><div class="seg" id="' + idn + '">' +
    opts.map((o, i) => '<button data-v="' + o[0] + '"' + (o[0] === (idn === "segCase" ? String(cfg.useCase || 0) : opts[0][0]) ? ' class="on"' : "") + ">" + o[1] + "</button>").join("") + "</div></div>";
  const ACT = { client: "Client", contract: "Contrat", agent: "Agent IA", workers: "Travailleurs", paid: "Travailleurs", dora: "Dora", eli: "Eli", all: "Tout le réseau" };

  document.body.insertAdjacentHTML("beforeend",
    '<canvas id="space"></canvas>' +
    '<header class="bar"><a class="brand" href="/work"><i></i><i></i><i></i><b>hireclaw</b><em>' + id + " · " + cfg.name + "</em></a>" +
    '<nav class="ctls">' +
      seg("segCase", "Cas d’usage", [["0", "Particulier"], ["1", "PME e-commerce"], ["2", "Lab IA"]]) +
      seg("segPhase", "Échelle", [["0", "Phase 1"], ["1", "Réseau"]]) +
    "</nav>" +
    '<div class="acts"><button class="ghost" id="openAll">Tout le projet</button>' +
    '<button class="run" id="run"><svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 0l8 5-8 5z" fill="currentColor"/></svg><span>Lancer le scénario</span></button></div></header>' +
    '<ol class="timeline" id="timeline">' + STEPS.map((s, i) =>
      '<li data-i="' + i + '"><span class="n">' + String(i + 1).padStart(2, "0") + '</span><div><b>' + s.t + "</b><p>" + s.d + '</p><code>' + s.code + "</code></div></li>").join("") + "</ol>" +
    '<section class="caption" id="caption"><div class="who" id="cWho"></div><h1 id="cTitle"></h1><p id="cDesc"></p><code id="cCode"></code></section>' +
    '<div class="ruler" id="ruler">' + STEPS.map((s, i) => '<button data-i="' + i + '" title="' + s.t + '"></button>').join("") + "</div>" +
    '<aside class="money"><div class="mrow big"><span>En garde dans le contrat</span><b id="mGarde">0.00</b></div>' +
      '<div class="mbar"><i id="mPaid"></i><u id="mMargin"></u></div>' +
      '<div class="mrow"><span>Versé aux humains</span><b id="mPay">0.00</b></div>' +
      '<div class="mrow"><span>Marge de l\'agent</span><b id="mMar">0.00</b></div>' +
      '<div class="mrow"><span>Inférence (sur la marge)</span><b id="mInf">0.000</b></div>' +
      '<div class="mrow"><span>Invariant C-I1</span><b id="mBal">—</b></div>' +
      '<div class="legend"><span><i class="l-usdc"></i>USDC</span><span><i class="l-data"></i>donnée</span><span><i class="l-ref">×</i>refus</span><span><i class="l-gold"></i>contrôle caché</span></div></aside>' +
    '<div class="nav"><button id="prev" aria-label="Étape précédente">←</button><span id="count">00 / ' + STEPS.length + '</span><button id="next" aria-label="Étape suivante">→</button></div>' +
    '<div id="tip"></div>' +
    '<div class="sheet" id="sheet"><div class="sheet-in"><button class="ghost" id="closeAll">Fermer</button>' +
      "<h2>Tout le projet, d'un coup d'œil</h2>" +
      '<div class="bench">' + HC.BENCH.map(b => "<div><strong>" + b[1] + (b[2] ? "<em> " + b[2] + "</em>" : "") + "</strong><span>" + b[0] + "</span></div>").join("") + "</div>" +
      '<div class="feat">' + HC.FEATURES.map(g => "<div><h3>" + g[0] + "<em>" + g[1].length + "</em></h3>" + g[1].map(r => "<p><span>" + r[0] + "</span><code>" + r[1] + "</code></p>").join("") + "</div>").join("") + "</div>" +
      "<h3 class=\"rt\">Ce que l'agent ne peut pas faire<em>12 refus du contrat</em></h3>" +
      '<div class="refus">' + HC.REFUS.map(r => "<p><code>" + r[0] + "</code><span>" + r[1] + "</span></p>").join("") + "</div>" +
      '<div class="net">' + ["contract", "agent", "client", "token", "wasm", "abi"].map(k => "<span>" + k + " <b>" + HC.NETWORK[k] + "</b></span>").join("") + "</div>" +
    "</div></div>");

  let curCase = cfg.useCase || 0, curPhase = 0;
  const $ = s => document.getElementById(s), cap = $("caption");
  const world = window.HC9.create($("space"), cfg, {
    onStep(i, s, m, st) {
      const uc = HC.USE_CASES[curCase];
      document.body.classList.toggle("idle", i < 0);
      if (i < 0) {
        $("cWho").innerHTML = "<b>" + uc.label + "</b><span>" + uc.who + "</span>";
        $("cTitle").textContent = uc.title;
        $("cDesc").textContent = uc.need + ". " + uc.tasks + ", " + uc.budget + ". Lance le scénario : 15 étapes, chacune expliquée.";
        $("cCode").textContent = "";
      } else {
        $("cWho").innerHTML = "<b>" + ACT[s.a] + "</b>" + (s.b ? " <i>→</i> <b>" + ACT[s.b] + "</b>" : "") + "<span>" + HC.STAGES[s.st][0] + "</span>";
        $("cTitle").textContent = s.t; $("cDesc").textContent = s.d; $("cCode").textContent = s.code;
        cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      }
      document.querySelectorAll("#timeline li").forEach((li, k) => { li.className = k < i ? "done" : k === i ? "on" : ""; if (k === i && li.scrollIntoView) li.scrollIntoView({ block: "nearest", behavior: "smooth" }); });
      document.querySelectorAll("#ruler button").forEach((b, k) => { b.className = k < i ? "done" : k === i ? "on" : ""; });
      $("count").textContent = String(Math.max(0, i + 1)).padStart(2, "0") + " / " + st.total;
      $("mGarde").textContent = (m.garde - m.pay).toFixed(2); $("mPay").textContent = m.pay.toFixed(2);
      $("mMar").textContent = m.margin.toFixed(2); $("mInf").textContent = m.inf.toFixed(3);
      $("mBal").textContent = m.balanced ? "balanced: true" : "—"; $("mBal").className = m.balanced ? "ok" : "";
      $("mPaid").style.width = (m.pay / 1.2 * 100) + "%"; $("mMargin").style.width = (m.margin / 1.2 * 100) + "%";
      document.querySelector(".mbar").classList.toggle("full", m.garde > 0);
      $("run").querySelector("span").textContent = st.playing ? "Pause" : st.done ? "Rejouer le scénario" : i >= 0 ? "Reprendre" : "Lancer le scénario";
      $("run").classList.toggle("playing", st.playing);
    },
    onFrame(a) {
      if (cfg.explain !== "inscene" || embed) return;
      if (!a || window.innerWidth < 900) { cap.style.transform = ""; cap.classList.remove("float"); return; }
      const w = cap.offsetWidth, h = cap.offsetHeight;
      const x = Math.max(16, Math.min(window.innerWidth - w - 16, a.x - w / 2)), y = Math.max(76, Math.min(window.innerHeight - h - 110, a.y + 44));
      cap.classList.add("float"); cap.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    },
    onHover(n, x, y) {
      const t = $("tip"); if (!n) { t.style.opacity = 0; return; }
      const d = world.info(n); t.innerHTML = "<b>" + d[0] + "</b><p>" + d[1] + "</p><code>" + d[2] + "</code>";
      t.style.opacity = 1; t.style.left = Math.min(window.innerWidth - 270, x + 16) + "px"; t.style.top = (y + 16) + "px";
    }
  });

  function bind(idn, fn) { $(idn).querySelectorAll("button").forEach(b => b.onclick = () => { $(idn).querySelectorAll("button").forEach(o => o.classList.toggle("on", o === b)); fn(b.dataset.v); }); }
  bind("segCase", v => { curCase = +v; world.setCase(curCase, curPhase === 1); });
  bind("segPhase", v => { curPhase = +v; world.setCase(curCase, curPhase === 1); });
  $("run").onclick = () => world.toggle();
  $("next").onclick = () => world.next(); $("prev").onclick = () => world.prev();
  document.querySelectorAll("#timeline li, #ruler button").forEach(el => el.onclick = () => { world.pause(); world.goto(+el.dataset.i); });
  $("openAll").onclick = () => $("sheet").classList.add("on"); $("closeAll").onclick = () => $("sheet").classList.remove("on");
  window.addEventListener("keydown", e => {
    if (e.key === " ") { e.preventDefault(); world.toggle(); } if (e.key === "ArrowRight") world.next(); if (e.key === "ArrowLeft") world.prev();
    if (e.key === "Escape") $("sheet").classList.remove("on");
  });
  world.reset();
  if (embed) setTimeout(() => world.play(), 400 + Math.random() * 900);
  window.V9 = world;
})();
