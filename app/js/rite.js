/* =====================================================================
   显影 · 传讯字卡（WHISPER CARDS）—— 灵息连结仪式（静心叩问 + 调频测定）
   纯 ES5 实现，兼容 Chrome 61。
   每次点起新蜡烛时触发，收集【心念所向】、【寄语一言】、【溯念心印】，
   并在 2~15 秒纯随机扫描中模拟宿位调频与灵息相契，将羁绊带入新会话。
   ===================================================================== */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  var riteEl = null;
  var fName = null;
  var fWord = null;
  var fNote = null;
  var tip = null;
  var pDate = null;
  var rWho = null;
  var dWho = null;
  var rPct = null;
  var rBar = null;
  var rState = null;
  var enterBtn = null;
  var cv = null;
  var cx = null;

  var onCompleteCallback = null;
  var info = null;

  var W = 0;
  var H = 0;
  var raf = 0;
  var R = null;
  var timers = [];

  var TAU = Math.PI * 2;
  var FONT_NUM = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  var FONT_CJK = '"Songti SC", "Noto Serif SC", "SimSun", serif';

  var POOLS = [
    ['凝神 · 灵息初萌', '杂音满溢，心念渐定', '叩问已出，回声未至', '静候 · 虚空微澜'],
    ['心念穿透虚空……', '宿位对齐中', '灵息共振 · 似有回应', '远处有人，轻轻应了一声', '杂音渐退，频率渐近'],
    ['宿位对齐 · 回声渐近', '灵息相契 · 将要显影', '连结澄澈', '一线清明，正在合拢']
  ];

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function later(fn, ms) {
    var id = win.setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearRiteTimers() {
    var i;
    for (i = 0; i < timers.length; i++) { win.clearTimeout(timers[i]); }
    timers = [];
  }

  function updateDate() {
    if (!pDate) { return; }
    var STEMS = '甲乙丙丁戊己庚辛壬癸';
    var BRANCH = '子丑寅卯辰巳午未申酉戌亥';
    var now0 = new Date();
    var y = now0.getFullYear();
    var gz = STEMS[(y - 4) % 10] + BRANCH[(y - 4) % 12];
    var seasons = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];
    var season = seasons[now0.getMonth()];
    pDate.textContent = gz + '年 · ' + season;
  }

  function fit() {
    if (!cv) { return; }
    var dpr = Math.min(2, win.devicePixelRatio || 1);
    W = cv.clientWidth;
    H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setState(txt, instant) {
    if (!rState) { return; }
    if (instant) {
      rState.textContent = txt;
      rState.classList.remove('fade');
      return;
    }
    rState.classList.add('fade');
    later(function () {
      rState.textContent = txt;
      rState.classList.remove('fade');
    }, 600);
  }

  function burst() {
    if (!R || !R.focus) { return; }
    var i;
    for (i = 0; i < 56; i++) {
      var ang = rand(0, TAU);
      var sp = rand(40, 240);
      R.sparks.push({
        x: R.focus.x,
        y: R.focus.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp * 0.8,
        r: rand(0.7, 1.8),
        age: 0,
        life: rand(0.6, 1.7),
        col: i % 2 ? [255, 232, 204] : [204, 220, 255]
      });
    }
  }

  function loop(now) {
    if (!R) { return; }
    var dt = Math.min(0.05, (now - R.last) / 1000);
    R.last = now;
    var t = (now - R.t0) / 1000;
    var p = Math.min(1, (now - R.t0) / R.dur);
    var sm = p * p * (3 - 2 * p);

    var span = Math.min(W * 0.86, 780);
    var x0 = W / 2 - span / 2;
    var cy = H * 0.4;
    var SP = Math.min(60, H * 0.09);
    var dialY = cy + SP + 34;
    var T = R.T;
    var xT = x0 + T * span;
    R.focus = { x: xT, y: cy - SP * 0.4 };

    /* 达到 100% 连结成功时序 */
    if (p >= 1 && !R.endAt) {
      R.endAt = now;
      setState('连结澄澈 · 宿位已合');
      var dw = riteEl.querySelector('.dawn');
      if (dw) {
        dw.style.left = xT + 'px';
        dw.style.top = cy + 'px';
      }
      later(function () { burst(); }, 520);
      later(function () { riteEl.setAttribute('data-step', 'dawn'); }, 1400);
      later(function () {
        riteEl.setAttribute('data-step', 'done');
        if (enterBtn && enterBtn.focus) { enterBtn.focus(); }
      }, 3100);
      later(function () {
        if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
      }, 3300);
    }

    if (!R.endAt && now > R.nextState) {
      var pool = POOLS[p < 0.34 ? 0 : (p < 0.72 ? 1 : 2)];
      var s = pick(pool);
      setState(s);
      R.nextState = now + rand(1500, 2800);
    }

    var val = 0;
    if (R.endAt) {
      val = 100;
    } else {
      var base = 100 * (1 - Math.pow(1 - p, 2.1)) * 0.96;
      var jit = (3.2 * Math.sin(t * 1.7) + 1.8 * Math.sin(t * 4.3 + 1)) * (1 - p * 0.6);
      val = Math.max(1, Math.min(99, base + jit + 2));
    }
    var vi = Math.round(val);
    if (vi !== R.shown) {
      R.shown = vi;
      if (rPct) { rPct.textContent = vi; }
      if (rBar) { rBar.style.width = vi + '%'; }
    }

    var A0 = Math.min(0.96 - T, T - 0.04);
    var amp = A0 * Math.pow(1 - sm, 1.4);
    var u = T + R.sign * amp * Math.cos(p * R.cycles * TAU);
    if (!R.endAt) {
      u += (0.012 * Math.sin(t * 6.1) + 0.007 * Math.sin(t * 13.3)) * (1 - sm);
    }
    u = Math.max(0.03, Math.min(0.97, u));
    var prox = Math.exp(-Math.pow((u - T) / 0.1, 2));
    var L = R.endAt ? 1 : Math.pow(sm, 1.15) * (0.82 + 0.18 * prox);

    var e = R.endAt ? (now - R.endAt) / 1000 : -1;
    var flare = e >= 0.4 ? Math.max(0, 1 - Math.abs(e - 0.65) / 0.45) : 0;

    cx.clearRect(0, 0, W, H);

    /* 环境微光 */
    cx.globalCompositeOperation = 'lighter';
    var g = cx.createRadialGradient(W / 2, cy, 0, W / 2, cy, Math.max(span * 0.6, 220));
    g.addColorStop(0, 'rgba(230,232,255,' + (0.03 + 0.06 * L + flare * 0.1) + ')');
    g.addColorStop(1, 'rgba(230,232,255,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
    cx.globalCompositeOperation = 'source-over';

    /* 频谱 */
    var N = Math.max(60, Math.min(150, Math.floor(span / 6)));
    if (!R.bars || R.bars.length !== N) {
      R.bars = [];
      for (var bIdx = 0; bIdx < N; bIdx++) { R.bars.push(Math.random()); }
    }
    var noiseAmp = (1 - L) * SP * 0.64 + SP * 0.03;
    var dk = 1 - 0.5 * L;
    cx.lineCap = 'round';
    cx.lineWidth = 1.2;
    var i;
    for (i = 0; i < N; i++) {
      var ui = (i + 0.5) / N;
      var bx = x0 + ui * span;
      R.bars[i] += (Math.random() - R.bars[i]) * 0.3;
      var h = noiseAmp * (0.22 + R.bars[i] * 0.78) * (0.5 + 0.5 * Math.sin(Math.PI * ui));
      var st = 0;
      var d;
      for (var di = 0; di < R.decoys.length; di++) {
        d = R.decoys[di];
        st += d.h * SP * dk * Math.exp(-Math.pow((ui - d.x) / d.w, 2));
      }
      var tgt = SP * (0.12 + 0.88 * Math.pow(L, 0.9)) * (1 + 0.12 * flare);
      st += tgt * Math.exp(-Math.pow((ui - T) / (0.014 + 0.01 * L), 2));
      h = Math.max(1, h + st);
      var near = Math.exp(-Math.pow((ui - u) / 0.045, 2));
      var tm = Math.exp(-Math.pow((ui - T) / 0.05, 2)) * L;
      var a = Math.min(1, 0.14 + 0.5 * near + (st / SP) * 0.32 + 0.2 * flare * tm);
      cx.strokeStyle = 'rgba(' + Math.floor(232 + 23 * tm) + ',' + Math.floor(236 - 4 * tm) + ',' + Math.floor(250 - 46 * tm) + ',' + a + ')';
      cx.beginPath();
      cx.moveTo(bx, cy - h);
      cx.lineTo(bx, cy + h);
      cx.stroke();
    }
    cx.strokeStyle = 'rgba(241,241,243,.14)';
    cx.lineWidth = 0.8;
    cx.beginPath();
    cx.moveTo(x0, cy);
    cx.lineTo(x0 + span, cy);
    cx.stroke();

    /* 刻度盘 */
    cx.strokeStyle = 'rgba(241,241,243,.26)';
    cx.lineWidth = 0.8;
    cx.beginPath();
    cx.moveTo(x0, dialY);
    cx.lineTo(x0 + span, dialY);
    cx.stroke();
    cx.font = '11px ' + FONT_NUM;
    cx.textAlign = 'center';
    cx.textBaseline = 'top';
    var k;
    for (k = 0; k <= 40; k++) {
      var uk = k / 40;
      var xk = x0 + uk * span;
      var longLine = k % 4 === 0;
      var midLine = k % 2 === 0;
      var nk = Math.exp(-Math.pow((uk - u) / 0.035, 2));
      cx.strokeStyle = 'rgba(241,241,243,' + ((longLine ? 0.5 : 0.3) + 0.45 * nk) + ')';
      cx.beginPath();
      cx.moveTo(xk, dialY);
      cx.lineTo(xk, dialY + (longLine ? 13 : (midLine ? 8 : 5)));
      cx.stroke();
      if (k % 8 === 0) {
        cx.fillStyle = 'rgba(241,241,243,' + (0.36 + 0.4 * nk) + ')';
        cx.fillText(String(88 + k / 2), xk, dialY + 20);
      }
    }

    /* 指针 */
    var xN = x0 + u * span;
    var nTop = cy - SP - 14;
    var nBot = dialY + 16;
    var nc = [Math.floor(255 - 23 * L), Math.floor(250 - 20 * L), 240];
    cx.globalCompositeOperation = 'lighter';
    cx.strokeStyle = 'rgba(' + nc[0] + ',' + nc[1] + ',' + nc[2] + ',' + (0.07 + 0.08 * L + flare * 0.2) + ')';
    cx.lineWidth = 9;
    cx.beginPath();
    cx.moveTo(xN, nTop);
    cx.lineTo(xN, nBot);
    cx.stroke();
    cx.globalCompositeOperation = 'source-over';
    cx.strokeStyle = 'rgba(' + nc[0] + ',' + nc[1] + ',' + nc[2] + ',.95)';
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(xN, nTop);
    cx.lineTo(xN, nBot);
    cx.stroke();
    cx.fillStyle = 'rgba(' + nc[0] + ',' + nc[1] + ',' + nc[2] + ',.95)';
    cx.beginPath();
    cx.moveTo(xN - 4.5, nTop - 8);
    cx.lineTo(xN + 4.5, nTop - 8);
    cx.lineTo(xN, nTop - 1);
    cx.closePath();
    cx.fill();

    /* 频率大读数 */
    var fVal = 88 + u * 20;
    cx.textBaseline = 'middle';
    cx.textAlign = 'center';
    cx.font = '200 40px ' + FONT_NUM;
    var ft = fVal.toFixed(1);
    var fw = cx.measureText(ft).width;
    var numY = cy - SP - 58;
    cx.fillStyle = 'rgba(241,241,243,' + (0.5 + 0.45 * L) + ')';
    cx.fillText(ft, W / 2, numY);
    cx.font = '11px ' + FONT_NUM;
    cx.textAlign = 'left';
    cx.fillStyle = 'rgba(241,241,243,.42)';
    cx.fillText('MHz', W / 2 + fw / 2 + 8, numY + 8);

    /* 对方称谓显影 */
    var la = clamp01((L - 0.82) / 0.16);
    if (la > 0 && info && info.name) {
      var peak = SP * (1 + 0.12 * flare);
      var ty = cy - peak - 20;
      cx.globalAlpha = la;
      cx.strokeStyle = 'rgba(241,241,243,.5)';
      cx.lineWidth = 0.8;
      cx.beginPath();
      cx.moveTo(xT, ty + 9);
      cx.lineTo(xT, ty + 17);
      cx.stroke();
      cx.font = '13px ' + FONT_CJK;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillStyle = 'rgba(255,244,228,.95)';
      var nm = info.name.length > 8 ? info.name.slice(0, 8) + '…' : info.name;
      cx.fillText(nm, xT, ty);
      cx.globalAlpha = 1;
    }

    /* 火花飞散 */
    cx.globalCompositeOperation = 'lighter';
    var nextSparks = [];
    for (i = 0; i < R.sparks.length; i++) {
      var sItem = R.sparks[i];
      sItem.age += dt;
      if (sItem.age < sItem.life) {
        var px = sItem.x;
        var py = sItem.y;
        sItem.vx *= 0.975;
        sItem.vy *= 0.975;
        sItem.x += sItem.vx * dt;
        sItem.y += sItem.vy * dt;
        var sa = Math.pow(1 - sItem.age / sItem.life, 1.4);
        cx.strokeStyle = 'rgba(' + sItem.col[0] + ',' + sItem.col[1] + ',' + sItem.col[2] + ',' + (sa * 0.6) + ')';
        cx.lineWidth = sItem.r * 0.8;
        cx.beginPath();
        cx.moveTo(px, py);
        cx.lineTo(sItem.x, sItem.y);
        cx.stroke();
        cx.fillStyle = 'rgba(255,255,255,' + sa + ')';
        cx.beginPath();
        cx.arc(sItem.x, sItem.y, sItem.r, 0, TAU);
        cx.fill();
        nextSparks.push(sItem);
      }
    }
    R.sparks = nextSparks;
    cx.globalCompositeOperation = 'source-over';

    raf = win.requestAnimationFrame(loop);
  }

  function startRes() {
    stopRes();
    fit();
    var t0 = (win.performance && win.performance.now) ? win.performance.now() : Date.now();
    var T = rand(0.3, 0.7);
    var decoys = [];
    var guard = 0;
    while (decoys.length < 3 && guard++ < 200) {
      var x = rand(0.07, 0.93);
      if (Math.abs(x - T) > 0.14) {
        decoys.push({ x: x, h: rand(0.16, 0.34), w: rand(0.009, 0.015) });
      }
    }
    /* 2~15 秒纯随机 */
    var dur = rand(2000, 15000);
    R = {
      t0: t0,
      last: t0,
      dur: dur,
      T: T,
      sign: Math.random() < 0.5 ? 1 : -1,
      cycles: 1.6 + (dur / 1000) * 0.14,
      decoys: decoys,
      endAt: 0,
      shown: -1,
      nextState: t0 + 1500,
      bars: null,
      sparks: [],
      focus: null
    };
    if (rPct) { rPct.textContent = '0'; }
    if (rBar) { rBar.style.width = '0%'; }
    setState('凝神 · 灵息初萌', true);
    raf = win.requestAnimationFrame(loop);
  }

  function stopRes() {
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
    R = null;
    clearRiteTimers();
  }

  function openRite(onComplete) {
    onCompleteCallback = onComplete;
    if (fName) { fName.value = ''; }
    if (fWord) { fWord.value = ''; }
    if (fNote) { fNote.value = ''; }
    var fold = doc.getElementById('fold');
    if (fold) { fold.classList.remove('open'); }
    var foldBtn = doc.getElementById('foldBtn');
    if (foldBtn) { foldBtn.setAttribute('aria-expanded', 'false'); }
    if (tip) {
      tip.textContent = '心意写下，频率自明';
      tip.classList.remove('warn');
    }
    updateDate();
    if (riteEl) {
      riteEl.setAttribute('data-step', 'ask');
      riteEl.classList.add('open');
    }
    win.setTimeout(function () {
      if (fName && fName.focus) { try { fName.focus(); } catch (e) { /* ignore */ } }
    }, 450);
  }

  function closeRite() {
    if (riteEl) { riteEl.classList.remove('open'); }
    stopRes();
  }

  function ignite() {
    var name = fName ? fName.value.replace(/^\s+|\s+$/g, '') : '';
    if (!name) {
      if (tip) {
        tip.textContent = '请先写下心念所向';
        tip.classList.add('warn');
      }
      var p = doc.getElementById('paper');
      if (p) {
        p.classList.remove('shake');
        void p.offsetWidth;
        p.classList.add('shake');
      }
      if (fName) { fName.focus(); }
      return;
    }
    info = {
      name: name,
      word: fWord ? fWord.value.replace(/^\s+|\s+$/g, '') : '',
      note: fNote ? fNote.value.replace(/^\s+|\s+$/g, '') : ''
    };
    if (rWho) { rWho.textContent = name; }
    if (dWho) { dWho.textContent = '与 ' + name; }
    if (riteEl) { riteEl.setAttribute('data-step', 'light'); }
    startRes();
  }

  function mount() {
    riteEl = doc.getElementById('rite');
    fName = doc.getElementById('fName');
    fWord = doc.getElementById('fWord');
    fNote = doc.getElementById('fNote');
    tip = doc.getElementById('tip');
    pDate = doc.getElementById('pDate');
    rWho = doc.getElementById('rWho');
    dWho = doc.getElementById('dWho');
    rPct = doc.getElementById('rPct');
    rBar = doc.getElementById('rBar');
    rState = doc.getElementById('rState');
    enterBtn = doc.getElementById('enterBtn');
    cv = doc.getElementById('flame');
    if (cv) { cx = cv.getContext('2d'); }

    var riteClose = doc.getElementById('riteClose');
    if (riteClose) { riteClose.addEventListener('click', closeRite); }
    var rCancel = doc.getElementById('rCancel');
    if (rCancel) { rCancel.addEventListener('click', closeRite); }

    var chips = doc.getElementById('chips');
    if (chips) {
      chips.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'BUTTON') {
          e.preventDefault();
          if (fName) {
            fName.value = e.target.textContent;
            fName.focus();
          }
        }
      });
    }

    var foldBtn = doc.getElementById('foldBtn');
    if (foldBtn) {
      foldBtn.addEventListener('click', function () {
        var fold = doc.getElementById('fold');
        if (!fold) { return; }
        var o = !fold.classList.contains('open');
        fold.classList.toggle('open', o);
        foldBtn.setAttribute('aria-expanded', String(o));
        if (o && fNote) {
          win.setTimeout(function () { fNote.focus(); }, 200);
        }
      });
    }

    var igniteBtn = doc.getElementById('igniteBtn');
    if (igniteBtn) { igniteBtn.addEventListener('click', ignite); }

    if (fName) {
      fName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); ignite(); }
      });
    }
    if (fWord) {
      fWord.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); ignite(); }
      });
    }

    if (enterBtn) {
      enterBtn.addEventListener('click', function () {
        closeRite();
        if (onCompleteCallback) {
          onCompleteCallback(info || { name: '彼方', word: '', note: '' });
        }
      });
    }

    win.addEventListener('resize', function () {
      if (R) { fit(); }
    });
  }

  O.rite = {
    mount: mount,
    open: openRite,
    close: closeRite
  };
})(window);
