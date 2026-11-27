/* =====================================================================
   B. 星图模块  Oracle.starmap  { mount, open, close, arrive }
   ---------------------------------------------------------------------
   B1 工具函数          B6 绘制：星辰（背景星 / 会话星 / 星轨）
   B2 状态与主题        B7 绘制：空状态「此刻星位」
   B3 布局与模型        B8 流星降临
   B4 三维投影与相机     B9 动效与帧循环
   B5 星云与星盘刻度     B10 交互   B11 卡片与全篇 / 回放   B12 对外接口
   ===================================================================== */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;
  var TAU = Math.PI * 2;
  var SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  var reduceMotion = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- B1 工具函数 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function nowMs() { return win.performance && win.performance.now ? win.performance.now() : Date.now(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) { n.className = cls; }
    if (text != null) { n.textContent = text; }
    return n;
  }
  function mulberry(a) {
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function formatDate(ts) {
    if (!ts) { return ''; }
    var d = new Date(ts);
    return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function shichenIdx(ts) { return Math.floor(((new Date(ts).getHours() + 1) % 24) / 2); }
  function shichenOf(ts) { return SHICHEN[shichenIdx(ts)] + '时'; }
  /* 一天 24 小时映射到星盘一周，子时（0 点）在正北 */
  function hourAngle(ts) {
    var d = new Date(ts);
    return (d.getHours() + d.getMinutes() / 60) / 24 * TAU - Math.PI / 2;
  }

  /* ---------- B2 状态与主题 ---------- */
  var refs = null, ctx = null;
  var sessions = [], curSess = null, events = [];
  var running = false, rafId = 0, lastTs = 0, clock = 0;

  /* 布局：R / CY 会向目标值缓动，空状态 ↔ 有星 之间平滑过渡 */
  var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, R = 160, DIST = 500;
  var CY_T = 0, R_T = 160, layReady = false;

  var T_REST = 0.88, T_MIN = 0.34, T_MAX = 1.36;
  var AUTO_SPIN = 0.000035;
  var view = { rot: 0.4, vel: 0, tilt: T_REST, tiltV: 0, dragging: false };
  var cam = { z: 1, fx: 0, fy: 0, ox: 0, oy: 0, follow: false, kick: 0 };

  var ST = [], FIELD = [], LINKS = [], NEB = [], RINGS = [];
  var RIPS = [], MOTES = [], METEORS = [], SPARKS = [];
  var DUST = [], IMPACTS = [];   /* 流星星尘 / 落点效果 */
  var ARM = [], LATENT = [];     /* 空状态浑仪的环 / 隐星 */
  var labelFlare = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var MW = null;                       /* 银河纹理 */
  var introT = -1, INTRO_MS = 4800;    /* 开场「星图展开」计时，-1 表示不在开场中 */
  var AMB = [], ambNext = 7000;        /* 背景偶发的小流星 */
  var RIM_OUT = [];
  /* 二十八宿与古度（合 365¼ 度），用于外缘天盘的不等分 */
  var XIU = [['角', 12], ['亢', 9], ['氐', 15], ['房', 5], ['心', 5], ['尾', 18], ['箕', 11],
             ['斗', 26], ['牛', 8], ['女', 12], ['虚', 10], ['危', 17], ['室', 16], ['壁', 9],
             ['奎', 16], ['娄', 12], ['胃', 14], ['昴', 11], ['毕', 16], ['觜', 2], ['参', 9],
             ['井', 33], ['鬼', 4], ['柳', 15], ['星', 7], ['张', 18], ['翼', 18], ['轸', 17]];
  function introAt(t0, len) { return introT < 0 ? 1 : smooth((introT - t0) / len); }

  var sel = -1, hover = -1;
  var emptyMode = false;
  var emptyK = 0;            /* 0 = 有星，1 = 空状态；缓动值，驱动所有空状态视觉 */
  var nowA = 0, nowIdx = 0, nowTick = -1e9;   /* 此刻的方位角与时辰，每 20 秒刷新 */
  var pointer = { x: -9999, y: -9999, inside: false, touch: false, acc: 0, lastRip: 0 };
  var mh = { x: -9999, y: -9999, on: false };  /* 流星头部位置：途经的星会被“惊动” */
  var moteTimer = 0, alphaMul = 1;
  var TH = null, toastTimer = 0;

  function makeGlow(rgb, soft) {
    var c = doc.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)');
    gr.addColorStop(soft ? 0.18 : 0.3, 'rgba(' + rgb + ',' + (soft ? 0.38 : 0.7) + ')');
    gr.addColorStop(soft ? 0.5 : 0.62, 'rgba(' + rgb + ',' + (soft ? 0.08 : 0.16) + ')');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }
  function makeSpike(rgb) {
    var S = 128, c = doc.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), m = S / 2;
    function ray(len, w, ang) {
      g.save(); g.translate(m, m); g.rotate(ang);
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, len);
      gr.addColorStop(0, 'rgba(' + rgb + ',1)');
      gr.addColorStop(0.22, 'rgba(' + rgb + ',0.55)');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-len, 0); g.lineTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w);
      g.closePath(); g.fill(); g.restore();
    }
    ray(m, 2.4, 0); ray(m, 2.4, Math.PI / 2);
    ray(m * 0.36, 1.5, Math.PI / 4); ray(m * 0.36, 1.5, -Math.PI / 4);
    return c;
  }

  function buildTheme() {
    var dark = doc.documentElement.classList.contains('dark');
    var halo = dark ? '168,188,228' : '22,24,32';
    var spk = dark ? '226,233,250' : '22,24,32';
    var warm = dark ? '236,241,255' : '18,18,20';
    TH = {
      dark: dark,
      blend: dark ? 'lighter' : 'source-over',
      line: dark ? '220,228,248' : '18,18,20',
      tail: dark ? '178,198,240' : '18,18,20',
      haloA: dark ? 0.34 : 0.26,
      fieldHaloA: dark ? 0.34 : 0.62,
      spikeA: dark ? 0.62 : 0.55,
      halo: makeGlow(halo, true),
      haloTight: makeGlow(halo, false),
      haloWarm: makeGlow(warm, true),
      core: makeGlow('255,255,255', false),
      coreWarm: makeGlow('255,255,255', false),
      spike: makeSpike(spk),
      spikeWarm: makeSpike(warm)
    };
    MW = makeMilkyWay(dark);
  }

  /* ---------- B3 布局与模型 ---------- */
  function resize(snap) {
    if (!refs) { return; }
    W = win.innerWidth; H = win.innerHeight;
    DPR = Math.min(win.devicePixelRatio || 1, 2);
    refs.canvas.width = Math.round(W * DPR);
    refs.canvas.height = Math.round(H * DPR);
    var st = refs.stage.getBoundingClientRect();
    var colW = Math.min(W, 760);
    CX = W / 2;
    CY_T = st.top + st.height * (emptyMode ? 0.42 : 0.45);
    var portrait = H / W > 1.3;
    var prevRest = T_REST;
    /* 空状态视线压低，浑仪的立体穿插更明显；有星时更正视，便于读盘。
       两者之间由俯仰弹簧自然过渡——像整架仪器缓缓转向你 */
    T_REST = emptyMode ? (portrait ? 0.98 : 1.08) : (portrait ? 0.64 : 0.88);
    if (snap || view.tilt === prevRest) { view.tilt = T_REST; view.tiltV = 0; }
    R_T = Math.max(110, Math.min(colW / 2 - (portrait ? 38 : 26), (st.height * 0.5 - 78) / 1.02, 330));
    if (emptyMode) { R_T = Math.max(96, Math.min(R_T * 0.9, (st.height - 300) * 0.4)); }
    if (snap || !layReady) { CY = CY_T; R = R_T; layReady = true; }
    DIST = R * 3.4;
    /* 空状态文字放在星盘近侧边缘（含时辰字）之下 */
    if (refs.empty && emptyMode) {
      var lr = 1.17 * R_T, D = R_T * 3.4;
      var nearY = lr * Math.cos(T_REST) * D / (D - lr * Math.sin(T_REST));
      var low = 1.12 * R_T * Math.sin(T_REST);   /* 子午环的下缘 */
      refs.empty.style.top = Math.round(Math.min(CY_T - st.top + Math.max(nearY, low) + 4, st.height - 262)) + 'px';
    }
  }

  /* 背景：盘面星、天球远星、星官、星云、星轨环（只与屏幕尺寸有关） */
  function buildField() {
    var rng = mulberry(4402), i, j;
    FIELD = []; LINKS = [];
    var area = W * H;
    var nDisc = Math.round(clamp(area / 3400, 90, 230));
    var nSphere = Math.round(clamp(area / 7000, 50, 140));
    function star(r, a, h, mag, kind) {
      FIELD.push({ r: r, a: a, h: h, mag: mag, kind: kind, size: 0.6 + mag * 1.6, spk: mag > 0.62,
        tw: 0.0006 + rng() * 0.0022, ph: rng() * TAU, res: 0 });
    }
    for (i = 0; i < nDisc; i++) { star(Math.sqrt(rng()) * 1.02, rng() * TAU, (rng() - 0.5) * 0.09, Math.pow(rng(), 2.4), 0); }
    for (i = 0; i < nSphere; i++) {
      var u = rng() * 2 - 1, th = rng() * TAU, rad = 1.55 + rng() * 0.4;
      star(Math.sqrt(1 - u * u) * rad, th, u * rad, Math.pow(rng(), 2) * 0.75, 1);
    }
    for (i = 0; i < 7; i++) {
      var cr = 0.3 + rng() * 0.62, ca = rng() * TAU, n = 4 + Math.floor(rng() * 3);
      var base = FIELD.length, x0 = Math.cos(ca) * cr, y0 = Math.sin(ca) * cr;
      for (j = 0; j < n; j++) {
        var x = x0 + (rng() - 0.5) * 0.22, y = y0 + (rng() - 0.5) * 0.22;
        star(Math.sqrt(x * x + y * y), Math.atan2(y, x), (rng() - 0.5) * 0.04, 0.45 + rng() * 0.45, 2);
      }
      var used = [base], cur = base;
      while (used.length < n) {
        var best = -1, bd = 9;
        for (j = base; j < base + n; j++) {
          if (used.indexOf(j) >= 0) { continue; }
          var d = polarDist(FIELD[cur], FIELD[j]);
          if (d < bd) { bd = d; best = j; }
        }
        LINKS.push([cur, best]); used.push(best); cur = best;
      }
    }
    NEB = [];
    for (i = 0; i < 6; i++) {
      NEB.push({ r: 0.25 + rng() * 0.6, a: rng() * TAU, rad: 0.35 + rng() * 0.35, a0: 0.6 + rng() * 0.5, drift: (rng() - 0.5) * 0.00003 });
    }
    RINGS = [];
    var rr = [0.25, 0.5, 0.75], q;
    for (q = 0; q < rr.length; q++) { RINGS.push({ pts: circlePts(rr[q], 0, 0), alpha: 0.05, dash: q === 1 }); }
    RINGS.push({ pts: circlePts(1, 0, 0), alpha: 0.16 });
    RINGS.push({ pts: circlePts(0.86, 0.41, 0.7), alpha: 0.07, ecl: true });
    RIM_OUT = circlePts(1.075, 0, 0);
    buildArmillary();
  }

  /* 会话星：方位 = 时辰，半径 = 新旧。保留已有星的动态状态，
     新星的半径 / 亮度目标改变时，旧星会缓缓向外让位。
     pending：以 no 为键，这些星先不显影，等流星落下。 */
  function placeFor(i, N) {
    var k = N > 1 ? (N - 1 - i) / (N - 1) : 0;
    return { r: N > 1 ? 0.2 + 0.72 * Math.pow(k, 0.85) : 0.42, b: N > 1 ? 1 - 0.58 * k : 1 };
  }
  function buildStars(pending) {
    var selNo = sel >= 0 && ST[sel] ? ST[sel].sess.no : null;
    sessions.sort(function (a, b) { return a.startedAt - b.startedAt; });
    var prev = {}, i;
    for (i = 0; i < ST.length; i++) { prev[ST[i].sess.no] = ST[i]; }
    var N = sessions.length, out = [];
    for (i = 0; i < N; i++) {
      var s = sessions[i], pl = placeFor(i, N), o = prev[s.no];
      if (o) { o.sess = s; o.rT = pl.r; o.bT = pl.b; out.push(o); continue; }
      var jr = mulberry((+s.no || i) * 31 + 7);
      out.push({
        sess: s, r: pl.r, rT: pl.r, bright: pl.b, bT: pl.b,
        a: hourAngle(s.startedAt) + (jr() - 0.5) * 0.08,
        h: (jr() - 0.5) * 0.03,
        size: clamp(1.7 + Math.sqrt(s.msgCount || 1) * 0.6, 2.2, 5.6),
        spike: (s.msgCount || 0) >= 14,
        ph: jr() * TAU,
        dev: pending && pending[s.no] ? 0 : 1, devOn: false,
        heat: 0, hov: 0, px: 0, py: 0, pz: 0, pf: 1, rx: 0, ry: 0
      });
    }
    ST = out;
    sel = -1; hover = -1;
    if (selNo) { for (i = 0; i < ST.length; i++) { if (ST[i].sess.no === selNo) { sel = i; } } }
  }

  function polarDist(p, q) {
    var dx = Math.cos(p.a) * p.r - Math.cos(q.a) * q.r;
    var dy = Math.sin(p.a) * p.r - Math.sin(q.a) * q.r;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function circlePts(r, inc, rotA) {
    var pts = [], n = 120, i;
    for (i = 0; i <= n; i++) {
      var t = i / n * TAU;
      var x = Math.cos(t) * r, y = Math.sin(t) * r * Math.cos(inc), h = Math.sin(t) * r * Math.sin(inc);
      pts.push({ r: Math.sqrt(x * x + y * y), a: Math.atan2(y, x) + rotA, h: h });
    }
    return pts;
  }

  /* ---------- B4 三维投影与相机 ---------- */
  var P = { x: 0, y: 0, z: 0, f: 1 };
  /* 盘面笛卡尔坐标（单位 = R，z 为离盘面高度）→ 屏幕。先绕法线自转，再俯仰，最后透视与相机 */
  function project3(x0, y0, h, out) {
    var cr = Math.cos(view.rot), sr = Math.sin(view.rot);
    var x = (x0 * cr - y0 * sr) * R, y = (x0 * sr + y0 * cr) * R, z = h * R;
    var ct = Math.cos(view.tilt), st = Math.sin(view.tilt);
    var y1 = y * ct - z * st, z1 = y * st + z * ct;
    var f = DIST / (DIST - z1);
    var sx = x * f, sy = y1 * f;
    out.x = CX + (sx - cam.fx) * cam.z + cam.ox;
    out.y = CY + (sy - cam.fy) * cam.z + cam.oy;
    out.z = z1 / R; out.f = f * cam.z;
    out.rx = sx; out.ry = sy;
    return out;
  }
  /* 极坐标版本：r 半径占比，a 方位角，h 高度 */
  function project(r, a, h, out) { return project3(Math.cos(a) * r, Math.sin(a) * r, h, out); }

  function updateCamera(dt) {
    var e = 1 - Math.exp(-dt / 320);
    var tz = 1, tfx = 0, tfy = 0, tox = 0, toy = 0;
    cam.kick *= Math.exp(-dt / 450);
    if (sel >= 0 && cam.follow) {
      var s = ST[sel];
      tz = W < 600 ? 1.08 : 1.16;
      tfx = s.rx; tfy = s.ry;
      var cardTop = refs.card.getBoundingClientRect().top || H * 0.7;
      toy = clamp((cardTop - 40) * 0.5 + 30, H * 0.22, H * 0.5) - CY;
      tox = s.rx * (W < 600 ? 0.6 : 0.25);
    }
    tz += 0.04 * cam.kick;   /* 流星落定时镜头轻轻一推 */
    cam.z += (tz - cam.z) * e; cam.fx += (tfx - cam.fx) * e; cam.fy += (tfy - cam.fy) * e;
    cam.ox += (tox - cam.ox) * e; cam.oy += (toy - cam.oy) * e;
  }

  /* ---------- B5 星云与星盘刻度 ---------- */
  function rgba(rgb, a) { return 'rgba(' + rgb + ',' + (a < 0 ? 0 : a) + ')'; }

  var EA = {}, EB = {}, EC = {};
  function diskEllipse(r) {
    project(r, -Math.PI / 2 - view.rot, 0, EA);
    project(r, Math.PI / 2 - view.rot, 0, EB);
    project(r, -view.rot, 0, EC);
    var x = (EA.x + EB.x) / 2, y = (EA.y + EB.y) / 2;
    return { x: x, y: y, rx: Math.abs(EC.x - x), ry: Math.abs(EB.y - EA.y) / 2 };
  }

  function drawSky() {
    var squash = Math.max(0.28, Math.cos(view.tilt));
    var E = diskEllipse(1), rad = E.rx * 1.06;
    ctx.save();
    ctx.translate(E.x, E.y); ctx.scale(1, E.ry / E.rx);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    if (TH.dark) {
      g.addColorStop(0, 'rgba(200,212,240,0.07)');
      g.addColorStop(0.5, 'rgba(160,178,220,0.025)');
      g.addColorStop(1, 'rgba(160,178,220,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.6)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.14)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill();
    ctx.restore();

    /* 星云：空状态时墨更淡，像尚未研开 */
    ctx.globalCompositeOperation = TH.blend;
    var nebK = 1 - 0.7 * emptyK, i;
    for (i = 0; i < NEB.length; i++) {
      var n = NEB[i];
      if (!reduceMotion) { n.a += n.drift * 16; }
      project(n.r, n.a, 0, P);
      var nr = n.rad * R * P.f;
      ctx.save();
      ctx.translate(P.x, P.y); ctx.scale(1, squash);
      var ng = ctx.createRadialGradient(0, 0, 0, 0, 0, nr);
      var c = TH.dark ? '140,155,190' : '24,26,32';
      var a0 = (TH.dark ? 0.06 : 0.035) * n.a0 * nebK;
      ng.addColorStop(0, rgba(c, a0)); ng.addColorStop(0.5, rgba(c, a0 * 0.45)); ng.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = ng;
      ctx.fillRect(-nr, -nr, nr * 2, nr * 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function strokePts(pts, alpha, width, dash, frac) {
    var i, n = frac == null ? pts.length : Math.floor(pts.length * clamp(frac, 0, 1));
    if (n < 2) { return; }
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      project(pts[i].r, pts[i].a, pts[i].h, P);
      if (i === 0) { ctx.moveTo(P.x, P.y); } else { ctx.lineTo(P.x, P.y); }
    }
    ctx.strokeStyle = rgba(TH.line, alpha); ctx.lineWidth = width;
    if (dash) { ctx.setLineDash([1, 5]); }
    ctx.stroke();
    if (dash) { ctx.setLineDash([]); }
  }

  function tickPath(n, r0, r1, offset) {
    var i, a;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      a = i / n * TAU + offset;
      project(r0, a, 0, P); ctx.moveTo(P.x, P.y);
      project(r1, a, 0, P); ctx.lineTo(P.x, P.y);
    }
  }

  function drawDial() {
    var i, dialK = (1 - emptyK) * introAt(150, 1400), labK = (1 - 0.25 * emptyK) * introAt(700, 1400);
    for (i = 0; i < RINGS.length; i++) {
      var rg = RINGS[i];
      strokePts(rg.pts, rg.alpha * (1 - emptyK) * (TH.dark ? 1.15 : 1), 0.6, rg.dash || rg.ecl, introAt(i * 160, 1300));
    }
    drawRim(dialK);

    /* 「此刻」刻针：外缘一道短刻 + 一粒墨点，标出下一颗星会落在的方位。
       有星时很淡，空状态时是画面的主角之一。 */
    var nk = 0.3 + 0.7 * emptyK;
    ctx.beginPath();
    project(0.97, nowA, 0, P); ctx.moveTo(P.x, P.y);
    project(1.1, nowA, 0, P); ctx.lineTo(P.x, P.y);
    ctx.strokeStyle = rgba(TH.line, 0.34 * nk); ctx.lineWidth = 0.8; ctx.stroke();
    project(1, nowA, 0, P);
    ctx.beginPath(); ctx.arc(P.x, P.y, 1.5 * P.f, 0, TAU);
    ctx.fillStyle = rgba(TH.line, 0.5 * nk); ctx.fill();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = 0; i < 12; i++) {
      project(1.17, i / 12 * TAU - Math.PI / 2, 0, P);
      var depth = clamp((P.z + 1) / 2, 0, 1);
      var lit = i === nowIdx ? 0.34 * nk : 0;
      var fl = labelFlare[i];   /* 流星落在哪个时辰，那个字就骤亮一下 */
      ctx.font = ((i === nowIdx && emptyK > 0.5) || fl > 0.3 ? '400 ' : '300 ') + (9.5 * P.f * (1 + 0.3 * fl)).toFixed(1) + 'px PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, sans-serif';
      ctx.fillStyle = rgba(TH.line, Math.min(1, (0.12 + 0.26 * depth) * labK + lit + 0.6 * fl));
      ctx.fillText(SHICHEN[i], P.x, P.y);
    }
  }

  /* ---------- B6 星辰 ---------- */
  function sprite(img, x, y, size, alpha) {
    alpha *= alphaMul;
    if (alpha <= 0.004 || size < 0.5) { return; }
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  function drawField(dt) {
    var i, f, e = 1 - Math.exp(-dt / 140);
    var px = pointer.inside ? pointer.x : -9999, py = pointer.inside ? pointer.y : -9999;

    ctx.beginPath();
    for (i = 0; i < LINKS.length; i++) {
      var A = FIELD[LINKS[i][0]], B = FIELD[LINKS[i][1]];
      project(A.r, A.a, A.h, P); ctx.moveTo(P.x, P.y);
      project(B.r, B.a, B.h, P); ctx.lineTo(P.x, P.y);
    }
    ctx.strokeStyle = rgba(TH.line, (TH.dark ? 0.13 : 0.1) * (1 - emptyK));
    ctx.lineWidth = 0.6;
    ctx.stroke();

    ctx.globalCompositeOperation = TH.blend;
    for (i = 0; i < FIELD.length; i++) {
      f = FIELD[i];
      project(f.r, f.a, f.h, P);
      if (P.x < -30 || P.x > W + 30 || P.y < -30 || P.y > H + 30) { continue; }
      var dx = P.x - px, dy = P.y - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      var near = d < 110 ? 1 - d / 110 : 0;
      if (mh.on) {   /* 流星经过时，沿途的星被“惊动”亮起 */
        var mx = P.x - mh.x, my = P.y - mh.y, md = Math.sqrt(mx * mx + my * my);
        if (md < 90) { near = Math.max(near, 1 - md / 90); }
      }
      f.res += (near - f.res) * e;
      var depth = clamp((P.z + 1) / 2, 0, 1);
      var tw = reduceMotion ? 1 : 0.68 + 0.32 * Math.sin(clock * f.tw + f.ph);
      var a = introAt(150 + f.r * 900, 900) * (f.kind === 1 ? 1 - 0.35 * emptyK : 1 - 0.8 * emptyK) * (0.36 + 0.64 * f.mag) * tw * (f.kind === 1 ? 0.55 : 0.6 + 0.4 * depth) * (1 + 1.3 * f.res);
      var s = Math.min(f.size * P.f, f.kind === 1 ? 1.4 : 3.6) * (1 + 0.4 * f.res);
      if (TH.dark) {
        a *= 0.38;
        sprite(TH.halo, P.x, P.y, s * 4.2, a * TH.fieldHaloA * 0.4);
        if (f.res > 0.45) { sprite(TH.spike, P.x, P.y, s * 6, a * TH.spikeA * f.res * 0.5); }
        sprite(TH.core, P.x, P.y, s * 1.8, a * 0.55);
      } else {
        a *= 0.55;
        if (f.res > 0.45) { sprite(TH.spike, P.x, P.y, s * 6, a * TH.spikeA * f.res * 0.5); }
        sprite(TH.haloTight, P.x, P.y, s * 2.8, a * TH.fieldHaloA * 0.5);
        sprite(TH.core, P.x, P.y, s * 1.8, Math.min(1, a * 1.2));
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 星轨 */
  function trailCurve(i, out) {
    var A = ST[i], B = ST[i + 1];
    var ax = Math.cos(A.a) * A.r, ay = Math.sin(A.a) * A.r;
    var bx = Math.cos(B.a) * B.r, by = Math.sin(B.a) * B.r;
    var mx = (ax + bx) / 2, my = (ay + by) / 2;
    var len = Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
    project(Math.sqrt(mx * mx + my * my), Math.atan2(my, mx), 0.03 + len * 0.12, P);
    out.x0 = A.px; out.y0 = A.py; out.x1 = B.px; out.y1 = B.py;
    out.cx = 2 * P.x - (A.px + B.px) / 2;
    out.cy = 2 * P.y - (A.py + B.py) / 2;
    return out;
  }
  var CV = {};

  /* 只画二次曲线的前 t 段（de Casteljau 分割），用于新星连线的生长 */
  function partialQuad(c, t) {
    var ax = c.x0 + (c.cx - c.x0) * t, ay = c.y0 + (c.cy - c.y0) * t;
    var bx = c.cx + (c.x1 - c.cx) * t, by = c.cy + (c.y1 - c.cy) * t;
    ctx.moveTo(c.x0, c.y0);
    PQ.x = ax + (bx - ax) * t; PQ.y = ay + (by - ay) * t;
    ctx.quadraticCurveTo(ax, ay, PQ.x, PQ.y);
  }
  var PQ = { x: 0, y: 0 };

  function drawTrail() {
    var i, N = ST.length;
    if (N < 2) { return; }
    for (i = 0; i < N - 1; i++) {
      var A = ST[i], B = ST[i + 1];
      if (A.dev <= 0 || B.dev <= 0) { continue; }
      trailCurve(i, CV);
      var near = sel >= 0 && (i === sel || i === sel - 1);
      var age = (i + 1) / (N - 1);
      var grow = B.dev < 1 ? smooth(B.dev * 1.25) : 1;
      var glow = B.dev < 1 ? 1 - B.dev : 0;
      ctx.beginPath();
      if (grow < 1) { partialQuad(CV, grow); } else { ctx.moveTo(CV.x0, CV.y0); ctx.quadraticCurveTo(CV.cx, CV.cy, CV.x1, CV.y1); }
      if (near) {
        ctx.strokeStyle = rgba(TH.line, TH.dark ? 0.42 : 0.34);
        ctx.lineWidth = 0.8;
      } else {
        ctx.strokeStyle = rgba(TH.line, (TH.dark ? 0.07 : 0.06) + age * (TH.dark ? 0.12 : 0.1) + glow * 0.3);
        ctx.lineWidth = 0.6 + glow * 0.4;
      }
      ctx.stroke();
      if (grow > 0 && grow < 1) {   /* 一粒光珠领着线头，从上一颗星走向新星 */
        ctx.globalCompositeOperation = TH.blend;
        sprite(TH.haloWarm, PQ.x, PQ.y, 16, TH.dark ? 0.55 : 0.32);
        sprite(TH.coreWarm, PQ.x, PQ.y, 5.5, 1);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (sel >= 0) {
      ctx.globalCompositeOperation = TH.blend;
      var segs = [sel - 1, sel], k;
      for (k = 0; k < 2; k++) {
        var si = segs[k];
        if (si < 0 || si > N - 2 || ST[si].dev < 1 || ST[si + 1].dev < 1) { continue; }
        trailCurve(si, CV);
        var t = reduceMotion ? 0.5 : (clock * 0.00028 + k * 0.5) % 1;
        if (k === 0) { t = 1 - t; }
        var u = 1 - t;
        var bx = u * u * CV.x0 + 2 * u * t * CV.cx + t * t * CV.x1;
        var by = u * u * CV.y0 + 2 * u * t * CV.cy + t * t * CV.y1;
        var fade = Math.sin(t * Math.PI);
        sprite(TH.haloWarm, bx, by, 12, fade * (TH.dark ? 0.5 : 0.3));
        sprite(TH.coreWarm, bx, by, 5, fade);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawSessions(dt) {
    var i, s, e = 1 - Math.exp(-dt / 320), eR = 1 - Math.exp(-dt / 900);
    for (i = 0; i < ST.length; i++) {
      s = ST[i];
      s.r += (s.rT - s.r) * eR;              /* 新星到来时，旧星缓缓向外让位 */
      s.bright += (s.bT - s.bright) * eR;
      if (!s.devOn && s.devAt != null && introT >= s.devAt) { s.devOn = true; }
      if (s.devOn && s.dev < 1) {
        s.dev = Math.min(1, s.dev + dt / (s.soft ? 1000 : 1600));
        if (s.dev >= 1) { s.soft = false; s.devAt = null; }
      }
      s.flick = (s.flick || 0) * Math.exp(-dt / 520);
      project(s.r, s.a, s.h, P);
      s.px = P.x; s.py = P.y; s.pz = P.z; s.pf = P.f; s.rx = P.rx; s.ry = P.ry;
      s.heat += ((i === sel ? 1 : 0) - s.heat) * e;
      s.hov += ((i === hover ? 1 : 0) - s.hov) * e;
    }
    if (sel >= 0) {
      var so = ST[sel], n = 96, k;
      ctx.beginPath();
      for (k = 0; k <= n; k++) {
        project(so.r, k / n * TAU, 0, P);
        if (k === 0) { ctx.moveTo(P.x, P.y); } else { ctx.lineTo(P.x, P.y); }
      }
      ctx.strokeStyle = rgba(TH.line, 0.16 * so.heat);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    drawTrail();
    drawFlow();
    for (i = 0; i < ST.length; i++) { drawSessionStar(ST[i]); }
    drawNewestPulse();
    for (i = 0; i < ST.length; i++) { drawTag(ST[i]); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawSessionStar(s) {
    if (s.dev <= 0) { return; }
    /* 显影：由透明到清晰，中途一次柔和的光爆（bloom） */
    var vis = smooth(s.dev * 1.4);
    var bloom = s.dev < 1 ? Math.sin(s.dev * Math.PI) * (s.soft ? 0.3 : 1) : 0;
    var flick = s.flick || 0;
    alphaMul = vis;

    var depth = clamp((s.pz + 1) / 2, 0, 1);
    var breath = reduceMotion ? 1 : 1 + 0.12 * Math.sin(clock * 0.0018 + s.ph);
    var k = s.bright * (0.7 + 0.3 * depth);
    var hot = s.heat, cool = 1 - hot;
    var sz = s.size * s.pf * (1 + 0.32 * hot + 0.18 * s.hov + 0.3 * flick) * (0.6 + 0.4 * vis + 0.35 * bloom);
    var x = s.px, y = s.py;

    ctx.globalCompositeOperation = TH.blend;
    var outer = sz * 13 * breath, inner = sz * 4.8;
    sprite(TH.haloWarm, x, y, outer * 1.35, (TH.dark ? 0.85 : 0.5) * vis);
    sprite(TH.halo, x, y, outer, k * TH.haloA * 0.9 * cool);
    sprite(TH.haloWarm, x, y, outer * 1.15, TH.haloA * (TH.dark ? 1.8 : 1.2) * hot);
    sprite(TH.dark ? TH.halo : TH.haloTight, x, y, inner, k * TH.haloA * (TH.dark ? 2.4 : 1.8) * cool);
    sprite(TH.haloWarm, x, y, inner, TH.haloA * (TH.dark ? 2.8 : 1.8) * hot);
    if (bloom > 0.01) {
      alphaMul = 1;
      sprite(TH.halo, x, y, sz * 26 * (0.6 + 0.4 * bloom), bloom * (TH.dark ? 0.55 : 0.4));
      sprite(TH.spikeWarm, x, y, sz * 30 * bloom, bloom * (TH.dark ? 0.9 : 0.6));
      alphaMul = vis;
    }

    /* 真实历史星星：长显晶莹璀璨的金色神圣四芒星辉 */
    var spikeOn = Math.max(0.72, s.hov, hot);
    var sl = sz * 10 * (1 + 0.35 * s.hov + 0.5 * hot) * (reduceMotion ? 1 : 0.94 + 0.06 * Math.sin(clock * 0.0023 + s.ph));
    sprite(TH.spikeWarm, x, y, sl * 1.25, (TH.dark ? 1.1 : 0.75) * spikeOn * vis);
    sprite(TH.spike, x, y, sl * 0.9, (TH.dark ? 0.9 : 0.6) * spikeOn * vis);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    /* 专属神圣流金脉冲光环（Celestial Aura Ring） */
    var pRing = sz * (2.8 + 0.4 * Math.sin(clock * 0.0024 + s.ph));
    ctx.beginPath();
    ctx.arc(x, y, pRing, 0, TAU);
    ctx.strokeStyle = TH.dark
      ? 'rgba(235, 185, 95, ' + ((0.42 + 0.28 * Math.sin(clock * 0.0024 + s.ph)) * vis).toFixed(3) + ')'
      : 'rgba(180, 115, 45, ' + (0.35 * vis).toFixed(3) + ')';
    ctx.lineWidth = 0.85;
    ctx.stroke();

    if (TH.dark) {
      ctx.globalCompositeOperation = 'lighter';
      sprite(TH.coreWarm, x, y, sz * 4.6, vis);
      sprite(TH.core, x, y, sz * 2.8, k * vis);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    } else {
      sprite(TH.coreWarm, x, y, sz * 4.2, 0.9 * vis);
      var g = ctx.createRadialGradient(x - sz * 0.25, y - sz * 0.3, 0, x, y, sz);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#ececea');
      ctx.globalAlpha = vis;
      ctx.beginPath(); ctx.arc(x, y, sz, 0, TAU);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = rgba('18,18,20', 0.16 + 0.26 * k + 0.25 * hot);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* 历史星星常驻专属标签编号提示，一眼可辨 */
    if (s.dev >= 0.85 && s.sess && s.sess.no) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '400 9px ' + TAG_FONT;
      ctx.fillStyle = TH.dark ? 'rgba(235, 195, 120, 0.78)' : 'rgba(110, 80, 25, 0.75)';
      ctx.fillText('No.' + s.sess.no, x, y + pRing + 3);
      ctx.restore();
    }

    /* 衍射环：消息多的大星外一圈极细光环 */
    if (s.spike) {
      ctx.globalAlpha = vis;
      ctx.beginPath(); ctx.arc(x, y, sz * 2.7, 0, TAU);
      ctx.strokeStyle = rgba(TH.line, (TH.dark ? 0.17 : 0.13) * k);
      ctx.lineWidth = 0.5; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (flick > 0.02) {   /* 时光之流经过时的一闪 */
      ctx.globalCompositeOperation = TH.blend;
      sprite(TH.haloWarm, x, y, sz * 9, flick * (TH.dark ? 0.45 : 0.25));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (hot > 0.02) {
      var rr = sz * 3.6 + 8, rot = reduceMotion ? 0 : clock * 0.0004, q;
      ctx.globalAlpha = hot;
      ctx.strokeStyle = rgba(TH.line, TH.dark ? 0.5 : 0.38);
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      ctx.beginPath();
      for (q = 0; q < 4; q++) {
        var a = rot + q * Math.PI / 2;
        ctx.moveTo(x + Math.cos(a) * (rr + 3), y + Math.sin(a) * (rr + 3));
        ctx.lineTo(x + Math.cos(a) * (rr + 9), y + Math.sin(a) * (rr + 9));
      }
      ctx.stroke();
      ctx.setLineDash([1, 4]);
      ctx.strokeStyle = rgba(TH.line, 0.2);
      ctx.beginPath(); ctx.arc(x, y, rr * 1.75, -rot * 0.6, TAU - rot * 0.6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    alphaMul = 1;
  }

  /* ---------- B7 空状态：浑仪（灵性天球仪） ----------
     有星时，星图是一张俯看的平盘；没有星时，它还是一架没合拢的浑仪：
       · 地平环、子午环、卯酉环、赤道环（二十八宿刻度）、四游环、黄道环、白道环，
         各自倾斜、缓转，后半圈虚线、前半圈实线，形成真实的立体穿插
       · 一粒「日」沿黄道、一枚「月」沿白道运行；极轴贯穿赤道环
       · 隐星：天球壳上偶尔闪现又隐去的星，像底片里还没显出的影
       · 此刻星位：地平面上、此刻时辰方位的空心菱，第一颗星会落在这里
     第一颗星来临时，各环的倾角、半径缓缓收拢到星盘的同心环上，
     浑仪“合拢”成星盘——两种状态因此一眼可辨，又一气相连。 */
  function buildArmillary() {
    var H2 = Math.PI / 2;
    ARM = [
      { r: 1.0,  inc: 0,    node: 0,   spin: 0,        rF: 1.0,  incF: 0,    nodeF: 0,   dbl: 0.04,  tk: 0,  a: 0.5 },   /* 地平 */
      { r: 1.08, inc: H2,   node: 0,   spin: 0,        rF: 0.75, incF: 0,    nodeF: 0,   dbl: 0.035, tk: 36, a: 0.4 },   /* 子午 */
      { r: 1.08, inc: H2,   node: H2,  spin: 0,        rF: 0.75, incF: 0,    nodeF: 0,   dbl: 0,     tk: 0,  a: 0.2 },   /* 卯酉 */
      { r: 0.96, inc: 0.62, node: 0.9, spin: 0,        rF: 0.5,  incF: 0,    nodeF: 0,   dbl: 0.03,  tk: 28, a: 0.42 },  /* 赤道 */
      { r: 0.78, inc: H2,   node: 0.4, spin: 0.00012,  rF: 0.25, incF: 0,    nodeF: 0,   dbl: 0.03,  tk: 0,  a: 0.3 },   /* 四游 */
      { r: 0.9,  inc: 1.03, node: 0.9, spin: 0.00004,  rF: 0.86, incF: 0.41, nodeF: 0.7, dbl: 0,     tk: 0,  a: 0.32, bead: 1, bsp: 0.00021 },  /* 黄道 · 日 */
      { r: 0.62, inc: 1.28, node: 2.1, spin: -0.00015, rF: 0.25, incF: 0,    nodeF: 0,   dbl: 0,     tk: 0,  a: 0.22, bead: 2, bsp: -0.00038 }  /* 白道 · 月 */
    ];
    var rng = mulberry(9157), i;
    LATENT = [];
    for (i = 0; i < 46; i++) {
      var u = rng() * 2 - 1, th = rng() * TAU, rr = 0.88 + rng() * 0.3, c = Math.sqrt(1 - u * u) * rr;
      LATENT.push({ x: Math.cos(th) * c, y: Math.sin(th) * c, z: u * rr, per: 3800 + rng() * 6500, ph: rng(), sz: 0.9 + rng() * 1.7 });
    }
  }

  /* 角度插值走最短弧，避免收拢时节点疯转 */
  function angLerp(a, b, k) {
    var d = ((b - a) % TAU + Math.PI * 3) % TAU - Math.PI;
    return a + d * k;
  }
  var Q3 = { x: 0, y: 0, z: 0 };
  function ringXYZ(r, ci, si, cn, sn, t, o) {
    var x = Math.cos(t) * r, y0 = Math.sin(t) * r;
    var y = y0 * ci;
    o.z = y0 * si;
    o.x = x * cn - y * sn;
    o.y = x * sn + y * cn;
    return o;
  }
  var XS = new Float32Array(160), YS = new Float32Array(160), ZS = new Float32Array(160);
  function ringPts(r, ci, si, cn, sn, n) {
    var i;
    for (i = 0; i <= n; i++) {
      ringXYZ(r, ci, si, cn, sn, i / n * TAU, Q3);
      project3(Q3.x, Q3.y, Q3.z, P);
      XS[i] = P.x; YS[i] = P.y; ZS[i] = P.z;
    }
  }
  /* 只描前半圈或后半圈，前实后虚，环与环之间就有了前后穿插 */
  function strokeHalf(n, front, alpha, width, dash) {
    var i, open = false;
    if (alpha <= 0.004) { return; }
    ctx.beginPath();
    for (i = 1; i <= n; i++) {
      if ((ZS[i - 1] + ZS[i] >= 0) === front) {
        if (!open) { ctx.moveTo(XS[i - 1], YS[i - 1]); open = true; }
        ctx.lineTo(XS[i], YS[i]);
      } else { open = false; }
    }
    if (dash) { ctx.setLineDash([1, 4]); }
    ctx.strokeStyle = rgba(TH.line, alpha);
    ctx.lineWidth = width;
    ctx.stroke();
    if (dash) { ctx.setLineDash([]); }
  }

  function drawArmillary() {
    var E = emptyK, vis = smooth(E * 1.6), k = smooth(E);
    if (vis < 0.01) { return; }
    var i, j, rg, n = 120, lk = (TH.dark ? 1.2 : 1) * vis;
    var spinOn = reduceMotion ? 0 : 1;

    for (i = 0; i < ARM.length; i++) {
      rg = ARM[i];
      var node = angLerp(rg.nodeF, rg.node + rg.spin * clock * spinOn, k);
      var inc = rg.incF + (rg.inc - rg.incF) * k;
      rg.cr = rg.rF + (rg.r - rg.rF) * k;
      rg.ci = Math.cos(inc); rg.si = Math.sin(inc); rg.cn = Math.cos(node); rg.sn = Math.sin(node);

      ringPts(rg.cr, rg.ci, rg.si, rg.cn, rg.sn, n);
      strokeHalf(n, false, rg.a * 0.38 * lk, 0.6, true);
      strokeHalf(n, true, rg.a * lk, 0.75, false);
      if (rg.dbl) {   /* 有宽度的环：内外两道线 */
        ringPts(rg.cr * (1 + rg.dbl), rg.ci, rg.si, rg.cn, rg.sn, n);
        strokeHalf(n, false, rg.a * 0.22 * lk, 0.5, true);
        strokeHalf(n, true, rg.a * 0.55 * lk, 0.6, false);
      }
      if (rg.tk) {     /* 环上刻度：只刻在朝向观者的半圈 */
        ctx.beginPath();
        for (j = 0; j < rg.tk; j++) {
          var t = j / rg.tk * TAU;
          ringXYZ(rg.cr, rg.ci, rg.si, rg.cn, rg.sn, t, Q3);
          project3(Q3.x, Q3.y, Q3.z, P);
          if (P.z < 0) { continue; }
          ctx.moveTo(P.x, P.y);
          ringXYZ(rg.cr * (1 + (j % 3 === 0 ? 0.075 : 0.04)), rg.ci, rg.si, rg.cn, rg.sn, t, Q3);
          project3(Q3.x, Q3.y, Q3.z, P);
          ctx.lineTo(P.x, P.y);
        }
        ctx.strokeStyle = rgba(TH.line, rg.a * 0.7 * lk);
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
    }

    /* 极轴：垂直于赤道环，贯穿天心，两端一枚小环为“极” */
    var eq = ARM[3], L = 1.22 * k;
    var nx = eq.si * eq.sn, ny = -eq.si * eq.cn, nz = eq.ci;
    project3(-nx * L, -ny * L, -nz * L, P); var ax = P.x, ay = P.y;
    project3(nx * L, ny * L, nz * L, P);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(P.x, P.y);
    ctx.strokeStyle = rgba(TH.line, 0.26 * lk); ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); ctx.arc(P.x, P.y, 2.6, 0, TAU); ctx.moveTo(ax + 2.2, ay); ctx.arc(ax, ay, 2.2, 0, TAU);
    ctx.strokeStyle = rgba(TH.line, 0.4 * lk); ctx.stroke();

    ctx.globalCompositeOperation = TH.blend;

    /* 隐星：一闪即逝，像在底片里慢慢试着显影 */
    for (i = 0; i < LATENT.length; i++) {
      var ls = LATENT[i];
      var ph = ((clock / ls.per) + ls.ph) % 1;
      var v = ph < 0.24 ? Math.sin(ph / 0.24 * Math.PI) : 0;
      if (reduceMotion) { v = 0.35; }
      if (v < 0.02) { continue; }
      project3(ls.x, ls.y, ls.z * k, P);
      var al = v * vis * (0.35 + 0.65 * clamp((P.z + 1) / 2, 0, 1));
      var sz = ls.sz * P.f;
      if (TH.dark) {
        sprite(TH.halo, P.x, P.y, sz * 7, al * 0.35);
        sprite(TH.spike, P.x, P.y, sz * 11, al * 0.6);
        sprite(TH.core, P.x, P.y, sz * 2.6, al);
      } else {
        sprite(TH.spike, P.x, P.y, sz * 10, al * 0.5);
        sprite(TH.haloTight, P.x, P.y, sz * 3.2, al * 0.5);
        sprite(TH.core, P.x, P.y, sz * 2.1, al);
      }
    }

    /* 日行黄道，月行白道 */
    for (i = 0; i < ARM.length; i++) {
      rg = ARM[i];
      if (!rg.bead) { continue; }
      ringXYZ(rg.cr, rg.ci, rg.si, rg.cn, rg.sn, clock * rg.bsp * spinOn + i, Q3);
      project3(Q3.x, Q3.y, Q3.z, P);
      var dk = 0.45 + 0.55 * clamp((P.z + 1) / 2, 0, 1);
      if (rg.bead === 1) {
        if (TH.dark) {
          sprite(TH.halo, P.x, P.y, 22 * P.f, 0.5 * vis * dk);
          sprite(TH.core, P.x, P.y, 6 * P.f, vis * dk);
        } else {
          sprite(TH.haloTight, P.x, P.y, 11 * P.f, 0.55 * vis * dk);
          ctx.globalAlpha = vis * dk;
          ctx.beginPath(); ctx.arc(P.x, P.y, 2.3 * P.f, 0, TAU);
          ctx.fillStyle = '#ffffff'; ctx.fill();
          ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(18,18,20,0.55)'; ctx.stroke();
        }
      } else {
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(P.x, P.y, 2.8 * P.f, 0, TAU);
        ctx.lineWidth = 0.6; ctx.strokeStyle = rgba(TH.line, 0.6 * vis * dk); ctx.stroke();
        sprite(TH.core, P.x, P.y, 2.4 * P.f, 0.7 * vis * dk);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* 天心：一粒极小的光点 */
    project3(0, 0, 0, P);
    ctx.beginPath(); ctx.arc(P.x, P.y, 1.4, 0, TAU);
    ctx.fillStyle = rgba(TH.line, 0.45 * vis); ctx.fill();

    drawSeed(vis);
  }

  /* 此刻星位：地平面上、此刻时辰方位、半径 0.42——第一颗星的落点 */
  function drawSeed(vis) {
    var squash = Math.max(0.3, Math.cos(view.tilt));
    var br = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 0.0012);
    var i, q;

    project(0, 0, 0, P);
    var ox = P.x, oy = P.y;
    project(0.95, nowA, 0, P);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(P.x, P.y);
    ctx.setLineDash([1, 5]);
    ctx.strokeStyle = rgba(TH.line, 0.24 * vis);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.setLineDash([]);

    project(0.42, nowA, 0, P);
    var x = P.x, y = P.y, f = P.f;

    if (!reduceMotion) {
      for (i = 0; i < 2; i++) {
        var p = ((clock / 5200) + i * 0.5) % 1;
        var rad = 9 + p * R * 0.34;
        ctx.beginPath();
        ctx.ellipse(x, y, rad, rad * squash, 0, 0, TAU);
        ctx.strokeStyle = rgba(TH.line, 0.16 * (1 - p) * (1 - p) * vis);
        ctx.stroke();
      }
    }
    var d = 9 * f;
    ctx.beginPath();
    ctx.moveTo(x, y - d * squash); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d * squash); ctx.lineTo(x - d, y);
    ctx.closePath();
    ctx.strokeStyle = rgba(TH.line, (0.32 + 0.16 * br) * vis);
    ctx.stroke();
    var rot = reduceMotion ? 0 : clock * 0.00025;
    ctx.beginPath();
    for (q = 0; q < 4; q++) {
      var a = rot + q * Math.PI / 2 + Math.PI / 4;
      ctx.moveTo(x + Math.cos(a) * 15 * f, y + Math.sin(a) * 15 * f * squash);
      ctx.lineTo(x + Math.cos(a) * 20 * f, y + Math.sin(a) * 20 * f * squash);
    }
    ctx.strokeStyle = rgba(TH.line, 0.24 * vis);
    ctx.stroke();

    ctx.globalCompositeOperation = TH.blend;
    if (TH.dark) {
      sprite(TH.halo, x, y, 30, (0.2 + 0.16 * br) * vis);
      sprite(TH.core, x, y, 5, (0.5 + 0.4 * br) * vis);
    } else {
      sprite(TH.haloTight, x, y, 10, (0.2 + 0.14 * br) * vis);
      sprite(TH.core, x, y, 4.2, vis);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- B8 流星降临 ----------
     一次降临分五幕：
       ① 预兆   流星尚在半途，落点的盘面上已有一圈光环向内收拢，四枚准星合拢
       ② 划空   三层尾迹（宽晕 / 墨或冷光 / 白芯）+ 两缕向后散开的彗丝；
                双重十字星芒反向旋转；沿途剥落碎光，并留下久久闪烁的星尘
       ③ 入轨   缓出曲线，越近越慢；尾迹按时间保留，减速时自然收短
       ④ 落定   一次光爆；十二道放射光芒；盘面上三圈先后漾开的冲击环（透视正确，贴着盘面）；
                碎光向上溅起再落下；镜头轻轻一推；落点时辰的刻字骤亮
       ⑤ 归位   两粒光沿这颗星的轨道反向绕行，在对侧相会一闪；
                星由模糊显影；星轨从上一颗星生长过来，一粒光珠领着线头 */
  var TAIL_MS = 680;

  function launchMeteor(star, delay) {
    METEORS.push({ star: star, t: -(delay || 0), dur: 2500, started: false, landed: false,
      pts: [], sx: 0, sy: 0, emit: 0, dust: 0, rot: Math.random() * TAU, hx: 0, hy: 0, he: 0 });
  }

  function spriteRot(img, x, y, size, alpha, rot) {
    alpha *= alphaMul;
    if (alpha <= 0.004 || size < 0.5) { return; }
    ctx.save();
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /* 盘面上的圆（以盘面坐标 cx, cy 为心），用于预兆与冲击环 */
  function discCircle(cx, cy, rho) {
    var i, n = 44;
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      var t = i / n * TAU;
      project3(cx + Math.cos(t) * rho, cy + Math.sin(t) * rho, 0, P);
      if (i === 0) { ctx.moveTo(P.x, P.y); } else { ctx.lineTo(P.x, P.y); }
    }
  }

  function landMeteor(m) {
    var s = m.star, i;
    m.landed = true;
    s.devOn = true;
    if (reduceMotion) { s.dev = 1; }
    IMPACTS.push({ s: s, t: 0 });
    labelFlare[shichenIdx(s.sess.startedAt)] = 1;
    cam.kick = 1;
    if (!reduceMotion) {
      var sq = Math.max(0.3, Math.cos(view.tilt));
      for (i = 0; i < 26; i++) {
        var a = i / 26 * TAU + Math.random() * 0.25, v = 0.04 + Math.random() * 0.1;
        SPARKS.push({ x: s.px, y: s.py, vx: Math.cos(a) * v, vy: Math.sin(a) * v * sq, g: 0, age: 0, life: 700 + Math.random() * 700, sz: 1.8 + Math.random() * 2.6 });
      }
      for (i = 0; i < 16; i++) {   /* 向上溅起、再缓缓落下的碎光 */
        SPARKS.push({ x: s.px, y: s.py, vx: (Math.random() - 0.5) * 0.14, vy: -(0.07 + Math.random() * 0.15), g: 0.00026, age: 0, life: 1100 + Math.random() * 700, sz: 1.4 + Math.random() * 2 });
      }
    }
    showToast(s.sess);
  }

  function drawOmen(s, q) {
    var cx = Math.cos(s.a) * s.r, cy = Math.sin(s.a) * s.r, j;
    var rho = 0.045 + 0.22 * (1 - q) * (1 - q);
    var al = smooth(q * 1.4);
    discCircle(cx, cy, rho);
    ctx.strokeStyle = rgba(TH.line, 0.38 * al); ctx.lineWidth = 0.7; ctx.stroke();
    discCircle(cx, cy, rho * 0.55);
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = rgba(TH.line, 0.24 * al); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (j = 0; j < 4; j++) {
      var a = j * Math.PI / 2 + Math.PI / 4 + q * 0.9;
      project3(cx + Math.cos(a) * rho * 1.25, cy + Math.sin(a) * rho * 1.25, 0, P); ctx.moveTo(P.x, P.y);
      project3(cx + Math.cos(a) * rho * 1.7, cy + Math.sin(a) * rho * 1.7, 0, P); ctx.lineTo(P.x, P.y);
    }
    ctx.strokeStyle = rgba(TH.line, 0.42 * al); ctx.stroke();
  }

  function drawTail(m) {
    var pts = m.pts, n = pts.length, i, L, side;
    if (n < 2) { return; }
    var layers = TH.dark
      ? [[10, 0.06, TH.tail], [4, 0.2, TH.tail], [1.4, 0.95, '255,255,255']]
      : [[8, 0.05, '18,18,20'], [3.2, 0.4, '18,18,20'], [1.15, 0.95, '255,255,255']];
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = TH.blend;
    for (L = 0; L < 3; L++) {
      var ly = layers[L];
      for (i = 1; i < n; i++) {
        var k = 1 - (clock - pts[i].t) / TAIL_MS;
        if (k <= 0) { continue; }
        var dry = (TH.dark || L === 2) ? 1 : 0.7 + 0.3 * Math.sin(i * 1.9);   /* 墨的飞白 */
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = rgba(ly[2], ly[1] * k * k * dry);
        ctx.lineWidth = ly[0] * (0.2 + 0.8 * k);
        ctx.stroke();
      }
    }
    /* 彗丝：两缕越往后散得越开的细线 */
    var strand = TH.dark ? TH.tail : '18,18,20';
    for (side = -1; side <= 1; side += 2) {
      for (i = 1; i < n; i++) {
        var k1 = 1 - (clock - pts[i].t) / TAIL_MS, k0 = 1 - (clock - pts[i - 1].t) / TAIL_MS;
        if (k1 <= 0) { continue; }
        var o0 = side * (1 - k0) * (1 - k0) * 18, o1 = side * (1 - k1) * (1 - k1) * 18;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x + pts[i - 1].nx * o0, pts[i - 1].y + pts[i - 1].ny * o0);
        ctx.lineTo(pts[i].x + pts[i].nx * o1, pts[i].y + pts[i].ny * o1);
        ctx.strokeStyle = rgba(strand, (TH.dark ? 0.32 : 0.22) * k1);
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawHead(m) {
    var x = m.hx, y = m.hy, hs = 1 - 0.4 * m.he;
    var r1 = m.rot + clock * 0.0016, r2 = -clock * 0.0024 + Math.PI / 4;
    ctx.globalCompositeOperation = TH.blend;
    if (TH.dark) {
      sprite(TH.halo, x, y, 92 * hs, 0.38);
      sprite(TH.halo, x, y, 36 * hs, 0.7);
      spriteRot(TH.spike, x, y, 58 * hs, 0.9, r1);
      spriteRot(TH.spike, x, y, 30 * hs, 0.55, r2);
      sprite(TH.core, x, y, 12 * hs, 1);
    } else {
      sprite(TH.halo, x, y, 58 * hs, 0.13);
      sprite(TH.haloTight, x, y, 20 * hs, 0.6);
      spriteRot(TH.spike, x, y, 48 * hs, 0.62, r1);
      spriteRot(TH.spike, x, y, 24 * hs, 0.4, r2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!TH.dark) {
      ctx.beginPath(); ctx.arc(x, y, 3.2 * hs, 0, TAU);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(18,18,20,0.55)'; ctx.stroke();
    }
  }

  function drawMeteors(dt) {
    var i;
    mh.on = false;
    for (i = METEORS.length - 1; i >= 0; i--) {
      var m = METEORS[i], s = m.star;
      m.t += dt;
      if (m.t < 0) { continue; }
      if (!m.started) {
        m.started = true;
        if (reduceMotion) { landMeteor(m); METEORS.splice(i, 1); continue; }
        var side = s.px >= CX ? 1 : -1;
        if (Math.random() < 0.3) { side = -side; }
        m.sx = clamp(s.px + side * (W * 0.45 + 110 + Math.random() * 80), -100, W + 100);
        m.sy = -60 - Math.random() * 40;
      }
      var tx = s.px, ty = s.py;
      var cx = m.sx * 0.3 + tx * 0.7, cy = m.sy * 0.12 + ty * 0.88 - 30;

      if (!m.landed) {
        var p = Math.min(1, m.t / m.dur);
        var e = 1 - Math.pow(1 - p, 2.8);
        if (p > 0.28) { drawOmen(s, (p - 0.28) / 0.72); }
        var u = 1 - e;
        var hx = u * u * m.sx + 2 * u * e * cx + e * e * tx;
        var hy = u * u * m.sy + 2 * u * e * cy + e * e * ty;
        var last = m.pts[m.pts.length - 1], nx = 0, ny = 1;
        if (last) {
          var dx = hx - last.x, dy = hy - last.y, dd = Math.sqrt(dx * dx + dy * dy);
          if (dd > 0.01) { nx = -dy / dd; ny = dx / dd; } else { nx = last.nx; ny = last.ny; }
        }
        m.pts.push({ x: hx, y: hy, t: clock, nx: nx, ny: ny });
        mh.x = hx; mh.y = hy; mh.on = true;
        m.hx = hx; m.hy = hy; m.he = e;

        m.emit += dt * (1 - e * 0.7);
        while (m.emit > 22) {
          m.emit -= 22;
          SPARKS.push({ x: hx + (Math.random() - 0.5) * 4, y: hy + (Math.random() - 0.5) * 4, vx: (Math.random() - 0.5) * 0.05, vy: 0.01 + Math.random() * 0.03, g: 0.00004, age: 0, life: 400 + Math.random() * 500, sz: 1.3 + Math.random() * 1.8 });
        }
        m.dust += dt;
        while (m.dust > 38) {
          m.dust -= 38;
          DUST.push({ x: hx + (Math.random() - 0.5) * 12, y: hy + (Math.random() - 0.5) * 12, vx: (Math.random() - 0.5) * 0.006, vy: 0.003 + Math.random() * 0.006, age: 0, life: 1700 + Math.random() * 1500, sz: 0.9 + Math.random() * 1.7, ph: Math.random() * TAU });
        }
        if (p >= 1) { landMeteor(m); }
      }

      while (m.pts.length && clock - m.pts[0].t > TAIL_MS) { m.pts.shift(); }
      drawTail(m);
      if (!m.landed) { drawHead(m); }
      if (m.landed && m.pts.length < 2) { METEORS.splice(i, 1); }
    }
  }

  function drawImpacts(dt) {
    var i, j, q, e;
    var sq = Math.max(0.3, Math.cos(view.tilt));
    for (i = IMPACTS.length - 1; i >= 0; i--) {
      var im = IMPACTS[i], s = im.s;
      im.t += dt;
      var t = im.t;
      if (t > 2600) { IMPACTS.splice(i, 1); continue; }
      var x = s.px, y = s.py;
      var cx = Math.cos(s.a) * s.r, cy = Math.sin(s.a) * s.r;

      /* ④ 光爆 */
      if (t < 720) {
        q = t / 720;
        var fa = (1 - q) * (1 - q);
        ctx.globalCompositeOperation = TH.blend;
        if (TH.dark) {
          sprite(TH.halo, x, y, R * (0.5 + 0.8 * q), fa * 0.55);
          sprite(TH.core, x, y, 34 * (1 - q * 0.6), fa);
        } else {
          sprite(TH.halo, x, y, R * (0.4 + 0.6 * q), fa * 0.2);
          sprite(TH.core, x, y, 28 * (1 - q * 0.5), fa);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      /* 放射光芒：长短相间的十二道 */
      if (t < 1050) {
        q = t / 1050;
        e = 1 - Math.pow(1 - q, 3);
        ctx.beginPath();
        for (j = 0; j < 12; j++) {
          var a = s.ph + j / 12 * TAU, lg = j % 3 === 0 ? 1 : 0.5;
          var r0 = 8 + 28 * e, r1 = r0 + (14 + 78 * e) * lg * (1 - q * 0.5);
          ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * sq);
          ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 * sq);
        }
        ctx.strokeStyle = rgba(TH.line, (TH.dark ? 0.5 : 0.4) * (1 - q));
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      /* 盘面冲击环：贴着盘面透视展开，三圈先后 */
      var specs = [[0, 1500, 0.34, 0.5], [170, 1700, 0.22, 0.34], [400, 2100, 0.52, 0.22]];
      for (j = 0; j < specs.length; j++) {
        var sp = specs[j], d = t - sp[0];
        if (d < 0 || d > sp[1]) { continue; }
        q = d / sp[1];
        e = 1 - Math.pow(1 - q, 3);
        discCircle(cx, cy, 0.015 + sp[2] * e);
        ctx.strokeStyle = rgba(TH.line, sp[3] * (1 - q) * (TH.dark ? 1.1 : 0.9));
        ctx.lineWidth = 0.3 + 0.8 * (1 - q);
        ctx.stroke();
      }

      /* ⑤ 归位：两粒光沿本星轨道反向绕行，在对侧相会 */
      var od = t - 260;
      if (od > 0 && od < 2000) {
        q = od / 2000;
        e = smooth(q);
        var head = Math.PI * e, dir, kk;
        var fade = Math.min(1, (1 - q) * 4) * Math.min(1, q * 8);
        for (dir = -1; dir <= 1; dir += 2) {
          var prevX = 0, prevY = 0;
          for (kk = 0; kk <= 22; kk++) {
            var back = head - kk / 22 * 0.8;
            if (back < 0) { break; }
            var an = s.a + dir * back;
            project3(Math.cos(an) * s.r, Math.sin(an) * s.r, 0, P);
            if (kk > 0) {
              ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(P.x, P.y);
              ctx.strokeStyle = rgba(TH.line, (TH.dark ? 0.6 : 0.5) * (1 - kk / 22) * fade);
              ctx.lineWidth = 1.1 * (1 - kk / 22) + 0.3;
              ctx.stroke();
            } else {
              ctx.globalCompositeOperation = TH.blend;
              sprite(TH.haloWarm, P.x, P.y, 16, (TH.dark ? 0.5 : 0.3) * fade);
              sprite(TH.coreWarm, P.x, P.y, 5.5, fade);
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
            }
            prevX = P.x; prevY = P.y;
          }
        }
        var meet = Math.sin(clamp((q - 0.8) / 0.2, 0, 1) * Math.PI);
        if (meet > 0.01) {
          project3(Math.cos(s.a + Math.PI) * s.r, Math.sin(s.a + Math.PI) * s.r, 0, P);
          ctx.globalCompositeOperation = TH.blend;
          sprite(TH.spikeWarm, P.x, P.y, 34, meet * (TH.dark ? 0.9 : 0.6));
          sprite(TH.core, P.x, P.y, 7, meet);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
  }

  function drawSparks(dt) {
    var i;
    if (!SPARKS.length) { return; }
    ctx.globalCompositeOperation = TH.blend;
    for (i = SPARKS.length - 1; i >= 0; i--) {
      var p = SPARKS[i];
      p.age += dt;
      if (p.age >= p.life) { SPARKS.splice(i, 1); continue; }
      var k = p.age / p.life;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-dt / 700);
      var al = (1 - k) * (1 - k);
      if (TH.dark) {
        sprite(TH.halo, p.x, p.y, p.sz * 4, al * 0.4);
        sprite(TH.core, p.x, p.y, p.sz * 1.4, al);
      } else {
        sprite(TH.haloTight, p.x, p.y, p.sz * 2.4, al * 0.5);
        sprite(TH.core, p.x, p.y, p.sz * 1.3, al);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 流星留下的星尘：比碎光活得久，一明一灭地闪着，慢慢沉下去 */
  function drawDust(dt) {
    var i;
    if (!DUST.length) { return; }
    ctx.globalCompositeOperation = TH.blend;
    for (i = DUST.length - 1; i >= 0; i--) {
      var p = DUST[i];
      p.age += dt;
      if (p.age >= p.life) { DUST.splice(i, 1); continue; }
      var k = p.age / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      var tw = reduceMotion ? 0.8 : 0.5 + 0.5 * Math.sin(p.age * 0.012 + p.ph);
      var al = Math.pow(1 - k, 1.5) * tw;
      if (TH.dark) {
        sprite(TH.halo, p.x, p.y, p.sz * 5, al * 0.3);
        if (p.sz > 2.2) { sprite(TH.spike, p.x, p.y, p.sz * 7, al * 0.5); }
        sprite(TH.core, p.x, p.y, p.sz * 1.6, al);
      } else {
        if (p.sz > 2.2) { sprite(TH.spike, p.x, p.y, p.sz * 6, al * 0.45); }
        sprite(TH.haloTight, p.x, p.y, p.sz * 2.6, al * 0.45);
        sprite(TH.core, p.x, p.y, p.sz * 1.4, al);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- B8.5 有星状态的华彩 ----------
     · 银河：一条弯曲穿过盘面的光带，预渲染成纹理后随星盘仿射旋转（几乎零开销）
         深色：冷光微尘 + 被暗尘带切开的星河
         浅色：「留白之河」——两岸淡墨云，河心留白，白色细光点，不出现墨点灰尘
     · 外缘天盘：二十八宿按古度不等分，宿名嵌在双环之间，随天缓缓逆旋
     · 时光之流：一粒光沿星轨从最早一颗走到最新一颗，途经的星轻轻一亮
     · 最近一颗星：在盘面上定时漾开一圈细环
     · 星名签：悬停 / 选中时引出一道折线标签
     · 背景偶有一道极短的小流星划过（不落地，只是天空在动） */
  function makeMilkyWay(dark) {
    var S = 640, c = doc.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d'), rng = mulberry(777), i;
    var K = S / 2.4;
    function band(x) { return 0.3 * Math.sin(x * 1.6 + 0.5) + 0.04; }
    function gauss() { return (rng() + rng() + rng() - 1.5) / 1.5; }
    function blob(x, y, r, col, a) {
      var px = S / 2 + x * K, py = S / 2 + y * K, rr = r * K;
      var gr = g.createRadialGradient(px, py, 0, px, py, rr);
      gr.addColorStop(0, 'rgba(' + col + ',' + a + ')');
      gr.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = gr;
      g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
    }
    var x, y, off, a;
    if (dark) {
      for (i = 0; i < 110; i++) {
        x = -1.15 + rng() * 2.3; y = band(x) + gauss() * 0.08;
        blob(x, y, 0.07 + rng() * 0.12, '150,170,215', 0.02 + rng() * 0.028);
      }
      g.globalCompositeOperation = 'destination-out';   /* 暗尘带 */
      for (i = 0; i < 30; i++) {
        x = -1.1 + rng() * 2.2; y = band(x) + 0.015 + gauss() * 0.03;
        blob(x, y, 0.035 + rng() * 0.06, '0,0,0', 0.55);
      }
      g.globalCompositeOperation = 'source-over';
      for (i = 0; i < 1600; i++) {
        x = -1.15 + rng() * 2.3; off = gauss() * 0.13; y = band(x) + off;
        a = (0.12 + rng() * 0.6) * Math.exp(-off * off / 0.008);
        g.fillStyle = 'rgba(228,234,255,' + a.toFixed(3) + ')';
        var sz = rng() < 0.93 ? 0.9 : 1.6;
        g.fillRect(S / 2 + x * K, S / 2 + y * K, sz, sz);
      }
    } else {
      for (i = 0; i < 120; i++) {   /* 两岸淡墨云 */
        x = -1.15 + rng() * 2.3;
        y = band(x) + (rng() < 0.5 ? -1 : 1) * (0.09 + rng() * 0.1);
        blob(x, y, 0.06 + rng() * 0.11, '24,26,32', 0.008 + rng() * 0.012);
      }
      for (i = 0; i < 70; i++) {    /* 河心留白 */
        x = -1.15 + rng() * 2.3; y = band(x) + gauss() * 0.04;
        blob(x, y, 0.06 + rng() * 0.1, '255,255,255', 0.2 + rng() * 0.2);
      }
      for (i = 0; i < 520; i++) {   /* 白色细光点 */
        x = -1.15 + rng() * 2.3; off = gauss() * 0.22; y = band(x) + off;
        a = (0.4 + rng() * 0.6) * Math.exp(-off * off / 0.03);
        g.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        g.fillRect(S / 2 + x * K, S / 2 + y * K, 1.3, 1.3);
      }
    }
    /* 圆形柔和遮罩：只留在盘内，向盘缘渐隐 */
    g.globalCompositeOperation = 'destination-in';
    var m = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 1.1 * K);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(0.7, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, S, S);
    return { c: c, K: K, S: S };
  }

  function drawMilkyWay() {
    var k = (1 - emptyK) * introAt(100, 1800);
    if (!MW || k < 0.01) { return; }
    project3(0, 0, 0, P);
    var sx = R * cam.z / MW.K, sy = sx * Math.cos(view.tilt);
    ctx.save();
    ctx.translate(P.x, P.y);
    ctx.scale(sx, sy);
    ctx.rotate(view.rot);
    ctx.globalAlpha = k * 0.85;
    ctx.globalCompositeOperation = TH.blend;
    ctx.drawImage(MW.c, -MW.S / 2, -MW.S / 2);
    ctx.restore();
  }

  /* 外缘天盘：二十八宿 */
  function drawRim(dialK) {
    if (dialK < 0.01) { return; }
    var rete = -Math.PI / 2 - (reduceMotion ? 0 : clock * 0.000009);
    var acc = 0, xi, a0;
    strokePts(RIM_OUT, 0.12 * dialK, 0.55);
    ctx.beginPath();
    for (xi = 0; xi < XIU.length; xi++) {
      a0 = rete + acc / 365.25 * TAU;
      project(1, a0, 0, P); ctx.moveTo(P.x, P.y);
      project(1.075, a0, 0, P); ctx.lineTo(P.x, P.y);
      acc += XIU[xi][1];
    }
    ctx.strokeStyle = rgba(TH.line, 0.17 * dialK); ctx.lineWidth = 0.5; ctx.stroke();
    tickPath(120, 1.075, 1.088, -Math.PI / 2);
    ctx.strokeStyle = rgba(TH.line, 0.1 * dialK); ctx.stroke();
    tickPath(24, 1.075, 1.102, -Math.PI / 2);
    ctx.strokeStyle = rgba(TH.line, 0.16 * dialK); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    acc = 0;
    for (xi = 0; xi < XIU.length; xi++) {
      var w = XIU[xi][1];
      if (w >= 3) {
        project(1.038, rete + (acc + w / 2) / 365.25 * TAU, 0, P);
        var depth = clamp((P.z + 1) / 2, 0, 1);
        ctx.font = '300 ' + (7 * P.f).toFixed(1) + 'px PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, sans-serif';
        ctx.fillStyle = rgba(TH.line, (0.06 + 0.24 * depth) * dialK);
        ctx.fillText(XIU[xi][0], P.x, P.y);
      }
      acc += w;
    }
  }

  function drawFlow() {
    var N = ST.length, i, k;
    if (N < 2 || sel >= 0 || introT >= 0 || emptyK > 0.05 || reduceMotion) { return; }
    for (i = 0; i < N; i++) { if (ST[i].dev < 1) { return; } }
    var cyc = clock % 15000;
    if (cyc > 9500) { return; }
    var g = cyc / 9500 * (N - 1), si = Math.min(N - 2, Math.floor(g)), t = g - si;
    var fade = Math.min(1, cyc / 700, (9500 - cyc) / 700);
    var near = Math.round(g);
    if (Math.abs(g - near) < 0.06) { ST[near].flick = 1; }
    trailCurve(si, CV);
    ctx.globalCompositeOperation = TH.blend;
    for (k = 7; k >= 0; k--) {
      var tt = t - k * 0.045;
      if (tt < 0) { continue; }
      var u = 1 - tt;
      var bx = u * u * CV.x0 + 2 * u * tt * CV.cx + tt * tt * CV.x1;
      var by = u * u * CV.y0 + 2 * u * tt * CV.cy + tt * tt * CV.y1;
      var f2 = (1 - k / 8) * fade;
      if (k === 0) {
        sprite(TH.haloWarm, bx, by, 15, f2 * (TH.dark ? 0.5 : 0.3));
        sprite(TH.coreWarm, bx, by, 4.5, f2);
      } else {
        sprite(TH.haloWarm, bx, by, 7 * (1 - k / 10), f2 * (TH.dark ? 0.35 : 0.22));
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawNewestPulse() {
    var N = ST.length;
    if (!N || reduceMotion || introT >= 0) { return; }
    var s = ST[N - 1];
    if (s.dev < 1) { return; }
    var q = (clock % 3800) / 2600;
    if (q >= 1) { return; }
    var e = 1 - Math.pow(1 - q, 2.5);
    discCircle(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, 0.02 + 0.12 * e);
    ctx.strokeStyle = rgba(TH.line, 0.3 * (1 - q) * (1 - emptyK));
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  var TAG_FONT = 'px PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, sans-serif';
  function drawTag(s) {
    var a = Math.max(s.hov, s.heat * 0.85);
    if (a < 0.02 || s.dev < 1) { return; }
    var dir = s.px > W - 140 ? -1 : 1;
    var off = 6 + s.size * s.pf * 1.6 + s.heat * (s.size * s.pf * 3.6 + 14);   /* 选中时避开准星环 */
    var x0 = s.px + dir * off * 0.7, y0 = s.py - off * 0.7;
    var x1 = x0 + dir * 14, y1 = y0 - 14, x2 = x1 + dir * 34;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y1);
    ctx.strokeStyle = rgba(TH.line, 0.4 * a);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.textAlign = dir > 0 ? 'left' : 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '300 11' + TAG_FONT;
    ctx.fillStyle = rgba(TH.line, 0.85 * a);
    ctx.fillText('No.' + s.sess.no, x1 + dir * 2, y1 - 5);
    ctx.font = '300 9.5' + TAG_FONT;
    ctx.fillStyle = rgba(TH.line, 0.5 * a);
    ctx.fillText(shichenOf(s.sess.startedAt) + '  ' + (s.sess.msgCount || 0) + ' 段', x1 + dir * 2, y1 + 12);
  }

  function drawAmbient(dt) {
    if (!reduceMotion && !emptyMode && introT < 0 && !METEORS.length) {
      ambNext -= dt;
      if (ambNext <= 0) {
        ambNext = 8000 + Math.random() * 9000;
        var dir = Math.random() < 0.5 ? 1 : -1, ang = 0.35 + Math.random() * 0.3;
        AMB.push({ x: W * (0.15 + Math.random() * 0.7), y: H * (0.1 + Math.random() * 0.22),
          dx: Math.cos(ang) * dir, dy: Math.sin(ang), len: 90 + Math.random() * 80, t: 0, dur: 850 + Math.random() * 300 });
      }
    }
    var i;
    for (i = AMB.length - 1; i >= 0; i--) {
      var m = AMB[i];
      m.t += dt;
      var p = m.t / m.dur;
      if (p >= 1) { AMB.splice(i, 1); continue; }
      var e = 1 - Math.pow(1 - p, 2);
      var hx = m.x + m.dx * m.len * e, hy = m.y + m.dy * m.len * e;
      var tl = m.len * 0.45 * (1 - p * 0.5), tx = hx - m.dx * tl, ty = hy - m.dy * tl;
      var al = Math.sin(p * Math.PI);
      var col = TH.dark ? '220,230,255' : '18,18,20';
      var g = ctx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(1, rgba(col, (TH.dark ? 0.7 : 0.42) * al));
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
      ctx.strokeStyle = g; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.globalCompositeOperation = TH.blend;
      sprite(TH.dark ? TH.halo : TH.haloTight, hx, hy, TH.dark ? 14 : 7, al * 0.5);
      sprite(TH.core, hx, hy, 3.5, al);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function showToast(sess) {
    if (!refs.toast) { return; }
    refs.toastV.textContent = 'No.' + sess.no + '　' + shichenOf(sess.startedAt);
    refs.toast.classList.add('on');
    refs.cnt.classList.add('lit');
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(function () {
      refs.toast.classList.remove('on');
      refs.cnt.classList.remove('lit');
    }, 3400);
  }

  /* ---------- B9 动效与帧循环 ---------- */
  function addRipple(x, y, strong, delay) {
    if (reduceMotion && !strong) { return; }
    RIPS.push({ x: x, y: y, t: -(delay || 0), dur: strong ? 1500 : 1200, max: strong ? 90 : 46, a: strong ? 0.32 : 0.16 });
    if (RIPS.length > 14) { RIPS.shift(); }
  }

  function drawRipples(dt) {
    var squash = Math.max(0.3, Math.cos(view.tilt)), i;
    for (i = RIPS.length - 1; i >= 0; i--) {
      var r = RIPS[i];
      r.t += dt;
      if (r.t < 0) { continue; }
      var p = r.t / r.dur;
      if (p >= 1) { RIPS.splice(i, 1); continue; }
      var ease = 1 - Math.pow(1 - p, 3);
      var rad = 4 + r.max * ease;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rad, rad * squash, 0, 0, TAU);
      ctx.strokeStyle = rgba(TH.line, r.a * (1 - p) * (TH.dark ? 1.1 : 0.9));
      ctx.lineWidth = 0.7;
      ctx.stroke();
      if (p < 0.5) {
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rad * 0.55, rad * 0.55 * squash, 0, 0, TAU);
        ctx.strokeStyle = rgba(TH.line, r.a * 0.5 * (1 - p * 2));
        ctx.stroke();
      }
    }
  }

  function spawnMotes(n, spread) {
    var i;
    for (i = 0; i < n; i++) {
      MOTES.push({ ang: Math.random() * TAU, d0: spread * (0.5 + Math.random() * 0.8), t: -Math.random() * 400,
        dur: 900 + Math.random() * 700, sz: 2 + Math.random() * 3, swirl: 0.8 + Math.random() * 1.2 });
    }
  }

  function drawMotes(dt) {
    if (sel < 0) { MOTES.length = 0; return; }
    if (!reduceMotion) {
      moteTimer += dt;
      if (moteTimer > 260) { moteTimer = 0; spawnMotes(1, 60); }
    }
    var s = ST[sel], i;
    ctx.globalCompositeOperation = TH.blend;
    for (i = MOTES.length - 1; i >= 0; i--) {
      var m = MOTES[i];
      m.t += dt;
      if (m.t < 0) { continue; }
      var p = m.t / m.dur;
      if (p >= 1) { MOTES.splice(i, 1); continue; }
      var e = p * p * (3 - 2 * p);
      var d = m.d0 * (1 - e), a = m.ang + e * m.swirl;
      var x = s.px + Math.cos(a) * d, y = s.py + Math.sin(a) * d;
      var al = Math.sin(p * Math.PI);
      sprite(TH.haloWarm, x, y, m.sz * 3, al * (TH.dark ? 0.35 : 0.22));
      sprite(TH.coreWarm, x, y, m.sz, al * 0.9);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function physics(dt) {
    if (!view.dragging) {
      view.rot += view.vel * dt;
      view.vel *= Math.exp(-dt / 900);
      if (sel < 0 && !reduceMotion) { view.rot += AUTO_SPIN * dt; }
      var acc = -(view.tilt - T_REST) * 0.000032 - view.tiltV * 0.0092;
      view.tiltV += acc * dt;
      view.tilt += view.tiltV * dt;
    }
  }

  function updateHover() {
    var h = -1;
    if (pointer.inside && !pointer.touch && !view.dragging) { h = hitTest(pointer.x, pointer.y, 26); }
    hover = h;
    refs.canvas.style.cursor = view.dragging ? 'grabbing' : (hover >= 0 ? 'pointer' : 'grab');
  }

  function refreshNow(force) {
    if (!force && clock - nowTick < 20000) { return; }
    nowTick = clock;
    var t = Date.now();
    nowA = hourAngle(t);
    nowIdx = shichenIdx(t);
    if (refs.now) { refs.now.lastChild.nodeValue = '此刻 · ' + SHICHEN[nowIdx] + '时方位'; }
  }

  function frame(ts) {
    if (!running) { return; }
    var dt = lastTs ? Math.min(ts - lastTs, 50) : 16;
    lastTs = ts;
    clock += dt;
    if (introT >= 0) { introT += dt; if (introT > INTRO_MS) { introT = -1; } }

    refreshNow(false);
    physics(dt);
    var le = 1 - Math.exp(-dt / 560);
    CY += (CY_T - CY) * le; R += (R_T - R) * le; DIST = R * 3.4;
    emptyK += ((emptyMode ? 1 : 0) - emptyK) * (1 - Math.exp(-dt / 800));
    var fd = Math.exp(-dt / 1100), li;
    for (li = 0; li < 12; li++) { labelFlare[li] *= fd; }
    updateCamera(dt);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawMilkyWay();
    drawDial();
    drawField(dt);
    if (emptyK > 0.01) { drawArmillary(); }
    if (ST.length) { drawSessions(dt); }
    drawImpacts(dt);
    drawDust(dt);
    drawMeteors(dt);
    drawSparks(dt);
    drawAmbient(dt);
    drawMotes(dt);
    drawRipples(dt);
    updateHover();

    rafId = win.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (running) { return; }
    running = true; lastTs = 0;
    rafId = win.requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (rafId) { win.cancelAnimationFrame(rafId); rafId = 0; }
  }

  /* ---------- B10 交互 ---------- */
  function hitTest(x, y, radius) {
    var best = -1, bd = radius, i;
    for (i = 0; i < ST.length; i++) {
      if (ST[i].dev < 0.6) { continue; }   /* 尚未显影的星不可点选 */
      var dx = ST[i].px - x, dy = ST[i].py - y;
      var d = Math.sqrt(dx * dx + dy * dy) - ST[i].size * ST[i].pf * 0.5;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function hideHint() { if (refs.hint) { refs.hint.classList.add('gone'); } }

  function bindInteractions() {
    var cv = refs.canvas;
    var drag = { on: false, x: 0, y: 0, lt: 0, moved: 0, touch: false, id: null };

    function down(x, y, touch) {
      drag.on = true; drag.x = x; drag.y = y; drag.lt = nowMs(); drag.moved = 0; drag.touch = touch;
      view.vel = 0; view.dragging = true; view.tiltV = 0;
      pointer.x = x; pointer.y = y; pointer.inside = true; pointer.touch = touch;
    }
    function move(x, y, touch) {
      var mdx = x - pointer.x, mdy = y - pointer.y;
      pointer.x = x; pointer.y = y; pointer.inside = true; pointer.touch = touch;
      pointer.acc += Math.sqrt(mdx * mdx + mdy * mdy);
      if (pointer.acc > 90 && clock - pointer.lastRip > 160) {
        pointer.acc = 0; pointer.lastRip = clock; addRipple(x, y, false);
      }
      if (!drag.on) { return; }
      var dx = x - drag.x, dy = y - drag.y, t = nowMs(), dtm = Math.max(8, t - drag.lt);
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 8) { hideHint(); cam.follow = false; }
      var dr = -dx / R * 1.05;
      view.rot += dr;
      view.vel = view.vel * 0.55 + (dr / dtm) * 0.45;
      var nt = view.tilt + dy * 0.0042;
      if (nt < T_MIN || nt > T_MAX) { nt = view.tilt + dy * 0.0012; }
      view.tilt = clamp(nt, T_MIN - 0.12, T_MAX + 0.1);
      drag.x = x; drag.y = y; drag.lt = t;
    }
    function up(x, y) {
      if (!drag.on) { return; }
      drag.on = false; view.dragging = false;
      if (nowMs() - drag.lt > 90) { view.vel = 0; }
      view.vel = clamp(view.vel, -0.006, 0.006);
      if (drag.moved < 8) { tap(x, y, drag.touch); }
      if (drag.touch) { pointer.inside = false; }
    }

    if (win.PointerEvent) {
      cv.addEventListener('pointerdown', function (e) {
        if (e.button > 0) { return; }
        drag.id = e.pointerId;
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        down(e.clientX, e.clientY, e.pointerType !== 'mouse');
      });
      cv.addEventListener('pointermove', function (e) {
        if (drag.on && e.pointerId !== drag.id) { return; }
        move(e.clientX, e.clientY, e.pointerType !== 'mouse');
      });
      cv.addEventListener('pointerup', function (e) { up(e.clientX, e.clientY); });
      cv.addEventListener('pointercancel', function () { drag.on = false; view.dragging = false; pointer.inside = false; });
      cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !drag.on) { pointer.inside = false; } });
    } else {
      cv.addEventListener('touchstart', function (e) { var t = e.touches[0]; down(t.clientX, t.clientY, true); e.preventDefault(); }, { passive: false });
      cv.addEventListener('touchmove', function (e) { var t = e.touches[0]; move(t.clientX, t.clientY, true); e.preventDefault(); }, { passive: false });
      cv.addEventListener('touchend', function (e) { var t = e.changedTouches[0]; up(t.clientX, t.clientY); });
      cv.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY, false); });
      win.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY, false); });
      win.addEventListener('mouseup', function (e) { up(e.clientX, e.clientY); });
    }

    cv.addEventListener('keydown', function (e) {
      var k = e.key;
      if (!ST.length) { return; }
      if (k === 'ArrowRight' || k === 'ArrowLeft') {
        var base = sel >= 0 ? sel : ST.length - 1;
        var nx = sel < 0 ? base : (base + (k === 'ArrowRight' ? 1 : -1) + ST.length) % ST.length;
        selectSession(nx);
        e.preventDefault();
      } else if (k === 'Enter' && sel >= 0) {
        openView();
      } else if (k === 'Escape') {
        closeCard();
      }
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && refs.ovSession && !refs.ovSession.hidden) { closeOverlay(); }
    });
  }

  function tap(x, y, touch) {
    var idx = hitTest(x, y, touch ? 40 : 28);
    if (idx >= 0) {
      selectSession(idx);
    } else {
      addRipple(x, y, true);
      if (sel >= 0) { closeCard(); }
    }
  }

  /* ---------- B11 卡片与全篇 / 回放 ---------- */
  function selectSession(idx) {
    var fresh = idx !== sel;
    sel = idx;
    cam.follow = true;
    view.vel = 0;
    var s = ST[idx];
    curSess = s.sess;
    if (fresh) {
      MOTES.length = 0;
      spawnMotes(reduceMotion ? 0 : 26, 110);
      addRipple(s.px, s.py, true);
    }
    refs.cno.textContent = curSess.no;
    refs.meta.textContent = formatDate(curSess.startedAt);
    refs.meta.appendChild(el('span', 'sc', shichenOf(curSess.startedAt)));
    refs.msg.textContent = '共 ' + (curSess.msgCount || 0) + ' 段';
    var mins = curSess.endedAt ? Math.max(1, Math.round((curSess.endedAt - curSess.startedAt) / 60000)) : 0;
    refs.dur.textContent = mins ? '历时 ' + mins + ' 分' : '时长未知';
    refs.deck.textContent = curSess.decks ? (Array.isArray(curSess.decks) ? curSess.decks.join('、') : curSess.decks) : '字卡';
    var card = refs.card;
    card.hidden = false;
    void card.offsetHeight;
    card.classList.add('on');
    refs.foot.classList.add('off');
  }

  function closeCard() {
    sel = -1;
    cam.follow = false;
    var card = refs.card;
    card.classList.remove('on');
    refs.foot.classList.remove('off');
    win.setTimeout(function () { if (sel === -1) { card.hidden = true; } }, 620);
  }

  var replay = { running: false, timer: 0, idx: 0 };

  function renderEvents(list) {
    var box = refs.sessHist, i, j;
    box.textContent = '';
    for (i = 0; i < list.length; i++) {
      var ev = list[i];
      var seg = el('div', 'ev' + (ev.who === 'me' ? ' me' : ''));
      if (ev.who === 'me') {
        seg.appendChild(el('div', 'ev-q', ev.text || ''));
      } else {
        var row = el('div', 'ev-row'), cards = ev.cards || [];
        for (j = 0; j < cards.length; j++) {
          var c = cards[j], t;
          if (c.kind === 'tarot') {
            t = el('div', 'tile tf');
            if (c.num) { t.appendChild(el('span', 'tn', c.num)); }
            t.appendChild(el('span', 'nm', c.name || ''));
            t.appendChild(el('span', 'kw', (c.side === 'reversed' ? '逆位 ' + c.reversed : c.upright)));
          } else if (c.image) {
            t = el('div', 'tile');
            var img = doc.createElement('img'); img.src = c.image; img.alt = c.text || '';
            t.appendChild(img);
          } else {
            t = el('div', 'tile', c.text || c.name || '');
          }
          row.appendChild(t);
        }
        seg.appendChild(row);
      }
      seg.appendChild(el('span', 'ev-tm', formatDate(ev.at).slice(11)));
      box.appendChild(seg);
    }
  }

  function openOverlay(title, withReplay) {
    refs.sessTitle.textContent = title;
    refs.replayBar.hidden = !withReplay;
    refs.sessHist.textContent = '';
    if (O.ui && O.ui.openOv) { O.ui.openOv(refs.ovSession, refs.sessClose); }
    stopLoop();
    return O.db.loadEvents(curSess.no).then(function (list) { events = list || []; });
  }

  function closeOverlay() {
    replay.running = false;
    win.clearTimeout(replay.timer);
    if (O.ui && O.ui.closeOv) { O.ui.closeOv(refs.ovSession); }
    startLoop();
    refs.canvas.focus();
  }

  function openView() {
    if (!curSess) { return; }
    openOverlay('No.' + curSess.no + '　全篇', false).then(function () { renderEvents(events); });
  }

  function openReplay() {
    if (!curSess) { return; }
    openOverlay('No.' + curSess.no + '　回放', true).then(function () {
      replay.idx = 0; replay.running = true;
      refs.playBtn.textContent = '暂停';
      renderProgress(); tickReplay();
    });
  }

  function renderProgress() {
    var n = events.length, ratio = n ? replay.idx / n : 0;
    refs.fill.style.width = (ratio * 100) + '%';
    refs.knob.style.left = (ratio * 100) + '%';
    refs.clk.textContent = replay.idx + '/' + n;
  }

  function tickReplay() {
    if (!replay.running) { return; }
    if (replay.idx >= events.length) { replay.running = false; refs.playBtn.textContent = '重播'; return; }
    replay.idx += 1;
    renderEvents(events.slice(0, replay.idx));
    renderProgress();
    var body = refs.sessHist.parentNode;
    body.scrollTop = body.scrollHeight;
    replay.timer = win.setTimeout(tickReplay, 1150);
  }

  function togglePlay() {
    if (replay.running) {
      replay.running = false; win.clearTimeout(replay.timer);
      refs.playBtn.textContent = '播放';
    } else {
      if (replay.idx >= events.length) { replay.idx = 0; }
      replay.running = true; refs.playBtn.textContent = '暂停';
      tickReplay();
    }
  }

  function seek(e) {
    var rect = refs.track.getBoundingClientRect();
    var ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    replay.idx = Math.round(ratio * events.length);
    renderEvents(events.slice(0, replay.idx));
    renderProgress();
  }

  function onThemeChange() {
    refs.canvas.style.opacity = '0';
    win.setTimeout(function () { buildTheme(); refs.canvas.style.opacity = '1'; }, 320);
  }

  /* ---------- B12 对外接口 ---------- */
  function setEmptyUI(isEmpty) {
    refs.empty.classList.remove('leaving');
    refs.empty.hidden = !isEmpty;
    refs.foot.classList.toggle('void', isEmpty);
    refs.cnt.textContent = isEmpty ? '尚无会话' : '共 ' + sessions.length + ' 场会话';
    refs.canvas.setAttribute('aria-label', isEmpty ? '星图：还没有会话记录' : '星图：拖动旋转星盘，左右方向键在会话之间切换');
  }

  /* 从空状态过渡到第一颗星：文字淡出，星盘放大下移，图例浮现 */
  function leaveEmpty() {
    emptyMode = false;
    resize(false);
    refs.empty.classList.add('leaving');
    win.setTimeout(function () { if (!emptyMode) { refs.empty.hidden = true; } }, 900);
    refs.foot.classList.remove('void');
    if (refs.hint) { refs.hint.classList.remove('gone'); }
    refs.canvas.setAttribute('aria-label', '星图：拖动旋转星盘，左右方向键在会话之间切换');
  }

  function open() {
    resize(true);
    return O.db.loadSessions().then(function (res) {
      if (sel >= 0) { closeCard(); }
      sel = -1; hover = -1;
      MOTES.length = 0; RIPS.length = 0; METEORS.length = 0; SPARKS.length = 0; DUST.length = 0; IMPACTS.length = 0;
      AMB.length = 0; ambNext = 7000;
      sessions = (res || []).slice();
      var has = sessions.length > 0;
      emptyMode = !has;
      emptyK = emptyMode ? 1 : 0;
      resize(true);
      refreshNow(true);

      /* 比已读标记更新的会话以流星登场；一次最多三颗，其余直接显影 */
      var mark = O.db.getSeenMark ? O.db.getSeenMark() : null;
      var fresh = [], pend = {}, i, maxTs = mark;
      for (i = 0; i < sessions.length; i++) {
        var t = sessions[i].startedAt;
        if (mark != null && t > mark) { fresh.push(sessions[i]); }
        if (maxTs == null || t > maxTs) { maxTs = t; }
      }
      fresh.sort(function (a, b) { return a.startedAt - b.startedAt; });
      fresh = fresh.slice(-3);
      for (i = 0; i < fresh.length; i++) { pend[fresh[i].no] = true; }

      ST = [];
      buildField();
      buildStars(pend);
      /* 开场「星图展开」：环被逐道画出，背景星由盘心向外亮起，
         会话星按时间从旧到新依次显影，星轨随之一笔一笔接上 */
      var useIntro = has && !reduceMotion;
      introT = useIntro ? 0 : -1;
      if (useIntro) {
        var nn = Math.max(1, ST.length - 1);
        for (i = 0; i < ST.length; i++) {
          if (pend[ST[i].sess.no]) { continue; }
          ST[i].dev = 0; ST[i].devOn = false; ST[i].soft = true;
          ST[i].devAt = 600 + (i / nn) * 2400;
        }
      }
      for (i = 0; i < ST.length; i++) {
        if (pend[ST[i].sess.no]) { launchMeteor(ST[i], (useIntro ? 3600 : 900) + METEORS.length * 1300); }
      }
      if (O.db.setSeenMark && maxTs != null) { O.db.setSeenMark(maxTs); }

      setEmptyUI(!has);
      startLoop();
    });
  }

  /* 实时降临一颗新星（会话刚被「送走」时调用） */
  function arrive(sess) {
    if (!refs || !sess) { return; }
    var i;
    for (i = 0; i < sessions.length; i++) { if (sessions[i].no === sess.no) { return; } }
    sessions.push(sess);
    var wasEmpty = emptyMode;
    if (wasEmpty) { leaveEmpty(); }
    var pend = {}; pend[sess.no] = true;
    buildStars(pend);
    for (i = 0; i < ST.length; i++) {
      if (ST[i].sess === sess) { launchMeteor(ST[i], wasEmpty ? 1100 : 150); }
    }
    refs.cnt.textContent = '共 ' + sessions.length + ' 场会话';
    if (O.db.setSeenMark) { O.db.setSeenMark(sess.startedAt); }
    if (!running && refs.ovSession.hidden) { startLoop(); }
  }

  function close() { stopLoop(); closeCard(); }

  function mount(r) {
    refs = r;
    if (!refs || !refs.canvas) { return; }
    ctx = refs.canvas.getContext('2d');
    buildTheme();
    resize(true);
    bindInteractions();

    var rt = 0;
    win.addEventListener('resize', function () {
      win.clearTimeout(rt);
      rt = win.setTimeout(function () { resize(false); buildField(); }, 120);
    });
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) { stopLoop(); } else if (refs.ovSession.hidden) { startLoop(); }
    });
    if (win.MutationObserver) {
      new win.MutationObserver(function () {
        var d = doc.documentElement.classList.contains('dark');
        if (TH && d !== TH.dark) { onThemeChange(); }
      }).observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    refs.cardClose.addEventListener('click', closeCard);
    refs.btnView.addEventListener('click', openView);
    refs.btnReplay.addEventListener('click', openReplay);
    refs.sessClose.addEventListener('click', closeOverlay);
    refs.playBtn.addEventListener('click', togglePlay);
    refs.track.addEventListener('click', seek);
  }

  O.starmap = { mount: mount, open: open, close: close, arrive: arrive };
})(window);