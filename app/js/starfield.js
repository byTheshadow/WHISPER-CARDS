/* =====================================================================
   显影 · 传讯字卡（WHISPER CARDS）—— 太虚灵境活态背景引擎
   设计理念：神秘 · 神圣 · 永恒流转的太虚灵境
   包含：景深星野、星轨、多层同心神圣法阵光环呼吸、灵息流光极光与弥散雾
   基线规范：Chrome 61，纯前端无外链，极低能耗
   ===================================================================== */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;
  var TAU = Math.PI * 2;
  var AS = 6; /* 极光与弥散采用 1/6 亚分辨率离屏渲染，自然柔润且能耗极低 */

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function mk(w, h) {
    var c = doc.createElement('canvas');
    c.width = w;
    c.height = h || w;
    return c;
  }

  function sstep(x) {
    return x * x * (3 - 2 * x);
  }

  /* ---------- 三套精选仪式主题预设 ----------
     A: 孤烛长明（长明孤烛、曝光星轨、细碎星子）
     C: 秘仪神殿（几何天盘法阵、多重神圣光晕呼吸、纯净低粒子）
     D: 静烛（纯净烛火、柔润呼吸弥散、无星无尘） */
  var PRESETS = {
    A: {
      period: 8.0, amp: 0.25, drift: 0.55, flow: 0.0, auroraW: 0.0, hazeW: 0.0,
      neb: 0.25, stars: 1.0, trail: 1.0, dust: 0.20,
      sky: 0.0, fill: 0.0, rim: 0.0, rays: 0.0, core: 0.0, rings: 0, candle: 1.00
    },
    C: {
      period: 6.5, amp: 0.72, drift: 0.45, flow: 0.45, auroraW: 0.65, hazeW: 0.00,
      neb: 0.25, stars: 0.35, trail: 0.0, dust: 0.15,
      sky: 0.60, fill: 0.50, rim: 0.70, rays: 0.40, core: 0.85, rings: 1, candle: 0.90
    },
    D: {
      period: 8.0, amp: 0.50, drift: 0.30, flow: 0.60, auroraW: 0.00, hazeW: 1.00,
      neb: 0.00, stars: 0.0, trail: 0.0, dust: 0.00,
      sky: 0.55, fill: 0.45, rim: 0.00, rays: 0.00, core: 1.00, rings: 0, candle: 1.00
    }
  };

  var P = {};
  var C = {};
  var k0;
  for (k0 in PRESETS.A) {
    if (Object.prototype.hasOwnProperty.call(PRESETS.A, k0)) {
      P[k0] = PRESETS.A[k0];
      C[k0] = PRESETS.A[k0];
    }
  }
  C.trail = 0;
  P.breath = 1;
  C.breath = 1;

  var sky = null, sx = null;
  var aur = null, ax = null;
  var haloEl = null, veilEl = null;
  var dpr = 1, W = 0, H = 0, CX = 0, CY = 0, R = 0;
  var nebD = null, nebL = null, stars = [], buckets = [[], [], []], dust = [];
  var paused = false;
  var reduced = false;

  function starSprite(rgb, whiteCore, spikes) {
    var s = 64, c = mk(s), g = c.getContext('2d'), r = s / 2;
    var gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)');
    gr.addColorStop(0.1, 'rgba(' + rgb + ',.85)');
    gr.addColorStop(0.3, 'rgba(' + rgb + ',.18)');
    gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    if (spikes) {
      var lg = g.createLinearGradient(0, 0, s, 0);
      lg.addColorStop(0, 'rgba(' + rgb + ',0)');
      lg.addColorStop(0.5, 'rgba(' + rgb + ',.7)');
      lg.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = lg;
      g.fillRect(0, r - 0.6, s, 1.2);
      var lv = g.createLinearGradient(0, 0, 0, s);
      lv.addColorStop(0, 'rgba(' + rgb + ',0)');
      lv.addColorStop(0.5, 'rgba(' + rgb + ',.7)');
      lv.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = lv;
      g.fillRect(r - 0.6, 0, 1.2, s);
    }
    return c;
  }

  var SPR = null;

  function genNebula(dark, S) {
    var c = mk(S), g = c.getContext('2d'), r = rng(dark ? 1337 : 4242);
    var h = S / 2, th = -0.55, ux = Math.cos(th), uy = Math.sin(th), px = -uy, py = ux;
    var rgb = dark ? '255,255,255' : '0,0,0';
    function gauss() { return (r() + r() + r() - 1.5) / 1.5; }
    function blob(x, y, rad, a, col) {
      col = col || rgb;
      var gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(' + col + ',' + a + ')');
      gr.addColorStop(0.5, 'rgba(' + col + ',' + (a * 0.4) + ')');
      gr.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    var t, o, i;
    g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (i = 0; i < 36; i++) {
      t = (r() - 0.5) * 1.9 * h; o = gauss() * 0.16 * h;
      blob(h + ux * t + px * o, h + uy * t + py * o, h * (0.08 + r() * 0.2), dark ? (0.018 + r() * 0.03) : (0.012 + r() * 0.022));
    }
    for (i = 0; i < 12; i++) {
      blob(r() * S, r() * S, h * (0.15 + r() * 0.3), dark ? 0.014 : 0.01);
    }
    for (i = 0; i < 9; i++) {
      t = (r() - 0.5) * 1.4 * h; o = gauss() * 0.06 * h;
      blob(h + ux * t + px * o, h + uy * t + py * o, h * (0.02 + r() * 0.05), dark ? 0.05 : 0.03);
    }
    g.globalCompositeOperation = 'destination-out';
    for (i = 0; i < 20; i++) {
      t = (r() - 0.5) * 1.6 * h; o = gauss() * 0.05 * h + 0.02 * h;
      blob(h + ux * t + px * o, h + uy * t + py * o, h * (0.03 + r() * 0.07), 0.35 + r() * 0.3, '0,0,0');
    }
    g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    var n = Math.min(6000, (S * S / 700) | 0), sc = Math.max(1, S / 1400);
    for (i = 0; i < n; i++) {
      var x, y;
      if (r() < 0.5) {
        t = (r() - 0.5) * 2 * h; o = gauss() * 0.22 * h; x = h + ux * t + px * o; y = h + uy * t + py * o;
      } else {
        x = r() * S; y = r() * S;
      }
      var sz = (0.35 + Math.pow(r(), 3) * 1.1) * sc;
      var a = dark ? (0.12 + r() * 0.45) : (0.04 + r() * 0.14);
      g.fillStyle = 'rgba(' + rgb + ',' + a.toFixed(3) + ')';
      g.beginPath();
      g.arc(x, y, sz, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    var m = g.createRadialGradient(h, h, h * 0.84, h, h, h);
    m.addColorStop(0, '#000');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, S, S);
    return c;
  }

  function newDust(r, anywhere) {
    r = r || Math.random;
    return {
      x: r() * W,
      y: anywhere ? r() * H : H + 10 + r() * 40,
      v: 0.5 + r() * 0.8,
      sz: 0.5 + Math.pow(r(), 2) * 1.6,
      ph: r() * TAU,
      al: 0.35 + r() * 0.55
    };
  }

  function genStars() {
    var r = rng(99), n = Math.min(480, Math.round(W * H / 3200));
    stars = [];
    buckets = [[], [], []];
    for (var i = 0; i < n; i++) {
      var big = r() < 0.04;
      var s = {
        r: 40 + Math.sqrt(r()) * (R - 40),
        a: r() * TAU,
        sz: big ? 2 + r() * 1.2 : 0.55 + Math.pow(r(), 2.2) * 1.6,
        al: big ? 0.9 : 0.35 + r() * 0.6,
        f: 0.4 + r() * 1.8,
        p: r() * TAU,
        big: big
      };
      s.cls = big || s.al > 0.8 ? 2 : (s.al > 0.58 ? 1 : 0);
      stars.push(s);
      buckets[s.cls].push(s);
    }
    var m = Math.min(90, Math.round(W * H / 14000));
    dust = [];
    for (var j = 0; j < m; j++) {
      dust.push(newDust(r, true));
    }
  }

  function resize() {
    dpr = Math.min(win.devicePixelRatio || 1, 2);
    W = win.innerWidth;
    H = win.innerHeight;
    if (!sky || !aur) { return; }
    sky.width = Math.round(W * dpr);
    sky.height = Math.round(H * dpr);
    sx.setTransform(dpr, 0, 0, dpr, 0, 0);

    aur.width = Math.max(2, Math.round(W / AS));
    aur.height = Math.max(2, Math.round(H / AS));

    /* 寻找烛火视窗作为法阵中心 */
    var cw = doc.querySelector('.cw');
    if (cw) {
      var b = cw.getBoundingClientRect();
      CX = b.left + b.width / 2;
      CY = b.top + b.height * 0.52;
    } else {
      CX = W / 2;
      CY = H * 0.46;
    }

    if (haloEl) {
      haloEl.style.left = Math.round(CX) + 'px';
      haloEl.style.top = Math.round(CY) + 'px';
    }
    doc.documentElement.style.setProperty('--cx', Math.round(CX) + 'px');
    doc.documentElement.style.setProperty('--cy', Math.round(CY) + 'px');

    R = Math.max(
      Math.hypot(CX, CY),
      Math.hypot(W - CX, CY),
      Math.hypot(CX, H - CY),
      Math.hypot(W - CX, H - CY)
    ) * 1.08;

    var S = Math.min(2048, Math.ceil(2 * R * Math.min(dpr, 1.5) * 0.6));
    nebD = genNebula(true, S);
    nebL = genNebula(false, S);
    genStars();
  }

  /* ---------- 法阵线条构建 ---------- */
  function buildRings() {
    var ns = 'http://www.w3.org/2000/svg';
    var g = doc.getElementById('ticks');
    var i, l;
    if (g && !g.hasChildNodes()) {
      for (i = 0; i < 48; i++) {
        var a = i / 48 * TAU, isLong = i % 4 === 0;
        l = doc.createElementNS(ns, 'line');
        l.setAttribute('x1', (Math.cos(a) * 85).toFixed(2));
        l.setAttribute('y1', (Math.sin(a) * 85).toFixed(2));
        l.setAttribute('x2', (Math.cos(a) * (isLong ? 91 : 88)).toFixed(2));
        l.setAttribute('y2', (Math.sin(a) * (isLong ? 91 : 88)).toFixed(2));
        l.setAttribute('stroke-width', isLong ? '.8' : '.45');
        g.appendChild(l);
      }
    }
    var octa = doc.getElementById('octa');
    if (octa && !octa.getAttribute('d')) {
      var d = '', pts = [];
      for (i = 0; i < 8; i++) {
        pts.push([Math.cos(i / 8 * TAU - Math.PI / 2) * 90, Math.sin(i / 8 * TAU - Math.PI / 2) * 90]);
      }
      for (i = 0; i <= 8; i++) {
        var p = pts[(i * 3) % 8];
        d += (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
      }
      octa.setAttribute('d', d + 'Z');
    }
    var md = doc.getElementById('mdots');
    if (md && !md.hasChildNodes()) {
      for (i = 0; i < 8; i++) {
        var c = doc.createElementNS(ns, 'circle'), aa = i / 8 * TAU + TAU / 16;
        c.setAttribute('cx', (Math.cos(aa) * 96).toFixed(2));
        c.setAttribute('cy', (Math.sin(aa) * 96).toFixed(2));
        c.setAttribute('r', '1.6');
        c.setAttribute('class', 'dot');
        md.appendChild(c);
      }
    }
  }

  /* ---------- 极光与弥散配置 ---------- */
  var RIB = [
    { base: 0.27, A1: 0.07, k1: 1.3, w1: 0.06, A2: 0.03, k2: 3.1, w2: 0.09, ph: 0.0, v: 0.013, wd: 0.11 },
    { base: 0.72, A1: 0.05, k1: 1.9, w1: 0.045, A2: 0.028, k2: 4.0, w2: 0.07, ph: 2.1, v: 0.010, wd: 0.085 }
  ];
  var HZ = [
    { or: 0.16, sp: 0.020, ph: 0.0, rad: 0.55, sy: 0.7 },
    { or: 0.30, sp: -0.014, ph: 2.0, rad: 0.72, sy: 0.6 },
    { or: 0.10, sp: 0.032, ph: 4.0, rad: 0.42, sy: 0.9 },
    { or: 0.38, sp: 0.011, ph: 1.0, rad: 0.85, sy: 0.5 }
  ];

  function themePasses(mL) {
    var ps = [];
    if (1 - mL > 0.01) { ps.push({ w: 1 - mL, op: 'lighter', rgb: '255,255,255', k: 1 }); }
    if (mL > 0.01) { ps.push({ w: mL, op: 'source-over', rgb: '0,0,0', k: 0.6 }); }
    return ps;
  }

  function drawFlow(T, aI, hI, mL, br, spd) {
    var w = aur.width, h = aur.height;
    ax.globalCompositeOperation = 'source-over';
    ax.globalAlpha = 1;
    ax.clearRect(0, 0, w, h);
    if (aI < 0.005 && hI < 0.005) { return; }
    var passes = themePasses(mL);
    for (var q = 0; q < passes.length; q++) {
      var pq = passes[q];
      ax.globalCompositeOperation = pq.op;

      /* 弥散柔雾 */
      if (hI > 0.005) {
        var M = Math.min(W, H) / AS, cx = CX / AS, cy = CY / AS, st = hI * pq.w * pq.k;
        for (var i = 0; i < HZ.length; i++) {
          var z = HZ[i], an = z.ph + T * z.sp * spd;
          var x = cx + Math.cos(an) * z.or * M * 1.4, y = cy + Math.sin(an) * z.or * M * z.sy;
          var rad = z.rad * M * (1 + 0.1 * br);
          var a = 0.075 * st * (0.7 + 0.3 * br);
          var g = ax.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, 'rgba(' + pq.rgb + ',' + a.toFixed(4) + ')');
          g.addColorStop(0.55, 'rgba(' + pq.rgb + ',' + (a * 0.35).toFixed(4) + ')');
          g.addColorStop(1, 'rgba(' + pq.rgb + ',0)');
          ax.fillStyle = g;
          ax.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        for (var j = 0; j < 3; j++) {
          var u = ((T * spd) / 18 + j / 3) % 1;
          var wx = cx + Math.sin(u * 5 + j * 2.1) * 0.06 * M * u, wy = cy - u * 0.55 * M;
          var wr = (0.05 + 0.24 * u) * M;
          var wa = Math.pow(Math.sin(u * Math.PI), 1.5) * 0.11 * st;
          var wg = ax.createRadialGradient(wx, wy, 0, wx, wy, wr);
          wg.addColorStop(0, 'rgba(' + pq.rgb + ',' + wa.toFixed(4) + ')');
          wg.addColorStop(1, 'rgba(' + pq.rgb + ',0)');
          ax.fillStyle = wg;
          ax.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
        }
      }

      /* 极光流光 */
      if (aI > 0.005) {
        ax.lineCap = 'round';
        ax.lineJoin = 'round';
        for (var r = 0; r < RIB.length; r++) {
          var rb = RIB[r], strength = aI * pq.w * pq.k;
          var c = ((T * rb.v + rb.ph * 0.17) % 1.6) - 0.3;
          if (r % 2) { c = 1 - c; }
          var gr = ax.createLinearGradient(0, 0, w, 0);
          for (var s = 0; s <= 8; s++) {
            var uu = s / 8, e = 0.22 + 0.78 * Math.exp(-Math.pow((uu - c) / 0.28, 2));
            gr.addColorStop(uu, 'rgba(' + pq.rgb + ',' + e.toFixed(3) + ')');
          }
          ax.strokeStyle = gr;
          var base = rb.base + 0.04 * Math.sin(T * 0.021 + rb.ph);
          ax.beginPath();
          for (var p = 0; p <= 48; p++) {
            var xx = (p / 48) * 1.2 - 0.1;
            var yy = base + rb.A1 * Math.sin(TAU * rb.k1 * xx + T * rb.w1 * TAU * 0.25 + rb.ph)
                          + rb.A2 * Math.sin(TAU * rb.k2 * xx - T * rb.w2 * TAU * 0.25 + rb.ph * 1.7);
            if (p) { ax.lineTo(xx * w, yy * h); } else { ax.moveTo(xx * w, yy * h); }
          }
          var bw = rb.wd * h, ws = [1.0, 0.6, 0.32, 0.14], as = [0.07, 0.09, 0.12, 0.16];
          for (var k = 0; k < 4; k++) {
            ax.globalAlpha = as[k] * strength;
            ax.lineWidth = bw * ws[k];
            ax.stroke();
          }
          for (var m = 1; m <= 3; m++) {
            ax.save();
            ax.translate(0, -m * bw * 0.55);
            ax.globalAlpha = 0.05 / m * strength;
            ax.lineWidth = bw * 0.55;
            ax.stroke();
            ax.restore();
          }
          ax.globalAlpha = 1;
        }
      }
    }
  }

  /* ---------- 星轨描绘 ---------- */
  var TRAIL_K = 7, TRAIL_CLS = [[0.28, 0.55], [0.5, 0.8], [0.85, 1.2]];
  function drawTrails(angMid, passes) {
    var Lr = C.trail * 0.62;
    var amt = C.trail * C.stars;
    if (Lr < 0.004 || amt < 0.01) { return; }
    sx.lineCap = 'round';
    for (var q = 0; q < passes.length; q++) {
      var pq = passes[q];
      sx.globalCompositeOperation = pq.op;
      sx.globalAlpha = 1;
      for (var c = 0; c < 3; c++) {
        var list = buckets[c];
        sx.lineWidth = TRAIL_CLS[c][1];
        for (var k = 0; k < TRAIL_K; k++) {
          var a = TRAIL_CLS[c][0] * Math.pow(1 - k / TRAIL_K, 1.5) * amt * pq.w * pq.k;
          if (a < 0.004) { continue; }
          sx.strokeStyle = 'rgba(' + pq.rgb + ',' + a.toFixed(3) + ')';
          sx.beginPath();
          for (var i = 0; i < list.length; i++) {
            var s = list[i], th = s.a + angMid;
            var a1 = th - Lr * k / TRAIL_K, a0 = th - Lr * (k + 1) / TRAIL_K;
            sx.moveTo(CX + Math.cos(a0) * s.r, CY + Math.sin(a0) * s.r);
            sx.arc(CX, CY, s.r, a0, a1);
          }
          sx.stroke();
        }
      }
    }
  }

  function drawSky(T, dt, angFar, angMid, br, mL) {
    sx.globalCompositeOperation = 'source-over';
    sx.globalAlpha = 1;
    sx.clearRect(0, 0, W, H);
    var passes = themePasses(mL);
    var q, pq;

    /* 远景星云 */
    if (C.neb > 0.005) {
      var nb = C.neb * (0.9 + 0.1 * br);
      sx.save();
      sx.translate(CX, CY);
      sx.rotate(angFar);
      if (1 - mL > 0.003 && nebD) {
        sx.globalAlpha = (1 - mL) * nb;
        sx.drawImage(nebD, -R, -R, 2 * R, 2 * R);
      }
      if (mL > 0.003 && nebL) {
        sx.globalAlpha = mL * nb;
        sx.drawImage(nebL, -R, -R, 2 * R, 2 * R);
      }
      sx.restore();
    }

    /* 星轨 */
    drawTrails(angMid, passes);

    /* 星点 */
    if (C.stars > 0.01) {
      var cosA = Math.cos(angMid), sinA = Math.sin(angMid), twA = 1 - 0.7 * C.trail;
      for (q = 0; q < passes.length; q++) {
        pq = passes[q];
        var sp = pq.rgb === '0,0,0' ? [SPR.l, SPR.lBig] : [SPR.d, SPR.dBig];
        sx.globalCompositeOperation = pq.op;
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          var ca = Math.cos(s.a), sa = Math.sin(s.a);
          var x = CX + (ca * cosA - sa * sinA) * s.r, y = CY + (sa * cosA + ca * sinA) * s.r;
          if (x < -30 || y < -30 || x > W + 30 || y > H + 30) { continue; }
          var tw = 0.6 * (0.5 + 0.5 * Math.sin(T * s.f + s.p)) + 0.4 * (0.5 + 0.5 * Math.sin(T * s.f * 2.7 + s.p * 1.3));
          tw = 1 - twA + twA * tw;
          var a = s.al * (0.28 + 0.72 * tw) * pq.w * (pq.rgb === '0,0,0' ? 0.75 : 1) * C.stars;
          if (a < 0.01) { continue; }
          var d = s.sz * (s.big ? 13 : 10) * (0.88 + 0.12 * tw);
          sx.globalAlpha = a;
          sx.drawImage(s.big ? sp[1] : sp[0], x - d / 2, y - d / 2, d, d);
        }
      }
    }

    /* 近景灵尘 */
    if (C.dust > 0.01) {
      var rise = 8 + 26 * C.drift;
      for (var j = 0; j < dust.length; j++) {
        var p = dust[j];
        p.y -= rise * p.v * dt;
        p.x += Math.sin(p.y * 0.005 + p.ph + T * 0.15) * 12 * p.v * dt;
        if (p.y > CY) { p.x += (CX - p.x) * 0.035 * dt; }
        if (p.y < -12) { dust[j] = newDust(); }
      }
      for (q = 0; q < passes.length; q++) {
        pq = passes[q];
        var spr = pq.rgb === '0,0,0' ? SPR.l : SPR.d;
        sx.globalCompositeOperation = pq.op;
        for (j = 0; j < dust.length; j++) {
          p = dust[j];
          var fy = p.y / H, life = Math.min(1, (1 - fy) * 6) * Math.min(1, fy * 2.2 + 0.05);
          if (life <= 0) { continue; }
          var near = Math.max(0, 1 - Math.hypot(p.x - CX, p.y - CY) / 160);
          var al = p.al * life * (0.75 + 0.25 * Math.sin(T * 1.3 + p.ph)) * (1 + near * 0.8) * pq.w * pq.k * C.dust;
          var dd = p.sz * 7;
          sx.globalAlpha = Math.min(1, al);
          sx.drawImage(spr, p.x - dd / 2, p.y - dd / 2, dd, dd);
        }
      }
    }
    sx.globalAlpha = 1;
    sx.globalCompositeOperation = 'source-over';
  }

  var L = {};
  var RINGS = [];
  var T = 0, phi = 0, angFar = 0, angMid = 0, rayA = 0;
  var ringA = [0, 0, 0];

  function init() {
    sky = doc.getElementById('sky');
    aur = doc.getElementById('aur');
    if (!sky || !aur) { return false; }
    sx = sky.getContext('2d');
    ax = aur.getContext('2d');
    haloEl = doc.getElementById('halo');
    veilEl = doc.getElementById('veil');

    SPR = {
      d: starSprite('255,255,255'),
      dBig: starSprite('255,255,255', true, true),
      l: starSprite('0,0,0'),
      lBig: starSprite('0,0,0', false, true)
    };

    L = {
      sky:  { el: doc.getElementById('hSky'),  lag: 1.0, gain: 0.05, dark: 0.14, light: 0.035 },
      rays: { el: doc.getElementById('hRays'), lag: 0.7, gain: 0.10, dark: 0.14, light: 0.06 },
      fill: { el: doc.getElementById('hFill'), lag: 0.35, gain: 0.12, dark: 0.20, light: 0.04 },
      rim:  { el: doc.getElementById('hRim'),  lag: 0.45, gain: 0.14, dark: 0.40, light: 0.12 },
      core: { el: doc.getElementById('hCore'), lag: 0.0, gain: 0.16, dark: 0.50, light: 0.0 }
    };
    RINGS = [
      { el: doc.getElementById('rOuter'), spd: 1.1, lag: 0.8 },
      { el: doc.getElementById('rMid'), spd: -0.7, lag: 0.5 },
      { el: doc.getElementById('rInner'), spd: 1.8, lag: 0.25 }
    ];

    buildRings();
    resize();
    win.addEventListener('resize', resize);
    return true;
  }

  function frame(ts, dtMs, rm, themeT) {
    if (paused || !sky) { return; }
    var dt = Math.min(0.05, (dtMs || 16) / 1000);
    var MF = rm ? 0.25 : 1;
    var dtm = dt * MF;
    T += dtm;

    var ke = 1 - Math.exp(-dt * 1.8);
    var kTrail = 1 - Math.exp(-dt * (P.trail > C.trail ? 0.35 : 1.5));
    var k;
    for (k in P) {
      if (Object.prototype.hasOwnProperty.call(P, k)) {
        C[k] += (P[k] - C[k]) * (k === 'trail' ? kTrail : ke);
      }
    }

    var mL = 1 - (typeof themeT === 'number' ? themeT : 0);

    phi += dtm * TAU / C.period;
    var amp = C.amp * C.breath * (rm ? 0.35 : 1);
    function breathAt(lag) { return sstep((1 - Math.cos(phi - lag)) / 2); }
    var b0 = breathAt(0);

    var Tfar = 480 * Math.pow(0.125, C.drift);
    angFar += dtm * TAU / Tfar;
    angMid += dtm * TAU / (Tfar / 1.6);
    rayA += dtm * 0.6;

    drawSky(T, dtm, angFar, angMid, 1 - amp + amp * b0, mL);
    drawFlow(T, C.flow * C.auroraW * (0.9 + 0.1 * b0), C.flow * C.hazeW, mL, 1 - amp + amp * b0, 0.5 + 1.5 * C.drift);

    var n = Math.sin(T * 7.3) * 0.5 + Math.sin(T * 13.1 + 1) * 0.3 + Math.sin(T * 23.7 + 2) * 0.2;
    if (rm) { n *= 0.3; }

    var name;
    for (name in L) {
      if (Object.prototype.hasOwnProperty.call(L, name)) {
        var l = L[name];
        if (!l.el) { continue; }
        var bi = breathAt(l.lag);
        var s = 1 + amp * l.gain * bi;
        var base = l.dark + (l.light - l.dark) * mL;
        var op = base * C[name] * (1 - amp * 0.35 + amp * 0.35 * bi);
        if (name === 'core') { op *= (1 + 0.04 * n) * (0.6 + 0.4 * C.candle); }
        l.el.style.opacity = Math.max(0, op).toFixed(3);
        l.el.style.transform = 'translate(-50%,-50%) scale(' + s.toFixed(4) + ')' + (name === 'rays' ? ' rotate(' + rayA.toFixed(2) + 'deg)' : '');
      }
    }

    for (var i = 0; i < RINGS.length; i++) {
      var rg = RINGS[i];
      if (!rg.el) { continue; }
      var rb = breathAt(rg.lag);
      ringA[i] += dtm * rg.spd;
      rg.el.style.opacity = (C.rings * (0.55 + 0.45 * rb) * (0.85 - 0.15 * mL)).toFixed(3);
      rg.el.style.transform = 'translate(-50%,-50%) scale(' + (1 + amp * 0.06 * rb).toFixed(4) + ') rotate(' + ringA[i].toFixed(2) + 'deg)';
    }
  }

  function setTheme(id) {
    var target = PRESETS[id] || PRESETS.A;
    var k;
    for (k in target) {
      if (Object.prototype.hasOwnProperty.call(target, k)) {
        P[k] = target[k];
      }
    }
  }

  function pause() {
    paused = true;
    if (haloEl) { haloEl.style.display = 'none'; }
    if (sky) { sky.style.display = 'none'; }
    if (aur) { aur.style.display = 'none'; }
    if (veilEl) { veilEl.style.display = 'none'; }
  }

  function resume() {
    paused = false;
    if (haloEl) { haloEl.style.display = ''; }
    if (sky) { sky.style.display = ''; }
    if (aur) { aur.style.display = ''; }
    if (veilEl) { veilEl.style.display = ''; }
    resize();
  }

  O.fx = {
    init: init,
    frame: frame,
    setTheme: setTheme,
    setReducedMotion: function (rm) { reduced = !!rm; },
    pause: pause,
    resume: resume,
    setIntens: function () {},
    setGrain: function () {}
  };
})(window);
