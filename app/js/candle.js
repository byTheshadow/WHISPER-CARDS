/* 写实蜡烛（Canvas 2D，140×170 基准，DPR 封顶 2）。
   结构照搬原型：蜡体圆柱明暗 + 烛泪 + 蜡池 + 烛芯余烬 + 蓝芯火焰 + 烟。
   火焰抖动由平滑噪声驱动，不用循环动画；减少动效时噪声取 0，火焰静止但仍然存在。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};

  function rgba(r, g, b, a) {
    return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }

  function mix(a, b, t) { return a + (b - a) * t; }

  class Noise {
    constructor() {
      this.t = [];
      var i;
      for (i = 0; i < 256; i++) { this.t.push(O.rng.float() * 2 - 1); }
    }
    val(x) {
      var i = Math.floor(x);
      var f = x - i;
      var a = this.t[i & 255];
      var b = this.t[(i + 1) & 255];
      var u = f * f * (3 - 2 * f);
      return a + (b - a) * u;
    }
  }

  function teardrop(ctx, cx, by, w, h, dx) {
    var tx = cx + dx;
    var ty = by - h;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.bezierCurveTo(cx + dx * 0.4 - w * 1.0, by - h * 0.55, cx - w * 0.95, by, cx, by);
    ctx.bezierCurveTo(cx + w * 0.95, by, cx + dx * 0.4 + w * 1.0, by - h * 0.55, tx, ty);
    ctx.closePath();
  }

  class Candle {
    constructor(cv, s) {
      this.cv = cv;
      this.ctx = cv.getContext('2d');
      this.s = s || 1;
      this.f = 0;
      this.target = 0;
      this.flare = 0;
      this.ember = 0;
      this.gaze = 0;
      this.smoke = [];
      this.emit = 0;
      this.acc = 0;
      this.n1 = new Noise();
      this.n2 = new Noise();
      this.n3 = new Noise();
      this.drips = [
        { x: O.rng.range(0.16, 0.3), l: O.rng.range(7, 14) },
        { x: O.rng.range(0.64, 0.82), l: O.rng.range(4, 9) }
      ];
      var dpr = Math.min(win.devicePixelRatio || 1, 2);
      this.k = this.s * dpr;
      cv.width = Math.round(140 * this.k);
      cv.height = Math.round(170 * this.k);
      cv.style.width = (140 * this.s) + 'px';
      cv.style.height = (170 * this.s) + 'px';
    }

    light() {
      this.target = 1;
      this.flare = 1;
      this.emit = 0;
    }

    snuff() {
      if (this.target === 0) { return; }
      this.target = 0;
      this.ember = 1;
      this.emit = 1400;
    }

    setOut() {
      this.target = 0;
      this.f = 0;
      this.ember = 0;
      this.emit = 0;
      this.smoke = [];
    }

    isOut() { return this.target === 0; }

    step(dt, ts, rm, d) {
      if (this.target > this.f) {
        this.f += (1 - this.f) * Math.min(1, dt / 240);
      } else {
        this.f = Math.max(0, this.f - dt / 300);
      }
      this.flare = Math.max(0, this.flare - dt / 900);
      this.gaze = Math.max(0, this.gaze - dt / 1600);
      if (this.target === 0) { this.ember = Math.max(0, this.ember - dt / 2800); }
      if (this.emit > 0) {
        this.emit -= dt;
        this.acc += dt;
        while (this.acc > 36) {
          this.acc -= 36;
          this.smoke.push({
            x: 0,
            y: 0,
            vx: O.rng.range(-2, 2),
            vy: -O.rng.range(18, 27),
            r: O.rng.range(0.9, 1.5),
            a: O.rng.range(0.1, 0.17) * (0.25 + Math.max(0, this.emit) / 1400),
            p: O.rng.range(0, 6.283),
            age: 0
          });
        }
      }
      var i;
      for (i = this.smoke.length - 1; i >= 0; i--) {
        var q = this.smoke[i];
        q.age += dt;
        q.y += q.vy * dt / 1000;
        q.x += (q.vx + Math.sin(q.age * 0.0035 + q.p) * 6) * dt / 1000;
        q.r += dt * 0.0045;
        q.a *= Math.pow(0.5, dt / 640);
        if (q.a < 0.008) { this.smoke.splice(i, 1); }
      }
      this.draw(ts, rm, d);
    }

    draw(ts, rm, d) {
      var c = this.ctx;
      var k = this.k;
      var f = this.f;
      var cx = 70;
      var base = 166;
      var ww = 20;
      var wh = 46;
      var top = base - wh;
      var x0 = cx - ww / 2;
      var x1 = cx + ww / 2;
      c.setTransform(k, 0, 0, k, 0, 0);
      c.clearRect(0, 0, 140, 170);
      var amb = mix(1, 0.5, d) + 0.45 * f * d;
      function wax(r, g, b) { return rgba(r * amb, g * amb, b * amb, 1); }

      if (f > 0.01) {
        var hy = top - 16;
        var hr = (48 + this.flare * 12 + this.gaze * 8) * f;
        var hg = c.createRadialGradient(cx, hy, 0, cx, hy, hr);
        hg.addColorStop(0, rgba(255, 172, 92, mix(0.2, 0.36, d) * f));
        hg.addColorStop(1, rgba(255, 172, 92, 0));
        c.globalCompositeOperation = d > 0.5 ? 'lighter' : 'source-over';
        c.fillStyle = hg;
        c.fillRect(0, 0, 140, 170);
        c.globalCompositeOperation = 'source-over';
      }

      c.beginPath();
      c.moveTo(x0, top);
      c.lineTo(x0, base - 2);
      c.quadraticCurveTo(cx, base + 2, x1, base - 2);
      c.lineTo(x1, top);
      c.closePath();
      var bg = c.createLinearGradient(x0, 0, x1, 0);
      bg.addColorStop(0, wax(196, 188, 174));
      bg.addColorStop(0.28, wax(250, 247, 240));
      bg.addColorStop(0.55, wax(238, 232, 220));
      bg.addColorStop(1, wax(186, 178, 163));
      c.fillStyle = bg;
      c.fill();

      if (f > 0.01) {
        var sg = c.createLinearGradient(0, top, 0, top + wh * 0.6);
        sg.addColorStop(0, rgba(255, 160, 70, 0.3 * f));
        sg.addColorStop(1, rgba(255, 160, 70, 0));
        c.fillStyle = sg;
        c.fill();
      }

      var i;
      for (i = 0; i < this.drips.length; i++) {
        var dp = this.drips[i];
        var dx = x0 + ww * dp.x;
        c.beginPath();
        c.moveTo(dx - 1.8, top);
        c.lineTo(dx - 1.8, top + dp.l);
        c.arc(dx, top + dp.l, 1.8, Math.PI, 0, true);
        c.lineTo(dx + 1.8, top);
        c.closePath();
        c.fillStyle = wax(247, 243, 234);
        c.fill();
        c.strokeStyle = rgba(0, 0, 0, 0.05);
        c.lineWidth = 0.5;
        c.stroke();
      }

      c.beginPath();
      c.ellipse(cx, top, ww / 2, 2.6, 0, 0, 6.283);
      c.fillStyle = wax(230, 224, 211);
      c.fill();
      c.beginPath();
      c.ellipse(cx, top + 0.4, ww / 2 - 3, 1.6, 0, 0, 6.283);
      c.fillStyle = f > 0.01 ? rgba(255, 186, 108, 0.22 + 0.4 * f) : wax(206, 198, 184);
      c.fill();

      var tipx = cx + 0.7;
      var tipy = top - 7;
      c.beginPath();
      c.moveTo(cx, top);
      c.quadraticCurveTo(cx - 0.7, top - 4, tipx, tipy);
      c.lineWidth = 1.1;
      c.strokeStyle = '#2a241f';
      c.stroke();
      var e = Math.max(this.ember, f * 0.7);
      if (e > 0.01) {
        c.save();
        c.shadowBlur = 6 * k;
        c.shadowColor = rgba(255, 80, 20, e);
        c.fillStyle = rgba(255, 90, 32, e);
        c.beginPath();
        c.arc(tipx, tipy, 1.25, 0, 6.283);
        c.fill();
        c.restore();
      }

      if (f > 0.01) {
        var a1 = rm ? 0 : this.n1.val(ts * 0.0011);
        var a2 = rm ? 0 : this.n2.val(ts * 0.009);
        var a3 = rm ? 0 : this.n3.val(ts * 0.0023);
        var fh = (25 + this.flare * 9 + this.gaze * 6) * f * (1 + 0.07 * a2 + 0.05 * a3);
        var fw = 4.6 * (0.85 + 0.15 * f) * (1 + 0.05 * a2);
        var sway = a1 * 2.8;
        var y0 = tipy + 3;
        c.save();
        c.globalAlpha = Math.min(1, f * 1.25);
        teardrop(c, cx, y0, fw, fh, sway);
        var fg = c.createLinearGradient(0, y0, 0, y0 - fh);
        fg.addColorStop(0, 'rgba(80,118,255,0.55)');
        fg.addColorStop(0.13, 'rgba(255,246,226,0.96)');
        fg.addColorStop(0.45, 'rgba(255,214,138,0.95)');
        fg.addColorStop(0.8, 'rgba(255,148,58,0.72)');
        fg.addColorStop(1, 'rgba(255,120,40,0)');
        c.shadowBlur = 12 * k;
        c.shadowColor = 'rgba(255,150,50,0.9)';
        c.fillStyle = fg;
        c.fill();
        teardrop(c, cx + sway * 0.12, y0 - 1, fw * 0.45, fh * 0.5, sway * 0.3);
        c.shadowBlur = 4 * k;
        c.shadowColor = 'rgba(255,255,240,0.9)';
        c.fillStyle = 'rgba(255,253,242,0.92)';
        c.fill();
        c.shadowBlur = 0;
        c.beginPath();
        c.ellipse(cx, y0 - 1.6, fw * 0.62, 2.1, 0, 0, 6.283);
        c.fillStyle = 'rgba(80,120,255,0.26)';
        c.fill();
        c.restore();
      }

      var sc = mix(70, 195, d);
      var j;
      for (j = 0; j < this.smoke.length; j++) {
        var q = this.smoke[j];
        var px = tipx + q.x;
        var py = tipy + q.y;
        var g2 = c.createRadialGradient(px, py, 0, px, py, q.r * 2);
        g2.addColorStop(0, rgba(sc, sc, sc + 4, q.a));
        g2.addColorStop(1, rgba(sc, sc, sc + 4, 0));
        c.fillStyle = g2;
        c.beginPath();
        c.arc(px, py, q.r * 2, 0, 6.283);
        c.fill();
      }
    }
  }

  O.candle = {
    create: function (canvas, scale) { return new Candle(canvas, scale); },
    Noise: Noise
  };
})(window);