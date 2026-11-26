/* 星图与历史（M5）
   以 F:\参考html\starmap-v3.html 与 session.html 为准：
   旋臂星盘展现历史会话，点选光点显示会话卡，可查看全篇或逐条回放。
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
  var selectedStar = null;
  var animId = 0;
  var rot = 0;
  var tilt = 0;
  var stars = [];
  var W = 0;
  var H = 0;
  var DPR = 1;
  var isDark = false;

  var replay = {
    running: false,
    timer: 0,
    curIdx: 0,
    totalDur: 1000
  };

  function count(v) { return v ? v.length : 0; }

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
  }

  /* 组织星群布局：按斐波那契螺旋盘铺放 */
  function layoutStars() {
    stars = [];
    var n = sessions.length;
    if (!n) { return; }
    var cx = W / 2;
    var cy = H / 2;
    var maxR = Math.min(W, H) * 0.42;

    var i;
    for (i = 0; i < n; i++) {
      var s = sessions[i];
      var idx = n - 1 - i; /* 最近的在靠外螺旋处 */
      var ratio = (idx + 1) / Math.max(n, 1);
      var theta = idx * 2.399963; /* 黄金角弧度 */
      var r = Math.sqrt(ratio) * maxR + 25;
      var size = Math.min(10, Math.max(3.5, Math.sqrt(s.msgCount || 1) * 2));
      var brightness = 0.35 + 0.65 * ((i + 1) / n);
      stars.push({
        sess: s,
        theta: theta,
        r: r,
        size: size,
        brightness: brightness,
        x: cx + Math.cos(theta) * r,
        y: cy + Math.sin(theta) * r * 0.72
      });
    }
  }

  function renderStarmap() {
    if (!refs || !refs.canvas) { return; }
    var ctx = refs.canvas.getContext('2d');
    ctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
    ctx.save();
    ctx.scale(DPR, DPR);

    isDark = doc.documentElement.classList.contains('dark');
    var inkRgb = isDark ? '244, 244, 246' : '18, 18, 20';
    var cx = W / 2;
    var cy = H / 2;

    /* 绘制螺旋臂星尘微粒背景 */
    ctx.beginPath();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)';
    ctx.lineWidth = 1;
    ctx.arc(cx, cy, Math.min(W, H) * 0.44, 0, Math.PI * 2);
    ctx.stroke();

    /* 绘制每个会话光点 */
    var i;
    for (i = 0; i < stars.length; i++) {
      var st = stars[i];
      var curAngle = st.theta + rot;
      var curX = cx + Math.cos(curAngle) * st.r;
      var curY = cy + Math.sin(curAngle) * st.r * (0.65 + tilt * 0.15);
      st.currX = curX;
      st.currY = curY;

      var isSel = selectedStar && selectedStar.sess.no === st.sess.no;
      var alpha = st.brightness;

      if (isSel) {
        /* 选中光环与脉动虚线 */
        ctx.beginPath();
        ctx.arc(curX, curY, st.size + 9, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? '#ffd166' : '#d99a26';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(curX, curY, st.size + 14, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? 'rgba(255, 209, 102, 0.35)' : 'rgba(217, 154, 38, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      /* 核心光点 */
      ctx.beginPath();
      ctx.arc(curX, curY, st.size, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? (isDark ? '#fff' : '#000') : ('rgba(' + inkRgb + ', ' + alpha + ')');
      ctx.fill();

      /* 柔和外晕 */
      ctx.beginPath();
      ctx.arc(curX, curY, st.size * 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + inkRgb + ', ' + (alpha * 0.2) + ')';
      ctx.fill();
    }

    ctx.restore();
  }

  function loop() {
    rot += 0.0012;
    renderStarmap();
    animId = win.requestAnimationFrame(loop);
  }

  /* 拖拽交互：旋转星盘 */
  function bindInteractions() {
    var cv = refs.canvas;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;

    function onDown(e) {
      dragging = true;
      lastX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      lastY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
    }

    function onMove(e) {
      if (!dragging) { return; }
      var curX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      var curY = e.clientY || (e.touches && e.touches[0] && e.touches[0].clientY) || 0;
      var dx = curX - lastX;
      var dy = curY - lastY;
      rot += dx * 0.006;
      tilt = Math.max(-0.6, Math.min(0.6, tilt + dy * 0.005));
      lastX = curX;
      lastY = curY;
    }

    function onUp(e) {
      if (!dragging) { return; }
      dragging = false;
      /* 检测点击目标光点 */
      var clientX = e.clientX || (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || 0;
      var clientY = e.clientY || (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) || 0;
      var rect = cv.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;

      var found = null;
      var i;
      for (i = 0; i < stars.length; i++) {
        var st = stars[i];
        var dist = Math.hypot(st.currX - x, st.currY - y);
        if (dist <= st.size + 16) {
          found = st;
          break;
        }
      }
      if (found) { selectSession(found); }
    }

    cv.addEventListener('pointerdown', onDown);
    win.addEventListener('pointermove', onMove);
    win.addEventListener('pointerup', onUp);
    cv.addEventListener('touchstart', onDown);
    win.addEventListener('touchmove', onMove);
    win.addEventListener('touchend', onUp);
  }

  function selectSession(st) {
    selectedStar = st;
    curSess = st.sess;
    refs.smCno.textContent = 'No.' + curSess.no;
    refs.smMeta.textContent = formatDate(curSess.startedAt);
    var dNames = curSess.decks ? (Array.isArray(curSess.decks) ? curSess.decks.join(' · ') : curSess.decks) : '牌堆';
    refs.smSub.textContent = '共 ' + (curSess.msgCount || 0) + ' 段 · ' + dNames;
    refs.smCard.hidden = false;
  }

  /* 渲染会话消息全览 / 回放 */
  function renderHistoryEvents(evList) {
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
    refs.sessTitle.textContent = '会话 No.' + curSess.no;
    refs.replayBar.hidden = true;
    O.ui.openOv(refs.ovSession, refs.sessClose);
    O.db.loadEvents(curSess.no).then(function (list) {
      events = list || [];
      renderHistoryEvents(events);
    });
  }

  function openReplay() {
    if (!curSess) { return; }
    refs.sessTitle.textContent = '重现回放 · No.' + curSess.no;
    refs.replayBar.hidden = false;
    O.ui.openOv(refs.ovSession, refs.sessClose);
    O.db.loadEvents(curSess.no).then(function (list) {
      events = list || [];
      startReplayTimeline();
    });
  }

  function startReplayTimeline() {
    replay.curIdx = 0;
    replay.running = true;
    refs.playBtn.textContent = '暂停';
    refs.sessHist.textContent = '';
    tickReplay();
  }

  function tickReplay() {
    if (!replay.running) { return; }
    if (replay.curIdx >= events.length) {
      replay.running = false;
      refs.playBtn.textContent = '重播';
      return;
    }
    var cur = events[replay.curIdx];
    var listSoFar = events.slice(0, replay.curIdx + 1);
    renderHistoryEvents(listSoFar);

    var ratio = (replay.curIdx + 1) / Math.max(events.length, 1);
    refs.fill.style.width = (ratio * 100) + '%';
    refs.knob.style.left = (ratio * 100) + '%';
    refs.clk.textContent = (replay.curIdx + 1) + '/' + events.length;

    replay.curIdx += 1;
    replay.timer = win.setTimeout(tickReplay, 1200);
  }

  function togglePlay() {
    if (replay.running) {
      replay.running = false;
      win.clearTimeout(replay.timer);
      refs.playBtn.textContent = '播放';
    } else {
      if (replay.curIdx >= events.length) { replay.curIdx = 0; }
      replay.running = true;
      refs.playBtn.textContent = '暂停';
      tickReplay();
    }
  }

  function open() {
    resize();
    return O.db.loadSessions().then(function (res) {
      sessions = res || [];
      layoutStars();
      if (sessions.length === 0) {
        refs.empty.hidden = false;
      } else {
        refs.empty.hidden = true;
      }
      if (!animId) { loop(); }
    });
  }

  function close() {
    if (animId) {
      win.cancelAnimationFrame(animId);
      animId = 0;
    }
  }

  function mount(r) {
    refs = r;
    resize();
    bindInteractions();
    win.addEventListener('resize', resize);

    refs.cardClose.addEventListener('click', function () {
      refs.smCard.hidden = true;
      selectedStar = null;
    });

    refs.btnView.addEventListener('click', openView);
    refs.btnReplay.addEventListener('click', openReplay);

    refs.sessClose.addEventListener('click', function () {
      replay.running = false;
      win.clearTimeout(replay.timer);
      O.ui.closeOv(refs.ovSession);
    });

    refs.playBtn.addEventListener('click', togglePlay);
  }

  O.starmap = {
    mount: mount,
    open: open,
    close: close
  };
})(window);