/* 星图与历史（M5）
   以 F:\参考html\starmap-v3.html 与 session.html 为准：
   全透明星空、旋臂星盘粒子、手势旋转倾斜、点选光点聚焦并弹出会话卡，支持全篇阅读与回放重现。
   基线 Chrome 61。数据来自 Oracle.db.loadSessions 与 loadEvents。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;
  var el = O.ui.el;

  var refs = null;
  var sessions = [];
  var curSess = null;
  var events = [];
  var sel = -1;
  var hover = -1;
  var animId = 0;
  var ticking = false;

  var W = 0;
  var H = 0;
  var DPR = 1;
  var G = { cx: 0, cy: 0, rx: 0, ry: 0 };

  /* 物理与视角 */
  var rot = 0;
  var vel = 0;
  var tilt = 0;
  var tiltT = 0;
  var cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 };
  var lastTs = 0;

  var ST = [];   /* 会话恒星模型 */
  var P = [];    /* 旋臂星尘粒子 */
  var TMP = { x: 0, y: 0 };

  var replay = {
    running: false,
    timer: 0,
    curIdx: 0
  };

  /* 伪随机数（保证星盘粒子一致） */
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function formatDate(ts) {
    if (!ts) { return ''; }
    var d = new Date(ts);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var hr = d.getHours();
    var min = d.getMinutes();
    return y + '.' + (m < 10 ? '0' : '') + m + '.' + (day < 10 ? '0' : '') + day + ' ' + (hr < 10 ? '0' : '') + hr + ':' + (min < 10 ? '0' : '') + min;
  }

  function resize() {
    if (!refs || !refs.canvas) { return; }
    var stage = refs.canvas.parentElement;
    W = stage.clientWidth || 360;
    H = stage.clientHeight || 540;
    DPR = Math.min(win.devicePixelRatio || 1, 2);
    refs.canvas.width = Math.round(W * DPR);
    refs.canvas.height = Math.round(H * DPR);
    refs.canvas.style.width = W + 'px';
    refs.canvas.style.height = H + 'px';

    G.cx = W / 2;
    G.cy = H / 2;
    G.rx = Math.min(W - 48, 520) / 2;
    G.ry = Math.min(H * 0.44, G.rx * 1.4);
  }

  /* 旋臂数学公式（来自 starmap-v3.html） */
  function spiralA(u, k) { return -1.9 + u * k; }
  function spiralR(u) { return 0.08 + 0.92 * Math.sqrt(u); }

  function buildModel() {
    var N = sessions.length;
    var k = N > 1 ? (N - 1) * 0.58 : 8;
    ST = [];
    var i;
    for (i = 0; i < N; i++) {
      var s = sessions[i];
      var u = N > 1 ? (N - 1 - i) / (N - 1) : 0;
      var r = spiralR(u);
      var a = spiralA(u, k);
      var size = Math.min(8, Math.max(3.2, Math.sqrt(s.msgCount || 1) * 1.8));
      var brightness = 0.35 + 0.65 * ((i + 1) / N);
      ST.push({
        sess: s,
        r: r,
        a: a,
        size: size,
        brightness: brightness,
        spike: (s.msgCount || 0) >= 15,
        sx: 0,
        sy: 0
      });
    }

    /* 旋臂背景星尘粒子（数百颗柔和微光星屑） */
    var rng = mulberry(4402);
    P = [];
    var count = Math.min(480, Math.round(W * H / 700));
    for (i = 0; i < count; i++) {
      var pu = Math.pow(rng(), 0.85);
      var arm = i % 2;
      var pr = spiralR(pu) + (rng() - 0.5) * 0.06;
      var pa = spiralA(pu, k) + arm * Math.PI + (rng() - 0.5) * 0.22;
      P.push({
        r: Math.max(0.04, pr),
        a: pa,
        size: 0.6 + rng() * 1.2,
        alpha: (0.15 + rng() * 0.4) * (1 - pu * 0.45)
      });
    }
  }

  /* 星系坐标映射到屏幕坐标 */
  function worldToScreen(r, a, out) {
    var curA = a + rot;
    var cos = Math.cos(curA);
    var sin = Math.sin(curA);
    var tk = 1 - Math.abs(tilt) * 0.4;
    var wx = G.cx + cos * r * G.rx;
    var wy = G.cy + sin * r * G.ry * tk + tilt * G.ry * 0.25;

    /* 摄像机变换 */
    out.x = cam.x + (wx - cam.tx) * cam.z;
    out.y = cam.y + (wy - cam.ty) * cam.z;
    return out;
  }

  function drawStarmap() {
    if (!refs || !refs.canvas) { return; }
    var ctx = refs.canvas.getContext('2d');
    ctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
    ctx.save();
    ctx.scale(DPR, DPR);

    var isDark = doc.documentElement.classList.contains('dark');
    var inkRgb = isDark ? '244, 244, 246' : '18, 18, 20';
    var gold = isDark ? '#ffd166' : '#c98a1a';
    var goldAlpha = isDark ? 'rgba(255, 209, 102, ' : 'rgba(201, 138, 26, ';

    /* 1. 绘制环境旋臂星尘粒子 */
    var i;
    for (i = 0; i < P.length; i++) {
      var p = P[i];
      worldToScreen(p.r, p.a, TMP);
      ctx.beginPath();
      ctx.arc(TMP.x, TMP.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + inkRgb + ', ' + p.alpha + ')';
      ctx.fill();
    }

    /* 2. 绘制会话光点 */
    for (i = 0; i < ST.length; i++) {
      var s = ST[i];
      worldToScreen(s.r, s.a, TMP);
      s.sx = TMP.x;
      s.sy = TMP.y;

      var isSel = (i === sel);
      var isHov = (i === hover);

      if (isSel) {
        /* 选中光点：外圈微动虚线光环与星晕 */
        ctx.beginPath();
        ctx.arc(s.sx, s.sy, s.size + 10, 0, Math.PI * 2);
        ctx.strokeStyle = gold;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.sx, s.sy, s.size + 16, 0, Math.PI * 2);
        ctx.strokeStyle = goldAlpha + '0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      /* 外层呼吸光晕 */
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, isSel ? s.size * 2.8 : s.size * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? (goldAlpha + '0.2)') : ('rgba(' + inkRgb + ', ' + (s.brightness * 0.16) + ')');
      ctx.fill();

      /* 核心亮核 */
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, s.size, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? (isDark ? '#fff' : '#000') : ('rgba(' + inkRgb + ', ' + s.brightness + ')');
      ctx.fill();

      /* 大场次光芒十字星芒（Spike） */
      if (s.spike && (isSel || isHov)) {
        ctx.beginPath();
        ctx.moveTo(s.sx - s.size * 2.5, s.sy);
        ctx.lineTo(s.sx + s.size * 2.5, s.sy);
        ctx.moveTo(s.sx, s.sy - s.size * 2.5);
        ctx.lineTo(s.sx, s.sy + s.size * 2.5);
        ctx.strokeStyle = goldAlpha + '0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function frame(ts) {
    if (doc.hidden) { ticking = false; return; }
    var dt = lastTs ? Math.min(ts - lastTs, 64) : 16;
    lastTs = ts;

    /* 物理惯性旋转 */
    rot += vel * dt + 0.00035;
    vel *= Math.exp(-dt / 800);
    tilt += (tiltT - tilt) * Math.min(1, dt / 240);

    /* 摄像机平滑跟踪焦点 */
    var targetZ = (sel >= 0) ? 1.35 : 1;
    var targetTx = (sel >= 0) ? (G.cx + (ST[sel].sx - G.cx) * 0.5) : G.cx;
    var targetTy = (sel >= 0) ? (G.cy + (ST[sel].sy - G.cy) * 0.5) : G.cy;

    cam.z += (targetZ - cam.z) * Math.min(1, dt / 350);
    cam.tx += (targetTx - cam.tx) * Math.min(1, dt / 350);
    cam.ty += (targetTy - cam.ty) * Math.min(1, dt / 350);
    cam.x = G.cx;
    cam.y = G.cy;

    drawStarmap();
    animId = win.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (!ticking) {
      ticking = true;
      lastTs = 0;
      animId = win.requestAnimationFrame(frame);
    }
  }

  function stopLoop() {
    if (animId) {
      win.cancelAnimationFrame(animId);
      animId = 0;
      ticking = false;
    }
  }

  /* 拖拽交互：手势旋转星盘与点选 */
  function bindInteractions() {
    if (!refs || !refs.canvas) { return; }
    var cv = refs.canvas;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    var moved = 0;

    function onDown(e) {
      dragging = true;
      moved = 0;
      lastX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      lastY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
      vel = 0;
    }

    function onMove(e) {
      if (!dragging) { return; }
      var curX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      var curY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
      var dx = curX - lastX;
      var dy = curY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);

      rot += dx * 0.005;
      vel = dx * 0.0003;
      tiltT = Math.max(-0.55, Math.min(0.55, tiltT + dy * 0.004));

      lastX = curX;
      lastY = curY;
    }

    function onUp(e) {
      if (!dragging) { return; }
      dragging = false;

      /* 未发生大幅拖动时判定为点击选中 */
      if (moved < 8) {
        var clientX = e.clientX || (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || 0;
        var clientY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : e.clientY;
        var rect = cv.getBoundingClientRect();
        var x = clientX - rect.left;
        var y = clientY - rect.top;

        var nearestIdx = -1;
        var minD = 44;
        var i;
        for (i = 0; i < ST.length; i++) {
          var s = ST[i];
          var d = Math.hypot(s.sx - x, s.sy - y);
          if (d < minD) {
            minD = d;
            nearestIdx = i;
          }
        }
        if (nearestIdx >= 0) {
          selectSession(nearestIdx);
        } else {
          closeCard();
        }
      }
    }

    cv.addEventListener('pointerdown', onDown);
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    cv.addEventListener('touchstart', onDown);
    win.addEventListener('touchmove', onMove);
    win.addEventListener('touchend', onUp);
  }

  function selectSession(idx) {
    sel = idx;
    var s = ST[idx];
    curSess = s.sess;

    var cno = refs.cno || refs.smCno || win.document.getElementById('smCno');
    var meta = refs.meta || refs.smMeta || win.document.getElementById('smMeta');
    var msg = refs.msg || refs.smMsg || win.document.getElementById('smMsg');
    var deck = refs.deck || refs.smDeck || win.document.getElementById('smDeck');
    var card = refs.card || refs.smCard || win.document.getElementById('smCard');

    if (cno) { cno.textContent = curSess.no; }
    if (meta) { meta.textContent = formatDate(curSess.startedAt); }
    if (msg) { msg.textContent = '共 ' + (curSess.msgCount || 0) + ' 段'; }
    var dNames = curSess.decks ? (Array.isArray(curSess.decks) ? curSess.decks.join(' · ') : curSess.decks) : '字卡';
    if (deck) { deck.textContent = dNames; }

    if (card) {
      card.hidden = false;
      /* 强制重绘后加 on 类触发丝滑平移上浮 */
      void card.offsetHeight;
      card.classList.add('on');
    }
  }

  function closeCard() {
    sel = -1;
    var card = refs.card || refs.smCard;
    if (card) {
      card.classList.remove('on');
      win.setTimeout(function () {
        if (sel === -1) { card.hidden = true; }
      }, 650);
    }
  }

  /* 会话消息渲染（全览与回放） */
  function renderHistoryEvents(evList) {
    if (!refs.sessHist) { return; }
    refs.sessHist.textContent = '';
    var i;
    for (i = 0; i < evList.length; i++) {
      var ev = evList[i];
      var seg = el('div', 'ch-seg' + (ev.who === 'me' ? ' me' : ''));
      if (ev.who === 'me') {
        var tb = el('div', 'ch-t');
        tb.appendChild(el('span', 'ch-w', ev.text || ''));
        seg.appendChild(tb);
      } else {
        var band = el('div', 'ch-o');
        var row = el('div', 'ch-row');
        var cards = ev.cards || [];
        var j;
        for (j = 0; j < cards.length; j++) {
          var c = cards[j];
          var it = el('div', 'ch-it' + (c.kind === 'tarot' ? ' tf' : ''));
          if (c.kind === 'tarot') {
            if (c.num && c.num !== c.name) { it.appendChild(el('span', 'tn', c.num)); }
            it.appendChild(el('span', 'nm', c.name || ''));
            it.appendChild(el('span', 'kw', c.side === 'reversed' ? c.reversed : c.upright));
          } else if (c.image) {
            var img = doc.createElement('img');
            img.src = c.image;
            it.appendChild(img);
          } else if (c.kind === 'gift') {
            if (O.giftCard) { it.appendChild(O.giftCard.create(c)); }
          }
          row.appendChild(it);
        }
        band.appendChild(row);
        seg.appendChild(band);
      }
      seg.appendChild(el('span', 'ch-tm', formatDate(ev.at)));
      refs.sessHist.appendChild(seg);
    }
  }

  function openView() {
    if (!curSess) { return; }
    if (refs.sessTitle) { refs.sessTitle.textContent = '会话 No.' + curSess.no; }
    if (refs.replayBar) { refs.replayBar.hidden = true; }
    O.ui.openOv(refs.ovSession, refs.sessClose);
    O.db.loadEvents(curSess.no).then(function (list) {
      events = list || [];
      renderHistoryEvents(events);
    });
  }

  function openReplay() {
    if (!curSess) { return; }
    if (refs.sessTitle) { refs.sessTitle.textContent = '重现回放 · No.' + curSess.no; }
    if (refs.replayBar) { refs.replayBar.hidden = false; }
    O.ui.openOv(refs.ovSession, refs.sessClose);
    O.db.loadEvents(curSess.no).then(function (list) {
      events = list || [];
      startReplayTimeline();
    });
  }

  function startReplayTimeline() {
    replay.curIdx = 0;
    replay.running = true;
    if (refs.playBtn) { refs.playBtn.textContent = '暂停'; }
    if (refs.sessHist) { refs.sessHist.textContent = ''; }
    tickReplay();
  }

  function tickReplay() {
    if (!replay.running) { return; }
    if (replay.curIdx >= events.length) {
      replay.running = false;
      if (refs.playBtn) { refs.playBtn.textContent = '重播'; }
      return;
    }
    var listSoFar = events.slice(0, replay.curIdx + 1);
    renderHistoryEvents(listSoFar);

    var ratio = (replay.curIdx + 1) / Math.max(events.length, 1);
    if (refs.fill) { refs.fill.style.width = (ratio * 100) + '%'; }
    if (refs.knob) { refs.knob.style.left = (ratio * 100) + '%'; }
    if (refs.clk) { refs.clk.textContent = (replay.curIdx + 1) + '/' + events.length; }

    replay.curIdx += 1;
    replay.timer = win.setTimeout(tickReplay, 1200);
  }

  function togglePlay() {
    if (replay.running) {
      replay.running = false;
      win.clearTimeout(replay.timer);
      if (refs.playBtn) { refs.playBtn.textContent = '播放'; }
    } else {
      if (replay.curIdx >= events.length) { replay.curIdx = 0; }
      replay.running = true;
      if (refs.playBtn) { refs.playBtn.textContent = '暂停'; }
      tickReplay();
    }
  }

  function open() {
    resize();
    return O.db.loadSessions().then(function (res) {
      sessions = res || [];
      buildModel();

      var cnt = refs.cnt || refs.smCnt || win.document.getElementById('smCnt');
      if (cnt) { cnt.textContent = '共 ' + sessions.length + ' 场会话'; }

      var empty = refs.empty || refs.smEmpty;
      if (empty) { empty.hidden = (sessions.length > 0); }

      startLoop();
    });
  }

  function close() {
    stopLoop();
    closeCard();
  }

  function mount(r) {
    refs = r;
    if (!refs || !refs.canvas) { return; }
    resize();
    bindInteractions();
    win.addEventListener('resize', resize);

    var cardClose = refs.cardClose || refs.smCardClose;
    if (cardClose) { cardClose.addEventListener('click', closeCard); }

    var btnView = refs.btnView || refs.smBtnView;
    if (btnView) { btnView.addEventListener('click', openView); }

    var btnReplay = refs.btnReplay || refs.smBtnReplay;
    if (btnReplay) { btnReplay.addEventListener('click', openReplay); }

    if (refs.sessClose) {
      refs.sessClose.addEventListener('click', function () {
        replay.running = false;
        win.clearTimeout(replay.timer);
        if (refs.ovSession) { O.ui.closeOv(refs.ovSession); }
      });
    }

    if (refs.playBtn) { refs.playBtn.addEventListener('click', togglePlay); }
  }

  O.starmap = {
    mount: mount,
    open: open,
    close: close
  };
})(window);