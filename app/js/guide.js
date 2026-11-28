/* 初临引渡 · 新手仪式引导系统（原生 ES5 兼容 Chrome 61）
   三候流转：
   【候一 · 启扉】心念所至，宇宙频率裂缝
   【候二 · 调频】若心绪纷乱，暂歇片刻（设置与星盘回看）
   【候三 · 低语】模式一实时共振与模式二凝思落笺模拟演示 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  var KEY_SEEN = 'whisper_guided_seen_v1';
  var rootEl = null;
  var timerLive = 0;
  var curStep = 0;
  var isDemoMode1 = true;
  var demoSlips = [];

  var LIVE_LINES = [
    { text: '回声 还在 往北', card: { tn: 'XVII', nm: '星星', pp: '正' } },
    { text: '今晚 月色 很像 你', card: { tn: 'XVIII', nm: '月亮', pp: '逆' } },
    { text: '我 一直 都在', card: { tn: 'VI', nm: '恋人', pp: '正' } }
  ];
  var liveIdx = 0;

  function el(tag, cls, text) {
    return O.ui && O.ui.el ? O.ui.el(tag, cls, text) : (function () {
      var node = doc.createElement(tag);
      if (cls) { node.className = cls; }
      if (text) { node.textContent = text; }
      return node;
    })();
  }

  function hasSeen() {
    try {
      return win.localStorage.getItem(KEY_SEEN) === '1';
    } catch (e) {
      return false;
    }
  }

  function markSeen() {
    try {
      win.localStorage.setItem(KEY_SEEN, '1');
    } catch (e) {}
  }

  /* 诗句水墨逐字显影构造器 */
  function buildVerseSpans(container, lines) {
    container.textContent = '';
    var idx = 0;
    var i;
    for (i = 0; i < lines.length; i++) {
      var lineText = lines[i];
      var row = el('span', 'vl');
      var j;
      for (j = 0; j < lineText.length; j++) {
        var chSpan = el('span', 'ch', lineText.charAt(j));
        chSpan.style.setProperty('--i', idx);
        idx += 1;
        row.appendChild(chSpan);
      }
      container.appendChild(row);
    }
  }

  /* 启动模式一的实时打字循环 */
  function startLiveDemo(tMe, tTa, sMe, sTa) {
    stopLiveDemo();
    var cur = LIVE_LINES[liveIdx % LIVE_LINES.length];
    liveIdx += 1;

    tMe.textContent = '';
    tTa.textContent = '';
    sMe.textContent = '';
    sTa.textContent = '';

    var caretMe = el('span', 'demo-caret');
    var caretTa = el('span', 'demo-caret');
    tMe.appendChild(caretMe);
    tTa.appendChild(caretTa);

    var text = cur.text;
    var charIdx = 0;

    function typeNext() {
      if (charIdx >= text.length) {
        /* 落卡 */
        timerLive = win.setTimeout(function () {
          var cardMe = el('div', 'demo-tf');
          cardMe.appendChild(el('span', 'tn', cur.card.tn));
          cardMe.appendChild(el('span', 'nm', cur.card.nm));
          cardMe.appendChild(el('span', 'pp', cur.card.pp));
          sMe.appendChild(cardMe);

          timerLive = win.setTimeout(function () {
            var cardTa = el('div', 'demo-tf');
            cardTa.appendChild(el('span', 'tn', cur.card.tn));
            cardTa.appendChild(el('span', 'nm', cur.card.nm));
            cardTa.appendChild(el('span', 'pp', cur.card.pp));
            sTa.appendChild(cardTa);

            /* 驻留 2.4 秒后开启下一句 */
            timerLive = win.setTimeout(function () {
              startLiveDemo(tMe, tTa, sMe, sTa);
            }, 2400);
          }, 240);
        }, 400);
        return;
      }

      var ch = text.charAt(charIdx);
      charIdx += 1;

      var spanMe = el('span', ch === ' ' ? 'gap' : 'ch', ch);
      tMe.insertBefore(spanMe, caretMe);

      timerLive = win.setTimeout(function () {
        var spanTa = el('span', ch === ' ' ? 'gap' : 'ch', ch);
        tTa.insertBefore(spanTa, caretTa);
      }, 220);

      var delay = ch === ' ' ? 280 : 130 + Math.floor(Math.random() * 120);
      timerLive = win.setTimeout(typeNext, delay);
    }

    timerLive = win.setTimeout(typeNext, 350);
  }

  function stopLiveDemo() {
    if (timerLive) {
      win.clearTimeout(timerLive);
      timerLive = 0;
    }
  }

  /* 模式二的落笺与放上板交互 */
  function setupDemoMode2(pane, tray, board, input, btnAdd, btnPlace, hint) {
    demoSlips = [];
    tray.textContent = '';
    board.textContent = '';
    board.appendChild(el('p', 'demo-board-empty', '板上尚空。先落几笺，再一并放上板。'));

    function renderSlips() {
      tray.textContent = '';
      var i;
      for (i = 0; i < demoSlips.length; i++) {
        tray.appendChild(el('span', 'demo-slip', demoSlips[i]));
      }
      if (demoSlips.length > 0) {
        btnPlace.classList.add('highlight');
      } else {
        btnPlace.classList.remove('highlight');
      }
    }

    btnAdd.onclick = function () {
      var val = input.value.replace(/^\s+|\s+$/g, '');
      if (!val) { return; }
      if (demoSlips.length >= 3) {
        hint.textContent = '已落满三笺，先放上板吧。';
        return;
      }
      demoSlips.push(val);
      input.value = '';
      hint.textContent = '已落 ' + demoSlips.length + ' 笺。按「放上板」一并送出。';
      renderSlips();
    };

    btnPlace.onclick = function () {
      if (input.value.replace(/^\s+|\s+$/g, '')) {
        demoSlips.push(input.value.replace(/^\s+|\s+$/g, ''));
        input.value = '';
      }
      if (!demoSlips.length) {
        hint.textContent = '还没有落笺，写一句再放上板。';
        return;
      }
      var empty = board.querySelector('.demo-board-empty');
      if (empty) { board.removeChild(empty); }

      var i;
      for (i = 0; i < demoSlips.length; i++) {
        board.appendChild(el('div', 'demo-board-sent', demoSlips[i]));
      }
      demoSlips = [];
      renderSlips();
      hint.textContent = '已放上板，ta 此刻可以看见了。';
    };

    input.onkeydown = function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        btnAdd.click();
      }
    };
  }

  function mount(container) {
    if (rootEl) { return; }

    var overlay = el('div', 'guide-overlay');
    overlay.id = 'guideOverlay';

    var card = el('div', 'guide-card');
    var btnSkip = el('button', 'guide-skip', '已知悉 · 隐去');
    btnSkip.type = 'button';
    card.appendChild(btnSkip);

    var scroll = el('div', 'guide-scroll');

    /* ----- 候一：初临 · 启扉 ----- */
    var act1 = el('article', 'guide-act');
    act1.appendChild(el('div', 'act-head')).appendChild(el('h2', null, '初临 · 启扉'));
    var verse1 = el('p', 'guide-verse ink');
    buildVerseSpans(verse1, [
      '心念所至，自有回响。',
      '这里是宇宙频率的裂缝，',
      '邀请你心里想的那个人，',
      '每一句低语，皆在等待显影。'
    ]);
    act1.appendChild(verse1);

    var points1 = el('ul', 'guide-points');
    var pt1_1 = el('li');
    pt1_1.style.setProperty('--delay', '400ms');
    pt1_1.appendChild(el('span', 'guide-glyph', '名'));
    pt1_1.appendChild(el('p', null, '留下对方的名字，填写一些你们之间具有链接感的话语，或者丰富你们之间的经历，让 ta 可以找到你。'));
    points1.appendChild(pt1_1);

    var pt1_2 = el('li');
    pt1_2.style.setProperty('--delay', '580ms');
    pt1_2.appendChild(el('span', 'guide-glyph', '时'));
    pt1_2.appendChild(el('p', null, '当频率开始链接，链接的画面会持续 2s–15s 不等，这是寻找 ta 的时间。'));
    points1.appendChild(pt1_2);

    var pt1_3 = el('li');
    pt1_3.style.setProperty('--delay', '760ms');
    pt1_3.appendChild(el('span', 'guide-glyph', '默'));
    pt1_3.appendChild(el('p', null, '在你沉默的期间，对方依然能够回应。'));
    points1.appendChild(pt1_3);

    act1.appendChild(points1);
    scroll.appendChild(act1);

    /* ----- 候二：叩问 · 调频 ----- */
    var act2 = el('article', 'guide-act');
    act2.appendChild(el('div', 'act-head')).appendChild(el('h2', null, '叩问 · 调频'));
    var verse2 = el('p', 'guide-verse');
    buildVerseSpans(verse2, [
      '若心绪纷乱，',
      '不妨暂歇片刻。'
    ]);
    act2.appendChild(verse2);

    var points2 = el('ul', 'guide-points');
    var pt2_1 = el('li');
    pt2_1.style.setProperty('--delay', '360ms');
    pt2_1.appendChild(el('span', 'guide-glyph', '设'));
    pt2_1.appendChild(el('p', null, '通过左上角的设置可以调节每个动作的概率、画面的主题、传讯模式（实时共振/凝思落笺）等。'));
    points2.appendChild(pt2_1);

    var pt2_2 = el('li');
    pt2_2.style.setProperty('--delay', '540ms');
    pt2_2.appendChild(el('span', 'guide-glyph', '溯'));
    pt2_2.appendChild(el('p', null, '通过右上角的「回溯」与「星图」按钮，可以随时重温过往的每一次相遇与传讯。'));
    points2.appendChild(pt2_2);

    act2.appendChild(points2);
    scroll.appendChild(act2);

    /* ----- 候三：显影 · 低语 ----- */
    var act3 = el('article', 'guide-act');
    act3.appendChild(el('div', 'act-head')).appendChild(el('h2', null, '显影 · 低语'));
    var verse3 = el('p', 'guide-verse');
    buildVerseSpans(verse3, ['字随心转，墨落成声。']);
    act3.appendChild(verse3);

    /* 传讯模式交互演示器 */
    var demoWrap = el('div', 'demo-wrap');
    var demoTabs = el('div', 'demo-tabs');
    var tab1 = el('button', 'demo-tab active');
    tab1.type = 'button';
    tab1.appendChild(doc.createTextNode('实时共振'));
    tab1.appendChild(el('small', null, '模式一 · 心念共感'));

    var tab2 = el('button', 'demo-tab');
    tab2.type = 'button';
    tab2.appendChild(doc.createTextNode('凝思落笺'));
    tab2.appendChild(el('small', null, '模式二 · 墨落定音'));
    demoTabs.appendChild(tab1);
    demoTabs.appendChild(tab2);
    demoWrap.appendChild(demoTabs);

    var demoDesc = el('p', 'demo-desc', '模式 1：你和对方都可以实时看到打字/拼接字卡的过程，对方自由主动回应。');
    demoWrap.appendChild(demoDesc);

    var demoBox = el('div', 'demo-box');

    /* 模式 1 演示面板 */
    var pane1 = el('div', 'demo-pane-live');
    var rowMe = el('div', 'demo-live-row');
    rowMe.appendChild(el('span', 'demo-who', '你'));
    var contMe = el('div', 'demo-live-content');
    var tMe = el('span', 'demo-typed');
    var sMe = el('span', 'demo-splice');
    contMe.appendChild(tMe);
    contMe.appendChild(sMe);
    rowMe.appendChild(contMe);
    pane1.appendChild(rowMe);

    var linkLine = el('div', 'demo-link-line');
    linkLine.appendChild(el('i'));
    pane1.appendChild(linkLine);

    var rowTa = el('div', 'demo-live-row');
    rowTa.appendChild(el('span', 'demo-who', 'ta'));
    var contTa = el('div', 'demo-live-content');
    var tTa = el('span', 'demo-typed');
    var sTa = el('span', 'demo-splice');
    contTa.appendChild(tTa);
    contTa.appendChild(sTa);
    rowTa.appendChild(contTa);
    pane1.appendChild(rowTa);

    demoBox.appendChild(pane1);

    /* 模式 2 演示面板 */
    var pane2 = el('div', 'demo-pane-slip');
    pane2.hidden = true;
    var demoBoard = el('div', 'demo-board');
    pane2.appendChild(demoBoard);

    var demoTray = el('div', 'demo-tray');
    pane2.appendChild(demoTray);

    var demoCompose = el('div', 'demo-compose');
    var slipIn = el('input', 'demo-input');
    slipIn.type = 'text';
    slipIn.value = '想你 的时候 月亮 会知道';
    slipIn.placeholder = '写下一句低语…';
    demoCompose.appendChild(slipIn);

    var btnAddSlip = el('button', 'demo-btn-action', '落笺');
    btnAddSlip.type = 'button';
    var btnPlaceSlip = el('button', 'demo-btn-action', '放上板');
    btnPlaceSlip.type = 'button';
    demoCompose.appendChild(btnAddSlip);
    demoCompose.appendChild(btnPlaceSlip);
    pane2.appendChild(demoCompose);

    var demoHint = el('p', 'demo-hint', '点击「放上板」或回车，字句将正式递出至板面。');
    pane2.appendChild(demoHint);

    demoBox.appendChild(pane2);
    demoWrap.appendChild(demoBox);
    act3.appendChild(demoWrap);
    scroll.appendChild(act3);

    card.appendChild(scroll);

    /* 模式切换动作 */
    tab1.onclick = function () {
      if (isDemoMode1) { return; }
      isDemoMode1 = true;
      tab1.classList.add('active');
      tab2.classList.remove('active');
      pane1.hidden = false;
      pane2.hidden = true;
      demoDesc.textContent = '模式 1：你和对方都可以实时看到打字/拼接字卡的过程，对方自由主动回应。';
      startLiveDemo(tMe, tTa, sMe, sTa);
    };

    tab2.onclick = function () {
      if (!isDemoMode1) { return; }
      isDemoMode1 = false;
      tab2.classList.add('active');
      tab1.classList.remove('active');
      pane1.hidden = true;
      pane2.hidden = false;
      demoDesc.textContent = '模式 2：你可以通过「放上板」按钮实际发送，在此之前可积攒多条信息。';
      stopLiveDemo();
      setupDemoMode2(pane2, demoTray, demoBoard, slipIn, btnAddSlip, btnPlaceSlip, demoHint);
    };

    /* ----- 底部流转轨道 ----- */
    var rail = el('nav', 'guide-rail');
    var btnBack = el('button', 'rail-btn', '回看');
    btnBack.type = 'button';

    var dots = el('div', 'rail-dots');
    var dot1 = el('button', 'rail-dot active');
    var dot2 = el('button', 'rail-dot');
    var dot3 = el('button', 'rail-dot');
    dots.appendChild(dot1);
    dots.appendChild(dot2);
    dots.appendChild(dot3);

    var btnNext = el('button', 'rail-btn primary', '续前行 · 承接');
    btnNext.type = 'button';

    rail.appendChild(btnBack);
    rail.appendChild(dots);
    rail.appendChild(btnNext);
    card.appendChild(rail);

    overlay.appendChild(card);
    container.appendChild(overlay);
    rootEl = overlay;

    var acts = [act1, act2, act3];
    var dotEls = [dot1, dot2, dot3];

    function showStep(step) {
      curStep = step;
      var i;
      for (i = 0; i < acts.length; i++) {
        if (i === step) {
          acts[i].classList.add('active');
          var verse = acts[i].querySelector('.guide-verse');
          if (verse) {
            verse.classList.remove('ink');
            void verse.offsetWidth;
            verse.classList.add('ink');
          }
        } else {
          acts[i].classList.remove('active');
        }
      }

      for (i = 0; i < dotEls.length; i++) {
        dotEls[i].classList.toggle('active', i === step);
        dotEls[i].classList.toggle('past', i < step);
      }

      btnBack.style.visibility = step === 0 ? 'hidden' : 'visible';
      btnNext.textContent = step === 2 ? '已明了 · 入局' : '续前行 · 承接';
      scroll.scrollTop = 0;

      if (step === 2) {
        if (isDemoMode1) {
          startLiveDemo(tMe, tTa, sMe, sTa);
        }
      } else {
        stopLiveDemo();
      }
    }

    btnBack.onclick = function () {
      if (curStep > 0) { showStep(curStep - 1); }
    };

    btnNext.onclick = function () {
      if (curStep < 2) {
        showStep(curStep + 1);
      } else {
        close();
      }
    };

    dot1.onclick = function () { showStep(0); };
    dot2.onclick = function () { showStep(1); };
    dot3.onclick = function () { showStep(2); };

    btnSkip.onclick = function () {
      close();
    };

    showStep(0);
  }

  function open() {
    if (!rootEl) { return; }
    rootEl.classList.remove('closing');
    rootEl.classList.add('active');
    curStep = 0;
    var act1 = rootEl.querySelectorAll('.guide-act')[0];
    if (act1) {
      var dot1 = rootEl.querySelectorAll('.rail-dot')[0];
      if (dot1) { dot1.click(); }
    }
  }

  function close() {
    if (!rootEl) { return; }
    markSeen();
    stopLiveDemo();
    rootEl.classList.add('closing');
    win.setTimeout(function () {
      rootEl.classList.remove('active');
      rootEl.classList.remove('closing');
    }, 800);
  }

  O.guide = {
    mount: mount,
    open: open,
    close: close,
    hasSeen: hasSeen
  };
})(window);
