/* 设置页
   六节：连接 / 牌堆 / 语气 / 显示 / 数据 / 关于。P3 只做了后四节，
   M3 引擎定型后把前两节补上——它们全是引擎真在用的参数（时间窗 / 沉默 / 卡数量 / 事件概率）。
   视觉以 F:\参考html\settings.html 为准；
   参考稿里的 .demo 状态行、#state 切换、history.replaceState / hashchange 一律不进来。
   控件（开关 / 分段 / 折叠 / 按住确认）全部来自 Oracle.ui，本文件只负责排版与接数据。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  /* 产品名（2026-11-26 定）：主名「显影」，副标题＝品类「传讯字卡」+ 英文。
     改这一处 + index.html 的 <title>；M6 导出图的水印也读这两个常量。 */
  var PRODUCT = '显影';
  var SUBTITLE = '传讯字卡 · WHISPER CARDS';

  var SPEED = [{ v: '1', t: '慢' }, { v: '2', t: '中' }, { v: '3', t: '快' }];
  var THEME = [{ v: 'light', t: '浅' }, { v: 'dark', t: '深' }, { v: 'system', t: '跟随系统' }];

  /* 事件概率里参与「分 100」的四项；送出是落下之后的独立几率，不占这 100。 */
  var PROB_ROWS = [
    { k: 'retract', t: '撤回', h: '刚落下一张又收回去' },
    { k: 'clear', t: '清空', h: '整行抹掉重来' },
    { k: 'pause', t: '停顿', h: '停一会儿再接着写' },
    { k: 'abandon', t: '放弃', h: '化开，重新开一行' }
  ];
  var PROB_SUM_KEYS = ['retract', 'clear', 'pause', 'abandon'];

  var sheet = null;
  var current = null;
  var st = null;   /* 本地工作副本：本页读它、改它，再把整块交回 app */

  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  function el(tag, cls, text) { return O.ui.el(tag, cls, text); }

  function section(title) {
    var sec = el('section', 'group');
    sec.appendChild(el('h4', null, title));
    var rows = el('div', 'rows');
    sec.appendChild(rows);
    return { node: sec, rows: rows };
  }

  function label(text, hint) {
    var box = el('div', 'row__label');
    box.appendChild(doc.createTextNode(text));
    if (hint) { box.appendChild(el('small', null, hint)); }
    return box;
  }

  /* ---------- 连接：等多久 / 沉默 ----------
     都是引擎真在用的参数：win 是 engine.plan 的时长窗口，sil 是沉默轮的概率。
     「对方主动开口」这一项先不放出——引擎还没有这条路径（prefs.open 只存不用）。 */

  /* 心电/声波区间滑块组件（双滑块：最短与最长） */
  function waveRangeCtl(options) {
    var min = options.min || 1;
    var max = options.max || 30;
    var values = options.values ? options.values.slice(0) : [2, 5];
    var onChange = options.onChange;

    var wrap = el('div', 'wave-box');
    var badge = el('div', 'wave-badge');
    var txtMin = el('span', 'wv-val', String(values[0]));
    var txtMax = el('span', 'wv-val', String(values[1]));
    badge.appendChild(doc.createTextNode('等待区间：'));
    badge.appendChild(txtMin);
    badge.appendChild(doc.createTextNode(' 分钟 至 '));
    badge.appendChild(txtMax);
    badge.appendChild(doc.createTextNode(' 分钟'));
    wrap.appendChild(badge);

    var trackWrap = el('div', 'wave-track');
    var cv = doc.createElement('canvas');
    cv.className = 'wave-cv';
    cv.width = 460;
    cv.height = 60;
    trackWrap.appendChild(cv);

    var fill = el('div', 'wave-fill');
    var tMin = el('div', 'wave-thumb min');
    var tMax = el('div', 'wave-thumb max');
    trackWrap.appendChild(fill);
    trackWrap.appendChild(tMin);
    trackWrap.appendChild(tMax);
    wrap.appendChild(trackWrap);

    /* 精准刻度轴（按真实时间比例百分比定位） */
    var tickValues = [1, 5, 10, 15, 20, 30];
    var ticks = el('div', 'wave-ticks');
    var ti;
    for (ti = 0; ti < tickValues.length; ti++) {
      var tv = tickValues[ti];
      var pct = ((tv - min) / (max - min)) * 100;
      var tItem = el('div', 'wave-tick-item', tv + '分');
      tItem.style.left = pct + '%';
      ticks.appendChild(tItem);
    }
    wrap.appendChild(ticks);

    var phase = 0;
    var animId = 0;

    function drawWave() {
      var ctx = cv.getContext('2d');
      var w = cv.width;
      var h = cv.height;
      var mid = h / 2;
      ctx.clearRect(0, 0, w, h);

      var isDark = doc.documentElement.classList.contains('dark');
      var muteColor = isDark ? 'rgba(241, 241, 243, 0.13)' : 'rgba(18, 18, 20, 0.11)';
      var activeGlow = isDark ? 'rgba(212, 163, 75, 0.38)' : 'rgba(179, 130, 42, 0.28)';
      var activeColor = isDark ? '#e0b35e' : '#a8731d';
      var filamentColor = isDark ? 'rgba(224, 179, 94, 0.18)' : 'rgba(168, 115, 29, 0.14)';

      var p1 = (values[0] - min) / (max - min);
      var p2 = (values[1] - min) / (max - min);
      var x1 = p1 * w;
      var x2 = p2 * w;

      /* 1. 微光极细虚线中轴（天球/声波参考线） */
      ctx.beginPath();
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = isDark ? 'rgba(241, 241, 243, 0.08)' : 'rgba(18, 18, 20, 0.07)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
      ctx.setLineDash([]);

      /* 2. 全频轻柔呼吸底波（全局背景共鸣波） */
      ctx.beginPath();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = muteColor;
      var x;
      for (x = 0; x <= w; x += 2) {
        var a1 = (x / w) * Math.PI * 14 + phase * 0.6;
        var a2 = (x / w) * Math.PI * 28 - phase * 0.3;
        var wave = Math.sin(a1) * 4 + Math.sin(a2) * 2;
        var y = mid + wave;
        if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();

      /* 3. 激活选区内的活跃多频高能波（心电 + 复合声波脉冲） */
      if (x2 > x1) {
        var baseFreq = 22 + (30 - values[0]) * 0.4;

        /* 3.1 垂直频谱细丝条（如无线电频率谱线/心律共鸣丝） */
        ctx.beginPath();
        ctx.strokeStyle = filamentColor;
        ctx.lineWidth = 1;
        var fx;
        for (fx = Math.floor(x1) + 2; fx < x2; fx += 4) {
          var fa1 = (fx / w) * Math.PI * baseFreq + phase * 1.6;
          var fa2 = (fx / w) * Math.PI * (baseFreq * 2.1) - phase * 0.8;
          var fa3 = (fx / w) * Math.PI * 6 + phase * 0.5;
          var pulseF = Math.sin(phase * 1.5) * 1.8;
          var fVal = Math.sin(fa1) * (9 + pulseF) + Math.cos(fa2) * 4 + Math.sin(fa3) * 3;
          var fy = mid + fVal;
          ctx.moveTo(fx, mid);
          ctx.lineTo(fx, fy);
        }
        ctx.stroke();

        /* 3.2 柔光光晕外层 */
        ctx.save();
        ctx.beginPath();
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = activeGlow;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 12;
        var xx;
        for (xx = x1; xx <= x2; xx += 2) {
          var ang1 = (xx / w) * Math.PI * baseFreq + phase * 1.6;
          var ang2 = (xx / w) * Math.PI * (baseFreq * 2.1) - phase * 0.8;
          var ang3 = (xx / w) * Math.PI * 6 + phase * 0.5;
          var pulse = Math.sin(phase * 1.5) * 1.8;
          var wVal = Math.sin(ang1) * (9 + pulse) + Math.cos(ang2) * 4 + Math.sin(ang3) * 3;
          var yy = mid + wVal;
          if (xx === x1) { ctx.moveTo(xx, yy); } else { ctx.lineTo(xx, yy); }
        }
        ctx.stroke();
        ctx.restore();

        /* 3.3 主脉冲高亮曲线 */
        ctx.beginPath();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = activeColor;
        var xx2;
        for (xx2 = x1; xx2 <= x2; xx2 += 2) {
          var ang1_ = (xx2 / w) * Math.PI * baseFreq + phase * 1.6;
          var ang2_ = (xx2 / w) * Math.PI * (baseFreq * 2.1) - phase * 0.8;
          var ang3_ = (xx2 / w) * Math.PI * 6 + phase * 0.5;
          var pulse_ = Math.sin(phase * 1.5) * 1.8;
          var wVal_ = Math.sin(ang1_) * (9 + pulse_) + Math.cos(ang2_) * 4 + Math.sin(ang3_) * 3;
          var yy2 = mid + wVal_;
          if (xx2 === x1) { ctx.moveTo(xx2, yy2); } else { ctx.lineTo(xx2, yy2); }
        }
        ctx.stroke();
      }
    }

    function tick() {
      if (!doc.hidden && wrap.offsetParent) {
        phase += 0.038;
        drawWave();
      }
      animId = win.requestAnimationFrame(tick);
    }

    function sync() {
      var p1 = (values[0] - min) / (max - min);
      var p2 = (values[1] - min) / (max - min);
      tMin.style.left = (p1 * 100) + '%';
      tMax.style.left = (p2 * 100) + '%';
      fill.style.left = (p1 * 100) + '%';
      fill.style.width = ((p2 - p1) * 100) + '%';
      txtMin.textContent = String(values[0]);
      txtMax.textContent = String(values[1]);
      drawWave();
    }

    var dragging = null;
    function onPointerMove(e) {
      if (!dragging) { return; }
      var rect = trackWrap.getBoundingClientRect();
      var clientX = e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX) || 0;
      var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      var val = Math.round(min + ratio * (max - min));
      if (dragging === 'min') {
        if (val > values[1]) { val = values[1]; }
        values[0] = Math.max(min, val);
      } else if (dragging === 'max') {
        if (val < values[0]) { val = values[0]; }
        values[1] = Math.min(max, val);
      }
      sync();
      if (onChange) { onChange(values.slice(0)); }
    }

    function onPointerUp() {
      dragging = null;
      win.removeEventListener('pointermove', onPointerMove);
      win.removeEventListener('pointerup', onPointerUp);
      win.removeEventListener('touchmove', onPointerMove);
      win.removeEventListener('touchend', onPointerUp);
    }

    function startDrag(target, e) {
      e.preventDefault();
      dragging = target;
      win.addEventListener('pointermove', onPointerMove);
      win.addEventListener('pointerup', onPointerUp);
      win.addEventListener('touchmove', onPointerMove);
      win.addEventListener('touchend', onPointerUp);
    }

    tMin.addEventListener('pointerdown', function (e) { startDrag('min', e); });
    tMax.addEventListener('pointerdown', function (e) { startDrag('max', e); });
    tMin.addEventListener('touchstart', function (e) { startDrag('min', e); });
    tMax.addEventListener('touchstart', function (e) { startDrag('max', e); });

    trackWrap.addEventListener('click', function (e) {
      if (e.target === tMin || e.target === tMax) { return; }
      var rect = trackWrap.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      var val = Math.round(min + ratio * (max - min));
      var dMin = Math.abs(val - values[0]);
      var dMax = Math.abs(val - values[1]);
      if (dMin <= dMax) {
        values[0] = Math.min(values[1], Math.max(min, val));
      } else {
        values[1] = Math.max(values[0], Math.min(max, val));
      }
      sync();
      if (onChange) { onChange(values.slice(0)); }
    });

    sync();
    animId = win.requestAnimationFrame(tick);

    return {
      node: wrap,
      set: function (newVals) {
        if (newVals && newVals.length === 2) {
          values = newVals.slice(0);
          sync();
        }
      },
      destroy: function () {
        if (animId) { win.cancelAnimationFrame(animId); animId = 0; }
        onPointerUp();
      }
    };
  }

  function connectionSection(st, api, refs) {
    var s = section('连接');

    var rowWave = el('div', 'row wave-row');
    rowWave.appendChild(label('等待时段', '心电波段滑动 · 调节最短与最长开口间隔'));
    refs.waveRange = waveRangeCtl({
      min: 1,
      max: 30,
      values: st.win,
      onChange: function (v) {
        st.win = v;
        api.onPref('win', st.win);
      }
    });
    rowWave.appendChild(refs.waveRange.node);
    s.rows.appendChild(rowWave);

    var rowSil = el('div', 'row');
    rowSil.appendChild(label('沉默', '这一轮对方一个字都不说（0–60%）'));
    refs.sil = O.ui.stepCtl({
      label: '沉默概率', min: 0, max: 60, step: 5, value: st.sil, unit: '%',
      onChange: function (v) {
        st.sil = v;
        api.onPref('sil', v);
      }
    });
    rowSil.appendChild(refs.sil.node);
    s.rows.appendChild(rowSil);

    return s.node;
  }

  /* ---------- 语气：卡数量 / 事件概率 ---------- */

  function toneSection(st, api, refs) {
    var s = section('语气');
    var note = el('div', 'tone-note');

    function sumOf(probs) {
      var n = 0;
      var i;
      for (i = 0; i < PROB_SUM_KEYS.length; i++) { n += probs[PROB_SUM_KEYS[i]] || 0; }
      return n;
    }

    function paint() {
      var rest = 100 - sumOf(st.probs);
      refs.dropVal.textContent = (rest > 0 ? rest : 0) + '%';
    }
    refs.paintTone = paint;

    /* 越界不静默吞掉：把这一格退回原值，并在下面写一句为什么 */
    function commit(key, v) {
      var next = copy(st.probs);
      next[key] = v;
      if (sumOf(next) > 100) {
        note.textContent = '这四项加起来不能超过 100%，要给落卡留出余量';
        refs.prob[key].set(st.probs[key], true);
        return;
      }
      note.textContent = '';
      st.probs = next;
      api.onPref('probs', next);
      paint();
    }

    /* 两个步进器和时间窗一样各占一行：挤在一行里两个「−」会读成三个按钮 */
    var rowCmin = el('div', 'row');
    rowCmin.appendChild(label('至少几张', '一条回复最少落这么多张（1–12）'));
    refs.cardsMin = O.ui.stepCtl({
      label: '至少几张', min: 1, max: 12, step: 1, value: st.cards[0], unit: ' 张',
      onChange: function (v) {
        st.cards = [v, st.cards[1] < v ? v : st.cards[1]];
        api.onPref('cards', st.cards);
        if (refs.cardsMax) { refs.cardsMax.set(st.cards[1], true); }
      }
    });
    rowCmin.appendChild(refs.cardsMin.node);
    s.rows.appendChild(rowCmin);

    var rowCmax = el('div', 'row');
    rowCmax.appendChild(label('最多几张', '页面上每行最多排 3 张'));
    refs.cardsMax = O.ui.stepCtl({
      label: '最多几张', min: 1, max: 12, step: 1, value: st.cards[1], unit: ' 张',
      onChange: function (v) {
        st.cards = [st.cards[0] > v ? v : st.cards[0], v];
        api.onPref('cards', st.cards);
        if (refs.cardsMin) { refs.cardsMin.set(st.cards[0], true); }
      }
    });
    rowCmax.appendChild(refs.cardsMax.node);
    s.rows.appendChild(rowCmax);

    var body = el('div');
    var dropRow = el('div', 'row');
    dropRow.appendChild(label('落卡', '剩下的都算落卡；上面四项合计不能超过 100%'));
    refs.dropVal = el('span', 'stp__v', '');
    dropRow.appendChild(refs.dropVal);
    body.appendChild(dropRow);

    refs.prob = {};
    var i;
    for (i = 0; i < PROB_ROWS.length; i++) {
      (function (row) {
        var r = el('div', 'row');
        r.appendChild(label(row.t, row.h));
        refs.prob[row.k] = O.ui.stepCtl({
          label: row.t, min: 0, max: 60, step: 5, unit: '%', value: st.probs[row.k] || 0,
          onChange: function (v) { commit(row.k, v); }
        });
        r.appendChild(refs.prob[row.k].node);
        body.appendChild(r);
      })(PROB_ROWS[i]);
    }

    var sendRow = el('div', 'row');
    sendRow.appendChild(label('送出', '落下之后立刻递出的几率；到上限就必然递出'));
    refs.prob.send = O.ui.stepCtl({
      label: '送出', min: 0, max: 60, step: 5, unit: '%', value: st.probs.send || 0,
      onChange: function (v) {
        var next = copy(st.probs);
        next.send = v;
        st.probs = next;
        api.onPref('probs', next);
      }
    });
    sendRow.appendChild(refs.prob.send.node);
    body.appendChild(sendRow);
    body.appendChild(note);

    s.rows.appendChild(O.ui.foldCtl({
      label: '事件概率',
      hint: '一条回复里出现各种动作的几率',
      body: body,
      openText: '调整',
      closeText: '收起'
    }).node);

    paint();
    return s.node;
  }

  /* ---------- 牌堆：名称 · 张数 · 来源；点行或「导入」都跳牌库页 ---------- */

  function deckSection(api) {
    var s = section('牌堆');
    var list = api.deckMeta ? api.deckMeta() : [];
    var loaded = api.decksLoaded ? api.decksLoaded() : false;
    var i;

    function open() { api.openDecks(); }

    for (i = 0; i < list.length; i++) {
      (function (d) {
        var row = el('div', 'row row--tap');
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        var hint = loaded ? (d.count + ' 张　·　' + d.source) : '读取中…';
        row.setAttribute('aria-label', d.name + '，' + hint + '，打开牌库');
        row.appendChild(label(d.name, hint));
        row.appendChild(el('span', 'row__go', '导入'));
        row.addEventListener('click', open);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) {
            e.preventDefault();
            open();
          }
        });
        s.rows.appendChild(row);
      })(list[i]);
    }
    return s.node;
  }

  /* ---------- 显示 ---------- */

  function displaySection(prefs, api, refs) {
    var s = section('显示');

    var rowFade = el('div', 'row');
    rowFade.appendChild(label('褪色', '越早的段落越淡，按住显影可看清'));
    refs.fade = O.ui.switchCtl({
      label: '褪色',
      value: prefs.fade !== false,
      onChange: function (v) { api.onPref('fade', v); }
    });
    rowFade.appendChild(refs.fade.node);
    s.rows.appendChild(rowFade);

    var rowSpeed = el('div', 'row');
    rowSpeed.appendChild(label('褪色速度'));
    refs.speed = O.ui.segCtl({
      options: SPEED,
      value: prefs.speed,
      onChange: function (v) { api.onPref('speed', v); }
    });
    rowSpeed.appendChild(refs.speed.node);
    s.rows.appendChild(rowSpeed);

    var rowTheme = el('div', 'row');
    rowTheme.appendChild(label('深浅色'));
    refs.theme = O.ui.segCtl({
      options: THEME,
      value: prefs.theme,
      onChange: function (v) { api.onPref('theme', v); }
    });
    rowTheme.appendChild(refs.theme.node);
    s.rows.appendChild(rowTheme);

    var rowSound = el('div', 'row');
    rowSound.appendChild(label('声音', '落卡、撤回、熄灭这些声音；关掉就完全静音'));
    refs.sound = O.ui.switchCtl({
      label: '声音',
      value: prefs.sound !== false,
      onChange: function (v) {
        api.onPref('sound', v);
        if (v && api.previewSound) { api.previewSound(); }
      }
    });
    rowSound.appendChild(refs.sound.node);
    s.rows.appendChild(rowSound);

    var rowRm = el('div', 'row');
    rowRm.appendChild(label('减少动效', '等同系统的减少动态效果设置'));
    refs.rm = O.ui.switchCtl({
      label: '减少动效',
      value: !!prefs.rm,
      onChange: function (v) { api.onPref('rm', v); }
    });
    rowRm.appendChild(refs.rm.node);
    s.rows.appendChild(rowRm);

    return s.node;
  }

  /* ---------- 数据 ---------- */

  function ensureSheet() {
    if (sheet) { return sheet; }
    sheet = O.ui.holdSheet({
      title: '清除全部数据',
      body: '会话、星图、自定义牌堆和所有设置，都会从这台设备上抹去。这一步不能撤回。',
      holdText: '按住清除',
      pressingText: '继续按住',
      pressingHint: '松手即取消',
      readyText: '松手执行',
      busyText: '正在清除…',
      doneText: '已清除',
      hintText: '按住约一秒，松手即取消',
      cancelText: '取消',
      onConfirm: function () { return current ? current.onClear() : null; }
    });
    return sheet;
  }

  function dataSection() {
    var s = section('数据');
    var row = el('div', 'row danger');
    row.appendChild(label('清除全部数据', '三堆牌与全部偏好一起归零，不能撤销'));
    var btn = el('button', 'lnk', '清除');
    btn.type = 'button';
    btn.addEventListener('click', function () { ensureSheet().open(); });
    row.appendChild(btn);
    s.rows.appendChild(row);
    return s.node;
  }

  /* ---------- 关于 ---------- */

  function aboutSection(api) {
    var sec = section('关于');
    var box = el('div', 'about');
    box.appendChild(el('div', 'v', PRODUCT));
    box.appendChild(el('div', 'sub', SUBTITLE));
    box.appendChild(el('div', null, '每一次落卡都来自本机随机，不经过任何服务器'));
    box.appendChild(el('div', null, '没有 AI，也没有语义判断；意义由你自己赋予'));
    box.appendChild(el('p', 'note', '数据只存在这台设备上（' + api.storage() + '）。系统可能在空间紧张时清理它，重要内容请自行导出。'));
    sec.node.appendChild(box);
    return sec.node;
  }

  /* ---------- 组装 ---------- */

  function render(container, prefs, api) {
    container.textContent = '';
    current = api;
    st = copy(prefs);
    var refs = {};
    container.appendChild(connectionSection(st, api, refs));
    container.appendChild(deckSection(api));
    container.appendChild(toneSection(st, api, refs));
    container.appendChild(displaySection(st, api, refs));
    container.appendChild(dataSection());
    container.appendChild(aboutSection(api));
    ensureSheet();

    return function refresh(next) {
      st = copy(next);
      if (refs.winMin) { refs.winMin.set(st.win[0], true); }
      if (refs.winMax) { refs.winMax.set(st.win[1], true); }
      if (refs.sil) { refs.sil.set(st.sil, true); }
      if (refs.cardsMin) { refs.cardsMin.set(st.cards[0], true); }
      if (refs.cardsMax) { refs.cardsMax.set(st.cards[1], true); }
      var k;
      for (k in refs.prob) {
        if (Object.prototype.hasOwnProperty.call(refs.prob, k)) { refs.prob[k].set(st.probs[k], true); }
      }
      if (refs.paintTone) { refs.paintTone(); }
      if (refs.fade) { refs.fade.set(st.fade !== false); }
      if (refs.speed) { refs.speed.set(st.speed); }
      if (refs.theme) { refs.theme.set(st.theme); }
      if (refs.sound) { refs.sound.set(st.sound !== false); }
      if (refs.rm) { refs.rm.set(!!st.rm); }
    };
  }

  O.settingsUI = { render: render, product: PRODUCT, subtitle: SUBTITLE };
})(window);