/* Hireclaw — the overlay interface of the scene (/scene): top bar, caption,
   step ruler, money strip, "Whole project" sheet. The canvas is v9-engine.js. */
(function () {
  "use strict";
  const GROT = '"Inter","Geist","SF Pro Display","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif';
  const SERIF = '"Sitka Display","Sitka Heading","New York","Iowan Old Style",Georgia,serif';
  const MONO = '"Geist Mono","SF Mono","Cascadia Mono",Consolas,ui-monospace,monospace';

  // The locked layout: low camera, humans in an arc behind the contract, one sentence at a time.
  const PLATES = {
    "05": { name: "Scene", layout: "scene", persp: 13, yaw: 0, pitch: .44, sway: .07, explain: "caption", type: "serif" }
  };
  window.V9_PLATES = PLATES;
  if (!document.body || !document.body.dataset.plate) return;

  const id = document.body.dataset.plate, cfg = Object.assign({}, PLATES[id] || PLATES["05"]);
  const TERM = new URLSearchParams(location.search).get("term") || "right";   // right · below · off
  // top, right, bottom, left kept free for the interface
  cfg.pad = TERM === "right" ? [96, 440, 320, 60] : TERM === "below" ? [96, 80, 360, 80] : [96, 80, 320, 80];
  cfg.fontUI = GROT; cfg.fontMono = MONO;
  const R = document.documentElement.style;
  R.setProperty("--f-ui", GROT); R.setProperty("--f-display", SERIF); R.setProperty("--f-mono", MONO);
  R.setProperty("--acc", cfg.accent || "#0a0a0b");
  document.body.className = "x-" + cfg.explain + " t-" + cfg.type + " term-" + TERM;
  document.title = "Hireclaw — the scene";

  const STEPS = window.HC9.STEPS, HC = window.HC;
  // served as a plain file (GitHub Pages, file://): there is no backend behind the page
  const STATIC = /github\.io$/.test(location.hostname) || location.protocol === "file:";
  let curCase = 0, curPhase = 0;
  const seg = (idn, lab, opts) => '<div class="ctl"><span>' + lab + '</span><div class="seg" id="' + idn + '">' +
    opts.map((o, i) => '<button data-v="' + o[0] + '"' + (i === 0 ? ' class="on"' : "") + ">" + o[1] + "</button>").join("") + "</div></div>";
  const ACT = { client: "Client", contract: "Contract", agent: "AI agent", workers: "Workers", paid: "Workers", dora: "Dora", eli: "Eli", all: "The whole network" };

  document.body.insertAdjacentHTML("beforeend",
    '<canvas id="space"></canvas>' +
    '<header class="bar"><a class="brand" href="' + (STATIC ? "https://github.com/GaiaSG94/hireclaw" : "/work") + '"><i></i><i></i><i></i><b>hireclaw</b><em>an AI that hires humans</em></a>' +
    '<nav class="ctls">' +
      seg("segCase", "Use case", HC.USE_CASES.map((u, i) => [String(i), u.label])) +
      seg("segPhase", "Scale", [["0", "Phase 1"], ["1", "Network"]]) +
    "</nav>" +
    '<div class="acts"><button class="ghost" id="openAll">Whole project</button>' +
    (STATIC ? '<a class="ghost" href="../media/demo.mp4" target="_blank" rel="noopener">Watch the demo (2:13) →</a>'
      : '<a class="ghost" href="/work">Work for the AI →</a>') +
    '<button class="run" id="run"><svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 0l8 5-8 5z" fill="currentColor"/></svg><span>Run the scenario</span></button></div></header>' +
    '<section class="caption" id="caption"><div class="who" id="cWho"></div><h1 id="cTitle"></h1><p id="cDesc"></p><code id="cCode"></code></section>' +
    '<div class="ruler" id="ruler">' + STEPS.map((s, i) => '<button data-i="' + i + '" title="' + s.t + '"></button>').join("") + "</div>" +
    '<aside class="money"><div class="mrow big"><span>Held by the contract</span><b id="mGarde">0.00</b></div>' +
      '<div class="mbar"><i id="mPaid"></i><u id="mMargin"></u></div>' +
      '<div class="mrow"><span>Paid to humans</span><b id="mPay">0.00</b></div>' +
      '<div class="mrow"><span>Agent margin</span><b id="mMar">0.00</b></div>' +
      '<div class="mrow"><span>Inference (from margin)</span><b id="mInf">0.000</b></div>' +
      '<div class="mrow"><span>Invariant C-I1</span><b id="mBal">—</b></div>' +
      '<div class="legend"><span><i class="l-usdc"></i>USDC</span><span><i class="l-data"></i>data</span><span><i class="l-ref">×</i>rejection</span><span><i class="l-gold"></i>hidden check</span></div></aside>' +
    '<div class="nav"><button id="prev" aria-label="Previous step">←</button><span id="count">00 / ' + STEPS.length + '</span><button id="next" aria-label="Next step">→</button></div>' +
    '<div id="tip"></div>' +
    '<div class="sheet" id="sheet"><div class="sheet-in"><button class="ghost" id="closeAll">Close</button>' +
      "<h2>The whole project at a glance</h2>" +
      '<div class="bench">' + HC.BENCH.map(b => "<div><strong>" + b[1] + (b[2] ? "<em> " + b[2] + "</em>" : "") + "</strong><span>" + b[0] + "</span></div>").join("") + "</div>" +
      '<div class="feat">' + HC.FEATURES.map(g => "<div><h3>" + g[0] + "<em>" + g[1].length + "</em></h3>" + g[1].map(r => "<p><span>" + r[0] + "</span><code>" + r[1] + "</code></p>").join("") + "</div>").join("") + "</div>" +
      '<h3 class="rt">What the agent cannot do<em>12 refusals by the contract</em></h3>' +
      '<div class="refus">' + HC.REFUS.map(r => "<p><code>" + r[0] + "</code><span>" + r[1] + "</span></p>").join("") + "</div>" +
      '<div class="net">' + ["contract", "agent", "client", "token", "wasm", "abi"].map(k => "<span>" + k + " <b>" + HC.NETWORK[k] + "</b></span>").join("") + "</div>" +
    "</div></div>");

  const $ = s => document.getElementById(s), cap = $("caption");
  const world = window.HC9.create($("space"), cfg, {
    onStep(i, s, m, st) {
      document.dispatchEvent(new CustomEvent("hc9:step", { detail: { i: i, step: s, total: st.total } }));
      const uc = HC.USE_CASES[curCase];
      document.body.classList.toggle("idle", i < 0);
      if (i < 0) {
        $("cWho").innerHTML = "<b>" + uc.label + "</b><span>" + uc.who + "</span>";
        $("cTitle").textContent = uc.title;
        $("cDesc").textContent = uc.need + ". " + uc.tasks + ", " + uc.budget + ". Run the scenario: 15 steps, each one explained.";
        $("cCode").textContent = "";
      } else {
        $("cWho").innerHTML = "<b>" + ACT[s.a] + "</b>" + (s.b ? " <i>→</i> <b>" + ACT[s.b] + "</b>" : "") + "<span>" + HC.STAGES[s.st][0] + "</span>";
        $("cTitle").textContent = s.t; $("cDesc").textContent = s.d; $("cCode").textContent = s.code;
        cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      }
      document.querySelectorAll("#ruler button").forEach((b, k) => { b.className = k < i ? "done" : k === i ? "on" : ""; });
      $("count").textContent = String(Math.max(0, i + 1)).padStart(2, "0") + " / " + st.total;
      $("mGarde").textContent = (m.garde - m.pay).toFixed(2); $("mPay").textContent = m.pay.toFixed(2);
      $("mMar").textContent = m.margin.toFixed(2); $("mInf").textContent = m.inf.toFixed(3);
      $("mBal").textContent = m.balanced ? "balanced: true" : "—"; $("mBal").className = m.balanced ? "ok" : "";
      $("mPaid").style.width = (m.pay / 1.2 * 100) + "%"; $("mMargin").style.width = (m.margin / 1.2 * 100) + "%";
      document.querySelector(".mbar").classList.toggle("full", m.garde > 0);
      $("run").querySelector("span").textContent = st.playing ? "Pause" : st.done ? "Replay the scenario" : i >= 0 ? "Resume" : "Run the scenario";
      $("run").classList.toggle("playing", st.playing);
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
  document.querySelectorAll("#ruler button").forEach(el => el.onclick = () => { world.pause(); world.goto(+el.dataset.i); });
  $("openAll").onclick = () => $("sheet").classList.add("on"); $("closeAll").onclick = () => $("sheet").classList.remove("on");
  window.addEventListener("keydown", e => {
    if (e.key === " ") { e.preventDefault(); world.toggle(); } if (e.key === "ArrowRight") world.next(); if (e.key === "ArrowLeft") world.prev();
    if (e.key === "Escape") $("sheet").classList.remove("on");
  });
  world.reset();
  window.V9 = world;
})();
