/* 弥散背景 + 星屑 + 胶片颗粒（对应原型 BG / Dust / grain）。
   背景按 1/3 分辨率绘制再放大，天然柔和；星屑是浮动尘点，浅色下是墨尘、深色下是星点。
   页面隐藏时上层停止 rAF，这里不再自绘；减少动效时只保留静态图。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  function rgba(r, g, b, a) {
    return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }
  function mix(a, b, t) { return a + (b - a) * t; }

  var bgCv = null, bgCtx = null, W = 0, H = 0;
  var dustCv = null, dustCtx = null, DW = 0, DH = 0;
  var grainEl = null;
  var GRAIN = { light: '', dark: '' };
  var blobs = [];
  var ps = [];
  var it = 0, itT = 0;
  var lastBg = 0;

  function grainURL(dark) {
    var n = 128;
    var c = doc.createElement('canvas');
    c.width = n;
    c.height = n;
    var x = c.getContext('2d');
    var img = x.createImageData(n, n);
    var b = O.rng.bytes(n * n);
    var v = dark ? 255 : 0;
    var i;
    for (i = 0; i < n * n; i++) {
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = Math.round(b[i] * (dark ? 0.055 : 0.07));
    }
    x.putImageData(img, 0, 0);
    return 'url(' + c.toDataURL('image/png') + ')';
  }

  function makeBlobs() {
    var src = [[1.04, -0.08, 0.72, 0.6], [-0.14, 1.1, 0.68, 0.48], [0.1, 0.32, 0.36, 0.13], [0.9, 0.72, 0.32, 0.12], [0.5, 0.0, 0.3, 0.1]];
    var i;
    for (i = 0; i < src.length; i++) {
      var s = src[i];
      blobs.push({
        ax: s[0], ay: s[1], r: s[2], a: s[3], heavy: i < 2,
        sx: O.rng.range(0.00004, 0.00009), sy: O.rng.range(0.00004, 0.00009),
        px: O.rng.range(0, 6.283), py: O.rng.range(0, 6.283), sr: O.rng.range(0.00005, 0.0001)
      });
    }
  }

  function resizeBg() {
    W = Math.max(80, Math.round(win.innerWidth / 3));
    H = Math.max(80, Math.round(win.innerHeight / 3));
    bgCv.width = W;
    bgCv.height = H;
  }

  function drawBg(ts, t) {
    it += (itT - it) * 0.05;
    var d = t;
    var c = mix(14, 236, d);
    var m = mix(1, 0.42, d);
    var M = Math.max(W, H);
    bgCtx.fillStyle = rgba(mix(244, 11, d), mix(244, 11, d), mix(242, 13, d), 1);
    bgCtx.fillRect(0, 0, W, H);
    var i;
    for (i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var x = b.ax + 0.1 * Math.sin(ts * b.sx + b.px) + 0.05 * Math.sin(ts * b.sx * 2.3 + b.px * 1.7);
      var y = b.ay + 0.08 * Math.sin(ts * b.sy + b.py) + 0.04 * Math.sin(ts * b.sy * 1.9 + b.py * 2.1);
      if (!b.heavy) { x = mix(x, 0.5, it * 0.3); y = mix(y, 0.66, it * 0.3); }
      var r = M * b.r * (1 + 0.07 * Math.sin(ts * b.sr + b.px));
      var a = b.a * m * (1 + it * 0.22);
      var g = bgCtx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r);
      g.addColorStop(0, rgba(c, c, c + 2, a));
      g.addColorStop(0.42, rgba(c, c, c + 2, a * 0.55));
      g.addColorStop(1, rgba(c, c, c + 2, 0));
      bgCtx.fillStyle = g;
      bgCtx.fillRect(0, 0, W, H);
    }
  }

  function resizeDust() {
    var dpr = Math.min(win.devicePixelRatio || 1, 2);
    DW = win.innerWidth;
    DH = win.innerHeight;
    dustCv.width = Math.round(DW * dpr);
    dustCv.height = Math.round(DH * dpr);
    dustCv.style.width = DW + 'px';
    dustCv.style.height = DH + 'px';
    dustCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.min(70, Math.round(DW * DH / 11000));
    ps = [];
    var i;
    for (i = 0; i < n; i++) {
      ps.push({
        x: O.rng.float() * DW, y: O.rng.float() * DH,
        r: O.rng.range(0.4, 1.3), a: O.rng.range(0.15, 0.65),
        vx: O.rng.range(-0.006, 0.006), vy: -O.rng.range(0.002, 0.012),
        s: O.rng.range(0.4, 1.4), p: O.rng.range(0, 6.283)
      });
    }
  }

  function drawDust(ts, dt, t) {
    var d = t;
    var c = mix(20, 255, d);
    var k = mix(0.42, 1, d);
    dustCtx.clearRect(0, 0, DW, DH);
    var i;
    for (i = 0; i < ps.length; i++) {
      var p = ps[i];
      p.x += p.vx * dt * (1 + it * 1.5);
      p.y += p.vy * dt * (1 + it * 1.5);
      if (p.x < -3) { p.x = DW + 3; }
      if (p.x > DW + 3) { p.x = -3; }
      if (p.y < -3) { p.y = DH + 3; }
      var tw = 0.55 + 0.45 * Math.sin(ts * 0.001 * p.s + p.p);
      dustCtx.fillStyle = rgba(c, c, c, p.a * tw * k);
      dustCtx.beginPath();
      dustCtx.arc(p.x, p.y, p.r, 0, 6.283);
      dustCtx.fill();
    }
  }

  function init() {
    bgCv = doc.getElementById('bg');
    bgCtx = bgCv.getContext('2d');
    dustCv = doc.getElementById('dust');
    dustCtx = dustCv.getContext('2d');
    grainEl = doc.getElementById('grain');
    makeBlobs();
    resizeBg();
    resizeDust();
    GRAIN.light = grainURL(false);
    GRAIN.dark = grainURL(true);
    grainEl.style.backgroundImage = GRAIN.light;
    win.addEventListener('resize', function () {
      resizeBg();
      resizeDust();
    });
    return true;
  }

  function frame(ts, dt, rm, t) {
    var step = rm ? 200 : 33;
    if (ts - lastBg <= step) { return; }
    var bdt = lastBg ? Math.min(ts - lastBg, 250) : 33;
    lastBg = ts;
    drawBg(rm ? 0 : ts, t);
    drawDust(rm ? 0 : ts, rm ? 0 : bdt, t);
  }

  O.fx = {
    init: init,
    frame: frame,
    setIntens: function (v) { itT = v; },
    setGrain: function (dark) { if (grainEl) { grainEl.style.backgroundImage = dark ? GRAIN.dark : GRAIN.light; } }
  };
})(window);