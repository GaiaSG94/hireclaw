/* Hireclaw v9 — moteur de scène. Repart de zéro (rien de v5→v8).
   Fond blanc, encre noire, sphères de verre. L'argent est un liquide noir :
   il quitte la sphère du client, remplit celle du contrat, puis celles des travailleurs.
   L'agent n'en contient jamais — il ne peut pas toucher aux fonds.
   Zéro dépendance : canvas 2D, projection maison. Données : dépôt réel (v7-data.js). */
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const V = (x, y, z) => ({ x, y, z });
  const STEPS = window.HC9_STEPS, ROLE_LABEL = window.HC9_ROLE_LABEL;



  /* ------------------------------------------------------------- placements */
  function wRad(n) { return n <= 6 ? .46 : n <= 12 ? .36 : n <= 20 ? .3 : n <= 40 ? .23 : .18; }
  function gridXZ(n, cx, y, cz, rows, step) {
    const cols = Math.ceil(n / rows), out = [];
    for (let i = 0; i < n; i++) {
      const c = Math.floor(i / rows), r = i % rows;
      out.push(V(cx + (c - (cols - 1) / 2) * step, y, cz + (r - (rows - 1) / 2) * step));
    }
    return out;
  }
  function rings(n, r0, y, step, a0) {
    const out = []; let r = r0, left = n;
    while (left > 0) {
      const cap = Math.max(5, Math.floor(TAU * r / step)), k = Math.min(cap, left);
      for (let i = 0; i < k; i++) { const a = (a0 || 0) + i / k * TAU; out.push(V(Math.cos(a) * r, y, Math.sin(a) * r)); }
      left -= k; r += step;
    }
    return out;
  }
  function arcs(n, r0, y, step, a0, a1) {
    const out = []; let r = r0, left = n;
    while (left > 0) {
      const cap = Math.max(5, Math.floor((a1 - a0) * r / step) + 1), k = Math.min(cap, left);
      for (let i = 0; i < k; i++) { const a = k === 1 ? (a0 + a1) / 2 : lerp(a0, a1, i / (k - 1)); out.push(V(Math.cos(a) * r, y, Math.sin(a) * r)); }
      left -= k; r += step * 3.2;
    }
    return out;
  }
  const LAYOUTS = {
    ligne(n) {
      const s = n <= 6 ? 1.8 : wRad(n) * 3.9, rows = n <= 6 ? n : Math.ceil(Math.sqrt(n * 1.5));
      const cols = Math.ceil(n / rows);
      return { client: V(-5, 0, 0), contract: V(-1.5, 0, 0), agent: V(-1.5, 0, 2.7),
        workers: gridXZ(n, 2.9 + (cols - 1) / 2 * s, 0, 0, rows, s), cs: V(0, 0, 1.5), as: V(-1.5, 0, 0) };
    },
    strates(n) {
      const s = n <= 6 ? 1.35 : wRad(n) * 2.7, rows = n <= 6 ? 1 : Math.ceil(Math.sqrt(n / 2.2));
      const cols = Math.ceil(n / rows), half = Math.max(3, (cols - 1) / 2 * s + .9), dz = Math.max(1.5, (rows - 1) / 2 * s + .9);
      return { client: V(0, 2.7, 0), contract: V(-1, 0, 0), agent: V(1.4, 0, 0),
        workers: gridXZ(n, 0, -2.7, 0, rows, s), cs: V(1.4, 0, 0), as: V(0, 0, 1.3),
        planes: [{ y: 2.7, hx: 2.2, hz: 1.5, label: "qui commande" }, { y: 0, hx: 3, hz: 1.5, label: "qui garde l'argent et fixe les règles" }, { y: -2.7, hx: half, hz: dz, label: "qui travaille" }] };
    },
    orbite(n) {
      return { client: V(-5.6, 0, 0), contract: V(0, 0, 0), agent: V(-.62, 0, 2.35),
        workers: rings(n, 3.5, 0, n <= 6 ? 2 : wRad(n) * 2.7, -Math.PI * .42 + (n <= 6 ? 0 : 0)), cs: V(0, 0, 1.4), as: V(1.3, 0, .3), ringR: [3.5, 5.6] };
    },
    scene(n) {
      return { client: V(-3.9, 0, -2.2), contract: V(0, 0, -1.9), agent: V(3.9, 0, -2.2),
        workers: arcs(n, 4.2, 0, n <= 6 ? 1.5 : wRad(n) * 3.3, Math.PI * .16, Math.PI * .84), cs: V(-.9, 0, -1), as: V(.9, 0, -1) };
    },
    colonne(n) {
      return { client: V(0, 3.4, 0), contract: V(0, .9, 0), agent: V(2.6, .9, 0),
        workers: rings(n, 3.1, -2.4, n <= 6 ? 2 : wRad(n) * 3.2, Math.PI * .1), cs: V(-1.4, 0, 0), as: V(1.2, 0, 0), ringR: [3.1], ringY: -2.4 };
    },
    grille(n) {
      const s = n <= 6 ? 1.7 : wRad(n) * 3.9, rows = Math.ceil(Math.sqrt(n));
      const cols = Math.ceil(n / rows);
      return { client: V(-5.2, 0, 0), contract: V(-2.3, 0, 0), agent: V(-2.3, 2.4, 0),
        workers: gridXZ(n, 1.2 + (cols - 1) / 2 * s, 0, 0, rows, s), cs: V(0, 0, 1.5), as: V(-1.4, 0, 0) };
    },
    eventail(n) {
      return { client: V(-4.8, 0, 0), contract: V(-1, 0, 0), agent: V(-2.9, 0, 3.3),
        workers: arcs(n, 4.7, 0, n <= 6 ? 1.45 : wRad(n) * 3.4, -Math.PI * .4, Math.PI * .4).map(p => V(p.x - 1, p.y, p.z)), cs: V(0, 0, 1.5), as: V(-1.4, 0, 0) };
    },
    schema(n) {
      const s = n <= 6 ? 1.3 : wRad(n) * 2.7, rows = n <= 6 ? n : Math.ceil(Math.sqrt(n * 1.5)), cols = Math.ceil(n / rows);
      const w = [];
      for (let i = 0; i < n; i++) { const c = Math.floor(i / rows), r = i % rows; w.push(V(3 + c * s, ((rows - 1) / 2 - r) * s + .6, 0)); }
      return { client: V(-5, .6, 0), contract: V(-1.5, .6, 0), agent: V(-1.5, 3.1, 0), workers: w, cs: V(0, -1.5, 0), as: V(-1.5, 0, 0), flat: true };
    },
    cercle(n) {
      const r = n <= 6 ? 3.7 : Math.max(3.7, (n + 3) * wRad(n) * 2.7 / TAU), out = [];
      const tot = n + 3;
      for (let i = 0; i < tot; i++) { const a = Math.PI + i / tot * TAU; out.push(V(Math.cos(a) * r, 0, -Math.sin(a) * r)); }
      return { client: out[0], contract: out[1], agent: out[2], workers: out.slice(3), cs: V(0, 1.5, 0), as: V(0, 1.5, 0), ringR: [r], center: true };
    }
  };

  /* ------------------------------------------------------------------ moteur */
  function create(canvas, cfg, hooks) {
    hooks = hooks || {};
    const ctx = canvas.getContext("2d");
    const INK = cfg.ink || "#0a0a0b", ACC = cfg.accent || INK, PAPER = cfg.paper || "#ffffff";
    const FUI = cfg.fontUI || '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
    const FMONO = cfg.fontMono || '"Cascadia Mono",Consolas,ui-monospace,monospace';
    let W = 0, H = 0, DPR = 1, unit = 60, CX = 0, CY = 0;
    const cam = { yaw: cfg.yaw, pitch: cfg.pitch, zoom: 1, tYaw: cfg.yaw, tPitch: cfg.pitch, tZoom: 1, free: false,
      f: V(0, 0, 0), tf: V(0, 0, 0) };
    const base = V(0, 0, 0);
    let nodes = [], clients = [], agents = [], workers = [], contract = null, L = null;
    let caseIdx = 0, phase2 = false, role = "spectateur";
    const money = { garde: 0, pay: 0, margin: 0, inf: 0, split: false, balanced: false };
    let stepIdx = -1, stepStart = 0, playing = false, timer = null, now = 0, done = false;
    let hover = null, drag = null, anchor = null;

    function resize() {
      DPR = clamp(window.devicePixelRatio || 1, 1, 2);
      W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      fit();
    }
    /* cadrage automatique : la scène remplit la zone laissée libre par l interface */
    function fit() {
      if (!nodes.length) return;
      const small = W < 900, pd = cfg.pad || [84, 56, 150, 56];
      const pT = small ? 150 : pd[0], pR = small ? 24 : pd[1] + (cfg.labelSide === "right" ? 96 : 0), pB = small ? 250 : pd[2], pL = small ? 24 : pd[3];
      const sv = [cam.yaw, cam.pitch, cam.zoom, cam.f]; cam.yaw = cfg.yaw; cam.pitch = cfg.pitch; cam.zoom = 1; cam.f = V(0, 0, 0);
      unit = 1; CX = 0; CY = 0;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      const add = (p, r) => { const q = proj(p), R = r * q.s; x0 = Math.min(x0, q.x - R); x1 = Math.max(x1, q.x + R); y0 = Math.min(y0, q.y - R); y1 = Math.max(y1, q.y + R); };
      nodes.forEach(n => add(n.pos, n.r * 1.08));
      if (L.planes && cfg.floor === "planes") L.planes.forEach(pl => [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(c => add(V(c[0] * pl.hx, pl.y, c[1] * pl.hz), 0)));
      const aw = W - pL - pR, ah = H - pT - pB - 40;
      unit = Math.min(aw / (x1 - x0), ah / (y1 - y0), small ? 999 : 150);
      CX = pL + aw / 2 - (x0 + x1) / 2 * unit; CY = pT + ah / 2 - (y0 + y1) / 2 * unit;
      cam.yaw = sv[0]; cam.pitch = sv[1]; cam.zoom = sv[2]; cam.f = sv[3];
    }

    function proj(p) {
      const x = p.x - base.x - cam.f.x, y = p.y - base.y - cam.f.y, z = p.z - base.z - cam.f.z;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y1 = y * cp + z1 * sp, z2 = -y * sp + z1 * cp;
      const f = cfg.ortho ? 1 : (cfg.persp || 15) / Math.max(2, (cfg.persp || 15) + z2);
      const U = unit * cam.zoom * f;
      return { x: CX + x1 * U, y: CY - y1 * U, s: U, d: z2 };
    }

    /* ------------------------------------------------------------- le monde */
    function mk(kind, p, r, name, sub) {
      const n = { kind, r, gy: p.y, pos: V(p.x, p.y + r, p.z), name, sub, alpha: 1, lv: 0, tlv: 0,
        status: kind, paid: 0, gold: false, flag: "", linked: kind !== "worker", id: nodes.length, hl: 0 };
      nodes.push(n); return n;
    }
    function build(ci, p2) {
      caseIdx = ci; phase2 = !!p2;
      const uc = window.HC.USE_CASES[ci] || window.HC.USE_CASES[0];
      const nW = uc.workers * (phase2 ? 2 : 1), nC = phase2 ? 3 : 1, nA = phase2 ? 3 : 1;
      L = LAYOUTS[cfg.layout](nW);
      nodes = []; clients = []; agents = []; workers = [];
      const off = (p, s, i, k) => { const m = k === 1 ? 0 : i - (k - 1) / 2; return V(p.x + s.x * m, p.y + s.y * m, p.z + s.z * m); };
      for (let i = 0; i < nC; i++) clients.push(mk("client", off(L.client, L.cs, i, nC), nC > 1 ? .44 : .56, nC > 1 ? "Client " + (i + 1) : "Client", ROLE_LABEL.client[1]));
      contract = mk("contract", L.contract, .82, "Contrat", ROLE_LABEL.contract[1]);
      for (let i = 0; i < nA; i++) agents.push(mk("agent", off(L.agent, L.as, i, nA), nA > 1 ? .5 : .62, nA > 1 ? "Agent " + (i + 1) : "Agent IA", ROLE_LABEL.agent[1]));
      const rad = wRad(nW), real = ["Alice", "Bob", "Chloé"];
      L.workers.forEach((p, i) => {
        const nm = i === nW - 1 ? "Eli" : i === nW - 2 ? "Dora" : i < 3 ? real[i] : (0x3a7 + i * 0x9d).toString(16) + "…" + (0xe1 + i * 7).toString(16).slice(-2);
        const w = mk("worker", p, rad, nm, "disponible"); w.idx = i; workers.push(w);
      });
      fit(); reset();
    }

    function resetState() {
      money.garde = 0; money.pay = 0; money.margin = 0; money.inf = 0; money.split = false; money.balanced = false;
      clients.forEach(c => { c.tlv = .86; c.got = false; });
      contract.tlv = 0; contract.locked = false; contract.split = false;
      workers.forEach(w => { w.status = "idle"; w.sub = "disponible"; w.paid = 0; w.tlv = 0; w.gold = false; w.flag = ""; w.linked = false; });
      done = false;
    }
    function payees() { return workers.filter(w => w.status !== "fired" && w.idx !== workers.length - 1); }
    function applyFx(fx) {
      const eli = workers[workers.length - 1], dora = workers[workers.length - 2];
      if (fx === "order") { clients.forEach(c => c.tlv = 0); money.garde = 1.20; contract.tlv = .86; }
      if (fx === "lock") contract.locked = true;
      if (fx === "margin") money.margin = .18;
      if (fx === "hire") workers.forEach(w => { w.linked = true; w.status = "trial"; w.sub = "embauché"; });
      if (fx === "trial") workers.forEach(w => { w.sub = "à l'essai"; });
      if (fx === "gold") workers.forEach((w, i) => { w.gold = i % 5 === 1 || w === eli; });
      if (fx === "pay") { money.pay = .48; payees().forEach(w => { w.status = "active"; w.paid = .48 / payees().length; w.sub = "payé " + w.paid.toFixed(2); }); }
      if (fx === "minority" && dora) dora.flag = "minority";
      if (fx === "fast" && eli) eli.flag = "too_fast";
      if (fx === "fire" && eli) { eli.status = "fired"; eli.sub = "renvoyé"; eli.linked = false; eli.gold = false; }
      if (fx === "deliver") { money.pay = .98; money.inf = .048; const P = payees(); P.forEach(w => { w.paid = .98 / P.length; w.sub = "payé " + w.paid.toFixed(2); }); clients.forEach(c => c.got = true); }
      if (fx === "split") { money.split = true; contract.split = true; }
      if (fx === "balance") { money.balanced = true; done = true; }
      contract.tlv = money.garde ? .86 * (money.garde - money.pay) / 1.20 : 0;
      const P = payees(); workers.forEach(w => { w.tlv = clamp(w.paid / .32, 0, .8); });
    }

    function resolve(key) {
      const eli = workers[workers.length - 1], dora = workers[workers.length - 2];
      if (!key) return [];
      if (key === "client") return clients; if (key === "contract") return [contract];
      if (key === "agent") return agents; if (key === "workers") return workers.filter(w => w.status !== "fired");
      if (key === "paid") return payees(); if (key === "dora") return [dora]; if (key === "eli") return [eli];
      if (key === "all") return nodes; return [];
    }

    /* ------------------------------------------------------------- chemins */
    function path3(a, b) {
      const A = a.pos, B = b.pos, m = cfg.link || "line";
      if (m === "ortho" && Math.abs(A.z - B.z) > .05 && Math.abs(A.x - B.x) > .05) {
        const mx = (A.x + B.x) / 2; return [A, V(mx, A.y, A.z), V(mx, B.y, B.z), B];
      }
      if (m === "drop" && Math.abs(a.gy - b.gy) > .5) {
        return A.y > B.y ? [A, V(B.x, A.y, B.z), B] : [A, V(A.x, B.y, A.z), B];
      }
      if (m === "arc" || m === "curve") {
        const out = [], dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, len = Math.hypot(dx, dy, dz);
        for (let i = 0; i <= 18; i++) {
          const t = i / 18, k = Math.sin(Math.PI * t);
          if (m === "arc") out.push(V(A.x + dx * t, A.y + dy * t + k * len * .16, A.z + dz * t));
          else { const q = 1 - k * .42; out.push(V((A.x + dx * t) * q, A.y + dy * t, (A.z + dz * t) * q)); }
        }
        return out;
      }
      return [A, B];
    }
    function screenPath(a, b) {
      const pts = path3(a, b).map(proj);
      return trim(pts, a._r + 5, b._r + 7);
    }
    function trim(pts, ra, rb) {
      const seg = []; let tot = 0;
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); tot += l; }
      if (tot < ra + rb + 4) return null;
      const at = d => { let acc = 0; for (let i = 0; i < seg.length; i++) { if (d <= acc + seg[i] || i === seg.length - 1) { const t = seg[i] ? (d - acc) / seg[i] : 0; return { x: lerp(pts[i].x, pts[i + 1].x, t), y: lerp(pts[i].y, pts[i + 1].y, t), i }; } acc += seg[i]; } };
      const s = at(ra), e = at(tot - rb), out = [s];
      for (let i = s.i + 1; i <= e.i; i++) out.push(pts[i]);
      out.push(e);
      const ls = []; let T = 0;
      for (let i = 1; i < out.length; i++) { const l = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y); ls.push(l); T += l; }
      out.len = T; out.ls = ls; return out;
    }
    function along(P, t) {
      let d = clamp(t, 0, 1) * P.len;
      for (let i = 0; i < P.ls.length; i++) {
        if (d <= P.ls[i] || i === P.ls.length - 1) { const k = P.ls[i] ? d / P.ls[i] : 0; return { x: lerp(P[i].x, P[i + 1].x, k), y: lerp(P[i].y, P[i + 1].y, k), ang: Math.atan2(P[i + 1].y - P[i].y, P[i + 1].x - P[i].x) }; }
        d -= P.ls[i];
      }
    }
    function strokePath(P, col, w, dash) {
      ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.lineJoin = "round"; ctx.stroke(); ctx.setLineDash([]);
    }

    /* ------------------------------------------------------------- le sol */
    function rgba(a) { return "rgba(10,10,11," + a + ")"; }
    function line3(a, b, col, w, dash) { const p = proj(a), q = proj(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.strokeStyle = col; ctx.lineWidth = w || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
    function circle3(r, y, col, dash) {
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU, p = proj(V(Math.cos(a) * r, y, Math.sin(a) * r)); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
    }
    function floor() {
      const f = cfg.floor;
      if (f === "dots") {
        ctx.fillStyle = rgba(.2);
        for (let x = -9; x <= 9; x++) for (let z = -6; z <= 6; z++) { const p = proj(V(x, 0, z)); ctx.fillRect(Math.round(p.x) - .75, Math.round(p.y) - .75, 1.5, 1.5); }
      } else if (f === "grid") {
        for (let x = -9; x <= 9; x++) line3(V(x, 0, -6), V(x, 0, 6), rgba(.055));
        for (let z = -6; z <= 6; z++) line3(V(-9, 0, z), V(9, 0, z), rgba(.055));
      } else if (f === "rings" && L.ringR) {
        L.ringR.forEach(r => circle3(r, L.ringY || 0, rgba(.13)));
      } else if (f === "base") {
        line3(V(-7.5, 0, 0), V(7.5, 0, 0), rgba(.12));
      } else if (f === "planes" && L.planes) {
        L.planes.forEach(pl => {
          const c = [V(-pl.hx, pl.y, -pl.hz), V(pl.hx, pl.y, -pl.hz), V(pl.hx, pl.y, pl.hz), V(-pl.hx, pl.y, pl.hz)].map(proj);
          ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
          ctx.fillStyle = "rgba(250,250,250,.72)"; ctx.fill(); ctx.strokeStyle = rgba(.2); ctx.lineWidth = 1; ctx.stroke();
          const lo = c.reduce((a, p) => p.x < a.x ? p : a);
          ctx.font = "500 12px " + FUI; ctx.fillStyle = rgba(.45); ctx.textAlign = "right"; ctx.textBaseline = "middle";
          ctx.fillText(pl.label, lo.x - 14, lo.y);
        });
      }
    }

    /* ------------------------------------------------- la sphère de verre */
    function shadow(n) {
      if (cfg.shadow === false) return;
      const g = proj(V(n.pos.x, n.gy, n.pos.z)), r = n.r * g.s, sq = clamp(Math.abs(Math.sin(cam.pitch)), .1, 1);
      const lift = (n.pos.y - n.r - n.gy);
      ctx.save(); ctx.translate(g.x + r * .16, g.y + r * .06); ctx.scale(1, sq);
      const R = r * 1.25, gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      gr.addColorStop(0, rgba(.17 * n.alpha)); gr.addColorStop(.55, rgba(.07 * n.alpha)); gr.addColorStop(1, rgba(0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      const c = ctx.createRadialGradient(r * .12, 0, 0, r * .12, 0, r * .5);   // caustique : la lumière traverse
      c.addColorStop(0, "rgba(255,255,255," + .85 * n.alpha * (1 - n.lv) + ")"); c.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(r * .12, 0, r * .5, 0, TAU); ctx.fill();
      ctx.restore();
    }
    function sphere(n) {
      const p = n._p, r = n._r, x = p.x, y = p.y, a = n.alpha;
      if (r < 1.5) return;
      const fired = n.status === "fired";
      ctx.save(); ctx.globalAlpha = a;
      // corps : verre légèrement teinté, bord plus dense
      let g = ctx.createRadialGradient(x - r * .22, y - r * .28, r * .05, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,.55)"); g.addColorStop(.5, "rgba(244,244,245,.5)");
      g.addColorStop(.82, rgba(.07)); g.addColorStop(.95, rgba(.16)); g.addColorStop(1, rgba(.34));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r * .93, 0, TAU); ctx.clip();
      // liquide = argent
      if (n.lv > .012) {
        const top = y + r * .93 - 2 * r * .93 * n.lv, dy = top - y, half = Math.sqrt(Math.max(0, r * r * .865 - dy * dy));
        const lg = ctx.createLinearGradient(0, top, 0, y + r);
        lg.addColorStop(0, ACC); lg.addColorStop(1, cfg.accent ? ACC : "#000");
        ctx.fillStyle = lg; ctx.fillRect(x - r, top, r * 2, r * 2);
        ctx.fillStyle = cfg.accent ? "rgba(255,255,255,.28)" : "#3a3a3d";
        ctx.beginPath(); ctx.ellipse(x, top, half, Math.max(1, half * .2 * clamp(Math.abs(Math.sin(cam.pitch)) + .25, .3, 1)), 0, 0, TAU); ctx.fill();
      }
      // lumière réfractée en bas
      g = ctx.createRadialGradient(x + r * .18, y + r * .62, 0, x + r * .18, y + r * .62, r * .6);
      g.addColorStop(0, "rgba(255,255,255," + (n.lv > .3 ? .16 : .9) + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
      // cœur selon le rôle
      ctx.lineWidth = Math.max(1, r * .035);
      if (n.kind === "agent") {           // machine : un gyroscope, jamais d'argent
        ctx.strokeStyle = INK;
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x, y, r * .56, r * .19, now * .0007 + k * TAU / 3, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y, r * .1, 0, TAU); ctx.fill();
      } else if (n.kind === "contract") { // coffre : un équateur + un verrou
        ctx.strokeStyle = n.lv > .45 ? "rgba(255,255,255,.5)" : rgba(.3); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, y, r * .97, r * .97 * clamp(Math.abs(Math.sin(cam.pitch)), .12, .9) * .34, 0, 0, TAU); ctx.stroke();
        if (n.split && n.lv > .05) {      // marge ventilée 60/30/10
          const top = y + r * .93 - 2 * r * .93 * n.lv, bot = y + r * .93;
          ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.2;
          [.6, .9].forEach(q => { const xx = x - r * .5 + r * q; ctx.beginPath(); ctx.moveTo(xx, top + 2); ctx.lineTo(xx, bot); ctx.stroke(); });
        }
      } else if (n.kind === "client" && n.got) { // livrable reçu : 12 éléments
        ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 1;
        for (let i = 0; i < 12; i++) { const cx = x + ((i % 4) - 1.5) * r * .24, cy = y + (Math.floor(i / 4) - 1) * r * .24; ctx.beginPath(); ctx.arc(cx, cy, r * .075, 0, TAU); ctx.fill(); ctx.stroke(); }
      } else if (n.kind === "worker" && n.gold && !fired) { // contrôle caché
        ctx.strokeStyle = n.lv > .5 ? "#fff" : INK; ctx.lineWidth = 1.2; const q = r * .2, cy = y - r * .34;
        ctx.beginPath(); ctx.moveTo(x, cy - q); ctx.lineTo(x + q, cy); ctx.lineTo(x, cy + q); ctx.lineTo(x - q, cy); ctx.closePath(); ctx.stroke();
      }
      // bord
      ctx.strokeStyle = rgba(fired ? .45 : .5); ctx.lineWidth = 1; if (fired || n.status === "idle") ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(x, y, r - .5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      // reflets
      ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = Math.max(1.4, r * .07); ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(x, y, r * .8, Math.PI * 1.13, Math.PI * 1.4); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.ellipse(x + r * .36, y - r * .56, r * .09, r * .05, .6, 0, TAU); ctx.fill();
      ctx.lineCap = "butt";
      if (fired) { ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - r * .5, y - r * .5); ctx.lineTo(x + r * .5, y + r * .5); ctx.moveTo(x + r * .5, y - r * .5); ctx.lineTo(x - r * .5, y + r * .5); ctx.stroke(); }
      if (n.hl > .02) { ctx.strokeStyle = rgba(.9 * n.hl); ctx.lineWidth = 1.25; ctx.beginPath(); ctx.arc(x, y, r + (r < 26 ? 3 : 5), 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    function label(n) {
      const r = n._r, big = n.kind !== "worker";
      if (cfg.labels === false && n !== hover && !n.hl) return;
      if (!big && (r < 13 || n.name.indexOf("…") > 0) && n !== hover && !n.flag && n.status !== "fired") return;
      const side = cfg.labelSide === "right" && !big;
      const x = side ? n._p.x + r + 12 : n._p.x, y = side ? n._p.y - 15 : n._p.y + r + (cfg.shadow === false ? 10 : 12);
      ctx.globalAlpha = clamp(n.alpha * 1.15, 0, 1); ctx.textAlign = side ? "left" : "center"; ctx.textBaseline = "top";
      ctx.font = "600 " + (big ? 13.5 : 12.5) + "px " + FUI; ctx.fillStyle = INK; ctx.fillText(n.name, x, y);
      if (W > 760 || big) { ctx.font = "400 " + (big ? 12 : 11.5) + "px " + FUI; ctx.fillStyle = rgba(.5);
        ctx.fillText(n.kind === "contract" && money.garde ? (money.garde - money.pay).toFixed(2) + " USDC en garde" : n.sub, x, y + 17); }
      if (n.flag) { ctx.font = "600 12.5px " + FUI; const nw = ctx.measureText(n.name).width; ctx.font = "500 11px " + FMONO; const pw = ctx.measureText(n.flag).width + 16; pill(side ? x + nw + 10 + pw / 2 : x, side ? y + 8 : y + 44, n.flag, true); }
      ctx.globalAlpha = 1;
    }
    function pill(x, y, text, strong) {
      ctx.font = "500 11px " + FMONO; const w = ctx.measureText(text).width + 16, h = 20;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 10); else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = strong ? INK : PAPER; ctx.fill(); if (!strong) { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = strong ? PAPER : INK; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + .5);
    }

    /* --------------------------------------------------------------- frame */
    function activePairs() {
      const s = STEPS[stepIdx]; if (!s || !s.b) return [];
      const A = resolve(s.a), B = resolve(s.b), out = [];
      if (A.length === 1 || B.length === 1 || s.b === "eli") A.forEach(a => B.forEach(b => { if (a !== b) out.push([a, b]); }));
      else B.forEach((b, i) => out.push([A[i % A.length], b]));
      return out;
    }
    function frame(t) {
      now = t;
      if (!cam.free && cfg.sway !== 0) cam.tYaw = cfg.yaw + Math.sin(t * .00022) * (cfg.sway || .1);
      cam.yaw = lerp(cam.yaw, cam.tYaw, .08); cam.pitch = lerp(cam.pitch, cam.tPitch, .08); cam.zoom = lerp(cam.zoom, cam.tZoom, .08);
      cam.f.x = lerp(cam.f.x, cam.tf.x, .07); cam.f.y = lerp(cam.f.y, cam.tf.y, .07); cam.f.z = lerp(cam.f.z, cam.tf.z, .07);
      ctx.clearRect(0, 0, W, H);
      const s = STEPS[stepIdx], act = new Set();
      if (s && !done) { resolve(s.a).forEach(n => act.add(n)); resolve(s.b).forEach(n => act.add(n)); }
      const focusRole = role === "client" ? clients[0] : role === "travailleur" ? workers[0] : null;
      nodes.forEach(n => {
        n._p = proj(n.pos); n._r = n.r * n._p.s;
        let ta = 1;
        if (s && !done && act.size && !act.has(n)) ta = .34;
        if (n.status === "fired") ta = Math.min(ta, .55);
        n.alpha = lerp(n.alpha, ta, .1); n.lv = lerp(n.lv, n.tlv, .045);
        n.hl = lerp(n.hl, (s && !done && act.has(n) && s.a !== "all") || n === focusRole ? 1 : 0, .12);
      });
      floor();
      nodes.forEach(shadow);
      // liens permanents
      const links = [];
      clients.forEach(c => links.push([c, contract])); agents.forEach(a => links.push([a, contract]));
      workers.forEach(w => { if (w.linked) links.push([contract, w]); });
      if (cfg.links !== "active") links.forEach(l => { const P = screenPath(l[0], l[1]); if (P) strokePath(P, rgba(.16 * Math.min(l[0].alpha, l[1].alpha) + .03), 1); });
      // interaction en cours
      anchor = null;
      const pairs = activePairs(), el = (t - stepStart) / 1000;
      if (s && pairs.length && !done) {
        const mid = Math.floor((pairs.length - 1) / 2);
        pairs.forEach((pr, i) => {
          const P = screenPath(pr[0], pr[1]); if (!P) return;
          const refus = s.k === "refus";
          const many = pairs.length > 12;
          strokePath(P, many ? rgba(.28) : INK, many ? 1 : 1.25, refus ? [4, 4] : null);
          if (!refus && !many) { const e = along(P, 1); ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang); ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(-7, -3.6); ctx.lineTo(-7, 3.6); ctx.closePath(); ctx.fill(); ctx.restore(); }
          const nb = pairs.length > 12 ? 1 : 3, br = clamp(P.len / 60, 2.6, 4.2);
          for (let j = 0; j < nb; j++) {
            let u = (el * .5 + j / nb + i * .07) % 1;
            if (refus) u = Math.min(u * 1.6, .58);
            const q = along(P, u), fade = refus ? 1 : Math.sin(Math.PI * clamp(u, 0, 1)) * .6 + .4;
            ctx.globalAlpha = fade; ctx.beginPath(); ctx.arc(q.x, q.y, br, 0, TAU);
            if (s.k === "usdc") { ctx.fillStyle = ACC; ctx.fill(); }
            else { ctx.fillStyle = PAPER; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.stroke(); }
            ctx.globalAlpha = 1;
            if (refus && u >= .58) { ctx.strokeStyle = INK; ctx.lineWidth = 1.6; const k = 7; ctx.beginPath(); ctx.moveTo(q.x + 9 - k / 2, q.y - k / 2 - 9); ctx.lineTo(q.x + 9 + k / 2, q.y + k / 2 - 9); ctx.moveTo(q.x + 9 + k / 2, q.y - k / 2 - 9); ctx.lineTo(q.x + 9 - k / 2, q.y + k / 2 - 9); ctx.stroke(); break; }
          }
          if (i === mid) { const m = along(P, cfg.link === "drop" ? .8 : pairs.length > 1 ? .34 : .5); anchor = { x: m.x, y: m.y }; if (cfg.linkLabel !== false && !(refus && pr[1].flag)) pill(m.x, m.y - 16, s.lab, false); }
        });
      } else if (s && !done) { const n = resolve(s.a)[0]; if (n && s.a !== "all") anchor = { x: n._p.x, y: n._p.y - n._r - 10 }; }
      nodes.slice().sort((a, b) => b._p.d - a._p.d).forEach(sphere);
      nodes.forEach(label);
      if (hooks.onFrame) hooks.onFrame(anchor);
      requestAnimationFrame(frame);
    }

    /* ------------------------------------------------------------ scénario */
    function emit() { if (hooks.onStep) hooks.onStep(stepIdx, STEPS[stepIdx] || null, money, { playing, done, total: STEPS.length }); }
    function goto(i) {
      i = clamp(i, 0, STEPS.length - 1);
      resetState(); for (let k = 0; k <= i; k++) applyFx(STEPS[k].fx);
      stepIdx = i; stepStart = now; emit();
    }
    function tick() { if (stepIdx >= STEPS.length - 1) { pause(); if (cfg.loop) setTimeout(play, 2600); return; } goto(stepIdx + 1); }
    function play() { clearInterval(timer); playing = true; goto(done || stepIdx < 0 || stepIdx >= STEPS.length - 1 ? 0 : stepIdx); timer = setInterval(tick, cfg.beatMs || 3600); emit(); }
    function pause() { clearInterval(timer); playing = false; emit(); }
    function reset() { clearInterval(timer); playing = false; stepIdx = -1; resetState(); emit(); }

    /* --------------------------------------------------------- interaction */
    function pick(mx, my) { let best = null; nodes.forEach(n => { if (n._p && Math.hypot(n._p.x - mx, n._p.y - my) < Math.max(n._r, 12) && (!best || n._p.d < best._p.d)) best = n; }); return best; }
    const xy = e => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, yaw: cam.tYaw, pitch: cam.tPitch, moved: 0 }; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => {
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 5) { cam.free = true; cam.tYaw = drag.yaw - dx * .005; cam.tPitch = clamp(drag.pitch + dy * .004, -.2, 1.5); } }
      const m = xy(e); hover = pick(m[0], m[1]); canvas.style.cursor = hover ? "pointer" : drag ? "grabbing" : "grab";
      if (hooks.onHover) hooks.onHover(hover, e.clientX, e.clientY);
    });
    canvas.addEventListener("pointerup", e => {
      if (drag && drag.moved < 6) { const m = xy(e), n = pick(m[0], m[1]);
        if (n) { cam.tf = V(n.pos.x - base.x, n.pos.y - base.y, n.pos.z - base.z); cam.tZoom = 1.7; }
        else { cam.tf = V(0, 0, 0); cam.tZoom = 1; cam.free = false; cam.tPitch = cfg.pitch; } }
      drag = null;
    });
    canvas.addEventListener("wheel", e => { e.preventDefault(); cam.tZoom = clamp(cam.tZoom * (e.deltaY > 0 ? .9 : 1.1), .45, 3.2); }, { passive: false });
    window.addEventListener("resize", resize);

    resize(); build(cfg.useCase || 0, false); requestAnimationFrame(frame);
    return {
      play, pause, reset, goto, next() { pause(); goto(stepIdx + 1); }, prev() { pause(); goto(stepIdx - 1); },
      toggle() { playing ? pause() : play(); },
      setCase(i, p2) { build(i, p2); cam.tf = V(0, 0, 0); cam.tZoom = 1; },
      setRole(r) { role = r; const n = r === "client" ? clients[0] : r === "travailleur" ? workers[0] : null;
        if (n) { cam.tf = V((n.pos.x - base.x) * .55, (n.pos.y - base.y) * .55, (n.pos.z - base.z) * .55); cam.tZoom = 1.35; } else { cam.tf = V(0, 0, 0); cam.tZoom = 1; } },
      info(n) {
        if (n.kind === "client") return [n.name, "Paie la commande d'avance, reçoit le livrable.", window.HC.USE_CASES[caseIdx].tasks + " · " + window.HC.USE_CASES[caseIdx].budget];
        if (n.kind === "contract") return ["Contrat NEAR", "Garde l'argent et applique le code du travail. Personne ne peut y déroger.", window.HC.NETWORK.contract];
        if (n.kind === "agent") return [n.name, "Découpe, embauche, contrôle, ordonne la paie. Ne détient jamais l'argent.", "plancher 0.02 · plafond 0.10 · marge ≥ 15 %"];
        return [n.name, n.status === "fired" ? "Renvoyé : 5 contrôles cachés, 0 %." : "Humain. Compte = clé publique, aucun wallet.", (n.gold ? "contrôle caché · " : "") + n.paid.toFixed(2) + " USDC" + (n.flag ? " · refus " + n.flag : "")];
      },
      steps: STEPS, state: () => ({ stepIdx, playing, done, money, nodes: nodes.length })
    };
  }

  window.HC9 = { create, STEPS };
})();