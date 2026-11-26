/* 启动与编排
   顺序：读偏好（同步，避免首帧闪）→ 起背景 → 建两支蜡烛 → 开场仪式 → 会话编号 → 读牌堆 → 渲染设置。
   帧循环只有一条：背景、星屑、烛焰共用同一个 dt；页面隐藏时停 rAF，回来时 lastTs 归零，时间差不累积。
   页面切换统一走 showPage(name)：chat / settings / decks；星图等 P4。
   主题三种取值：light / dark / system（P3 加），system 跟着系统深浅走，系统一变就重算，不用重开页面。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  var prefs = null;
  var head = null;
  var big = null;
  var ritualEl = null;
  var ritualOn = false;
  var ticking = false;
  var lastTs = 0;
  var themeT = 0;
  var rmq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var dq = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  var timers = [];
  var uiRefresh = null;
  var session = { no: '----' };

  function $(id) { return doc.getElementById(id); }

  function later(fn, ms) {
    var id = win.setTimeout(function () { fn(); }, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    var i;
    for (i = 0; i < timers.length; i++) { win.clearTimeout(timers[i]); }
    timers = [];
  }

  function reduced() {
    return (rmq && rmq.matches) || !!(prefs && prefs.rm);
  }

  /* 主题求值：system 只在这里变成具体的一侧，其余代码看到的仍然是 light / dark 的结果。 */
  function darkNow() {
    if (prefs.theme === 'dark') { return true; }
    if (prefs.theme === 'light') { return false; }
    return !!(dq && dq.matches);
  }

  /* 把补丁合并进现有偏好：新字段一个都不能丢（旧版 merged 只带三个键）。 */
  function merged(patch) {
    var p = JSON.parse(JSON.stringify(prefs));
    var k;
    for (k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) { p[k] = patch[k]; }
    }
    return p;
  }

  /* 显示偏好落到 html 上：深浅色一个类，褪色一个类，速度一个 data 属性。
     对话页渲染历史段落时读它们（P3 只到"存住 + 立刻落到文档"这一层）。 */
  function applyPrefs(next, save) {
    prefs = save ? O.storage.save(next) : next;
    var root = doc.documentElement;
    var dark = darkNow();
    root.classList.toggle('dark', dark);
    root.classList.toggle('rm', !!prefs.rm);
    root.classList.toggle('fade', prefs.fade !== false);
    root.setAttribute('data-speed', prefs.speed);
    if (O.fx) { O.fx.setGrain(dark); }
    if (O.sfx) { O.sfx.setVolume(prefs.sound === false ? 0 : 0.7); }
    if (uiRefresh) { uiRefresh(prefs); }
  }

  function showPage(name) {
    var pages = doc.querySelectorAll('.page');
    var i;
    var target = null;
    for (i = 0; i < pages.length; i++) {
      var on = pages[i].getAttribute('data-page') === name;
      pages[i].hidden = !on;
      if (on) { target = pages[i]; }
    }
    if (target && target.focus) { target.focus(); }
    if (name === 'settings') { renderSettings(); }
    if (name === 'decks') { O.decks.open(); }
    if (name === 'starmap' && O.starmap) { O.starmap.open(); }
    else if (name !== 'starmap' && O.starmap) { O.starmap.close(); }
  }

  function tick(ts) {
    if (doc.hidden) { ticking = false; return; }
    var dt = lastTs ? Math.min(ts - lastTs, 64) : 16;
    var rm = reduced();
    lastTs = ts;
    themeT += ((darkNow() ? 1 : 0) - themeT) * Math.min(1, dt / 420);
    O.fx.frame(ts, dt, rm, themeT);
    head.step(dt, ts, rm, themeT);
    if (ritualOn) { big.step(dt, ts, rm, themeT); }
    win.requestAnimationFrame(tick);
  }

  function startTick() {
    if (ticking) { return; }
    ticking = true;
    lastTs = 0;
    win.requestAnimationFrame(tick);
  }

  function showOpen() {
    clearTimers();
    ritualEl.classList.remove('closing');
    ritualEl.classList.remove('shown');
    ritualOn = true;
    ritualEl.classList.remove('hide');
    ritualEl.classList.remove('gone2');
    $('rt').textContent = '连接中';
    $('rs').textContent = '纯随机，没有 AI';
    head.setOut();
    big.setOut();
    later(function () { big.light(); }, 700);
    later(function () {
      ritualEl.classList.add('gone2');
      head.light();
      later(function () {
        ritualOn = false;
        ritualEl.classList.add('hide');
      }, 1400);
    }, O.rng.range(2800, 4300));
  }

  function newNumber() {
    return String(O.rng.int(1, 9999)).padStart(4, '0');
  }

  function loadSession() {
    if (prefs.session) {
      session.no = prefs.session;
    } else {
      session.no = newNumber();
      prefs = O.storage.save(merged({ session: session.no }));
    }
    $('sessNo').textContent = 'No.' + session.no;
  }

  /* 清除全部数据：偏好回默认（会话号重抽）→ 三堆回内置并落种 → 牌库页数据同步 → 设置页重画。
     用的是设置页那个按住确认弹层，不再是 window.confirm。 */
  function clearAll() {
    prefs = O.storage.clear();
    session.no = newNumber();
    prefs = O.storage.save(merged({ session: session.no }));
    $('sessNo').textContent = 'No.' + session.no;
    applyPrefs(prefs, false);
    /* 库删了，对话页内存里那份也得扔：否则下一段落库会把旧历史写回去。 */
    O.chat.reset(session.no);
    return O.db.clear()
      .then(function () { return O.db.saveDecks(O.builtin.all()); })
      .then(function () { return O.decks.load(); })
      .then(function () { renderSettings(); })
      .then(null, function () {
        win.alert('牌堆没有清干净：本机存储可能被占用，重开一次再试。');
        renderSettings();
      });
  }

  /* 浏览器要求用户手势后才能出声：第一次点/按任何地方时解锁一次，之后切后台回来自动恢复。 */
  var sfxArmed = false;
  function armSfx() {
    if (sfxArmed || !O.sfx) { return; }
    sfxArmed = true;
    O.sfx.unlock();
  }
  function settingsApi() {
    return {
      onPref: function (key, value) {
        var patch = {};
        patch[key] = value;
        applyPrefs(merged(patch), true);
      },
      onClear: clearAll,
      openDecks: function () { showPage('decks'); },
      previewSound: function () { if (O.sfx) { O.sfx.unlock(); O.sfx.play('drop'); } },
      deckMeta: function () { return O.decks.meta(); },
      decksLoaded: function () { return O.decks.loaded(); },
      storage: function () { return O.db.label(); }
    };
  }

  function renderSettings() {
    if (!prefs) { return; }
    uiRefresh = O.settingsUI.render($('settingsBody'), prefs, settingsApi());
    uiRefresh(prefs);
  }

  function toggleTheme() {
    /* 手点就变成明确的一侧：当前看起来是深色，就切到浅色，反之亦然。 */
    applyPrefs(merged({ theme: darkNow() ? 'light' : 'dark' }), true);
  }

  /* ---------- 送走（P2-8） ----------
     结束时就把这次会话的 endedAt 写掉、换成新编号（覆盖层只是余烬）；
     新编号在用户点「再点一支蜡烛」之前不落任何东西，所以不会有空会话。 */

  var awaySheet = null;
  var awayBusy = false;

  function ensureAwaySheet() {
    if (awaySheet) { return awaySheet; }
    awaySheet = O.ui.holdSheet({
      title: '送走',
      body: '这一场就到这里。烛火灭了以后，板上会从新的编号重新开始；这一次会留在星图里。',
      holdText: '按住送走',
      pressingText: '继续按住',
      pressingHint: '松手即取消',
      readyText: '松手送走',
      busyText: '正在收…',
      doneText: '已送走',
      failText: '没有送走，再试一次',
      hintText: '按住约一秒，松手即取消',
      cancelText: '再坐一会儿',
      onConfirm: sendAway
    });
    return awaySheet;
  }

  function sendAway() {
    if (awayBusy) { return Promise.resolve(false); }
    awayBusy = true;
    var oldNo = session.no;
    var no = newNumber();
    head.snuff();
    if (O.sfx) { O.sfx.play('silence'); }
    return O.chat.endSession().then(function () {
      prefs = O.storage.save(merged({ session: no }));
      session.no = no;
      $('sessNo').textContent = 'No.' + no;
      O.chat.reset(no);
      clearTimers();
      ritualOn = true;
      ritualEl.classList.remove('hide');
      ritualEl.classList.remove('gone2');
      ritualEl.classList.add('closing');
      ritualEl.classList.remove('shown');
      $('rt').textContent = '已送走';
      $('rs').textContent = 'No.' + oldNo;
      big.setOut();
      later(function () { big.light(); }, 220);
      later(function () { big.snuff(); }, 1350);
      later(function () {
        ritualEl.classList.add('shown');
        var b = $('btnAgain');
        if (b && b.focus) { try { b.focus(); } catch (e) { /* 焦点拿不到就算了 */ } }
      }, 2500);
      awayBusy = false;
      return true;
    }, function () {
      awayBusy = false;
      return false;
    });
  }

  function relight() {
    awayBusy = false;
    showOpen();
  }

  function bind() {
    $('btnTheme').addEventListener('click', toggleTheme);
    $('btnDecksTheme').addEventListener('click', toggleTheme);
    $('btnSettings').addEventListener('click', function () { showPage('settings'); });
    $('btnSendAway').addEventListener('click', function () { ensureAwaySheet().open(); });
    $('btnAgain').addEventListener('click', relight);
    $('btnBack').addEventListener('click', function () { showPage('chat'); });
    $('btnDecksBack').addEventListener('click', function () { showPage('settings'); });
    if ($('btnStarmap')) { $('btnStarmap').addEventListener('click', function () { showPage('starmap'); }); }
    if ($('btnStarmapBack')) { $('btnStarmapBack').addEventListener('click', function () { showPage('chat'); }); }
    if ($('btnStarmapTheme')) { $('btnStarmapTheme').addEventListener('click', toggleTheme); }
    if ($('sessNo')) {
      $('sessNo').addEventListener('click', function () { showPage('starmap'); });
      $('sessNo').style.cursor = 'pointer';
    }    doc.addEventListener('pointerdown', armSfx, true);
    doc.addEventListener('keydown', armSfx, true);
    doc.addEventListener('touchstart', armSfx, true);
  }

  function boot() {
    prefs = O.storage.load();
    ritualEl = $('ritual');
    O.fx.init();
    head = O.candle.create($('cvCandle'), 1);
    big = O.candle.create($('cvBig'), 1.7);
    applyPrefs(prefs, false);
    /* 会话编号要赶在 chat.mount 之前定下来：对话页靠它把上一轮的历史读回来。 */
    loadSession();
    O.chat.mount({
      now: $('now'),
      line: $('line'),
      hist: $('hist'),
      scroll: doc.querySelector('#pageChat .scroll'),
      say: $('say'),
      btnPlace: $('btnPlace'),
      btnHand: $('btnHand'),
      btnReveal: $('btnReveal'),
      pend: $('pend')
    }, {
      light: function () { head.light(); },
      snuff: function () { head.snuff(); }
    });
    bind();
        if (O.starmap) {
      O.starmap.mount({
        canvas: $('smCanvas'),
        empty: $('smEmpty'),
        card: $('smCard'),
        cnt: $('smCnt'),
        smCno: $('smCno'),
        smMeta: $('smMeta'),
        smMsg: $('smMsg'),
        smDeck: $('smDeck'),
        cardClose: $('smCardClose'),
        btnView: $('smBtnView'),
        btnReplay: $('smBtnReplay'),
        ovSession: $('ovSession'),
        sessTitle: $('sessTitle'),
        sessClose: $('sessClose'),
        replayBar: $('sessReplayBar'),
        playBtn: $('sessPlayBtn'),
        track: $('sessTrack'),
        fill: $('sessFill'),
        knob: $('sessKnob'),
        clk: $('sessClk'),
        sessHist: $('sessHist')
      });
    }
    O.decks.mount({
      sum: $('deckSum'),
      list: $('deckList'),
      ovPaste: $('ovPaste'),
      pDeck: $('pDeck'),
      pta: $('pta'),
      fb: $('pFb'),
      pReplace: $('pReplace'),
      pAppend: $('pAppend'),
      pCancel: $('pCancel'),
      ovImg: $('ovImg'),
      iDeck: $('iDeck'),
      iCnt: $('iCnt'),
      iGrid: $('iGrid'),
      iAdd: $('iAdd'),
      iFile: $('iFile'),
      iReplace: $('iReplace'),
      iAppend: $('iAppend'),
      iCancel: $('iCancel'),
      ovAll: $('ovAll'),
      aDeck: $('aDeck'),
      aCnt: $('aCnt'),
      aList: $('aList'),
      aClose: $('aClose'),
      ovGift: $('ovGift'),
      gGrid: $('gGrid'),
      gPick: $('gPick'),
      gName: $('gName'),
      gNameCnt: $('gNameCnt'),
      gMeaning: $('gMeaning'),
      gMeanCnt: $('gMeanCnt'),
      gFb: $('gFb'),
      gAppend: $('gAppend'),
      gCancel: $('gCancel')
    });
    startTick();
    renderSettings();
    O.decks.load().then(function () { renderSettings(); }).then(null, function () { renderSettings(); });
    showOpen();
  }

  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) { ticking = false; }
    else { startTick(); }
  });

  /* 系统深浅色变了：只有 theme=system 才跟着动，明确选了浅/深的不受影响。 */
  if (dq && dq.addListener) {
    dq.addListener(function () {
      if (prefs && prefs.theme === 'system') { applyPrefs(prefs, false); }
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);