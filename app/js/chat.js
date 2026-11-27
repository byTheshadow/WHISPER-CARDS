/* 对话页（M3）
   板面交互照原型 v2 的板面一节移植：隐藏输入接键盘，板面上显示镜像文字（逐字淡入），
   「放上板」把这一段落进历史，「递出」交给对方，对方按引擎抽好的时间线逐张落卡。
   这里管渲染、播放与落库（M3-a：每段历史进 sessions + ev:<No>，刷新按 No. 恢复）；抽卡逻辑在 engine.js。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  var FS = 17;              /* 历史段落字号；物件尺寸由它推出（设计定案 §3.4） */
  var TICK = 120;           /* 播放器轮询间隔（毫秒） */

  var refs = null;
  var hooks = null;
  var s = {
    mode: 'me',             /* me 我写 | them 对方写 | wait 等待 */
    locked: false,
    focused: false,
    pending: 0,             /* 已放上板但还没递出的段数 */
    prev: [],
    live: [],               /* 当前行里的卡（数据） */
    liveNodes: [],
    caret: null,
    plan: null,
    index: 0,
    startAt: 0,
    running: false,
    timer: 0,
    pausedAt: 0,
    speed: 1,
    history: [],            /* 已落库的历史段落，一条一段 */
    no: '',                 /* 这条会话的编号，落库用 */
    startedAt: 0,           /* 会话开始时刻（首次落段的 at），恢复时从 sessions 认领 */
    sessions: [],           /* sessions 列表，一条会话一条，按 no 找 */
    queued: [],             /* 恢复期间先排队的段落，等旧段落摆完再接 */
    restoring: false,
    gen: 0,                 /* 换了会话（清空全部数据）就 +1，进行中的恢复作废 */
    persistFail: false,
    idleTimer: 0,           /* 静默倾听 / 纯随机问骰计时器 */
    proactiveStreak: 0,     /* 彼方连续主动传讯次数 */
    gazeTimer: 0,           /* 凝视水墨波纹持续定时器 */
    gazing: false,          /* 当前彼方是否正在凝视中 */
    recipient: null         /* 当前会话连结的羁绊对象 { name, word, note } */
  };

  function el(tag, cls, text) { return O.ui.el(tag, cls, text); }

  function hhmmAt(at) {
    var d = new Date(at);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function hhmm() { return hhmmAt(Date.now()); }

  function later(fn, ms) { return win.setTimeout(fn, Math.round(ms / s.speed)); }

  /* ---------- 尺寸 ---------- */

  function geo() {
    var cw = (refs.hist && refs.hist.clientWidth) || 330;
    var capI = Math.round(FS * 4.4);
    var capT = Math.round(FS * 3.3);
    var capTh = Math.round(FS * 5.05);
    var maxI = Math.floor((cw - 46) / 3);
    var iw = Math.min(capI, Math.max(40, maxI));
    var k = iw / capI;
    return { iw: iw, tw: Math.round(capT * k), th: Math.round(capTh * k) };
  }

  /* ---------- 一张卡的节点（物件卡；文字卡返回 null） ----------
     分层照 drop-spec §1：.ch-slot 静态摆放，.ch-cd 落下/撤回，.ch-pr 压一下，
     .ch-shd 投影层，.ch-it 卡面。drop=true 时挂 .ch-drop，插入那一刻就开始落下。 */

  function cardNode(card, idx, drop) {
    var g = geo();
    var face;
    if (card.kind === 'tarot') {
      face = el('div', 'ch-it tf' + (card.side === 'reversed' ? ' rev' : ''));
      face.style.setProperty('--tw', g.tw + 'px');
      face.style.setProperty('--th', g.th + 'px');
      /* 小阿卡纳的内置数据里 num 与 name 是同一个字符串（deck-builtin 第 87 行），
         同一个名字在卡上印两遍很脏，所以相等时只留一处。 */
      if (card.num && card.num !== card.name) {
        face.appendChild(el('span', 'tn', card.num));
      }
      face.appendChild(el('span', 'nm', card.name || ''));
      face.appendChild(el('span', 'kw', card.side === 'reversed' ? card.reversed : card.upright));
      face.appendChild(el('span', 'pp', card.side === 'reversed' ? '逆' : '正'));
    } else if (card.kind === 'gift') {
      face = el('div', 'ch-it gw');
      if (O.giftCard) {
        face.appendChild(O.giftCard.create({
          gift: card.gift, name: card.name, meaning: card.meaning
        }));
      }
    } else if (card.kind === 'image') {
      face = el('div', 'ch-it');
      var img = doc.createElement('img');
      img.src = card.image;
      img.alt = '';
      face.appendChild(img);
      face.style.setProperty('--iw', g.iw + 'px');
    } else {
      return null;
    }
    var slot = el('div', 'ch-slot' + (drop ? ' ch-drop' : ''));
    var cd = el('div', 'ch-cd');
    var pr = el('div', 'ch-pr');
    pr.appendChild(el('div', 'ch-shd'));
    pr.appendChild(face);
    cd.appendChild(pr);
    slot.appendChild(cd);
    slot.style.setProperty('--rot', ((idx % 3) - 1) * 1.2 + 'deg');
    slot.style.setProperty('--dy', ((idx % 3) - 1) * 3 + 'px');
    return slot;
  }

  /* ---------- 一段话：按落卡顺序切 run ---------- */

  /* 每行最多 3 个；4 张按设计定案 §3.7 折成 1 + 3（第二行 1 个居中） */
  function splitRows(n) {
    if (n <= 3) { return [n]; }
    if (n === 4) { return [1, 3]; }
    var out = [];
    var left = n;
    while (left > 0) {
      var take = Math.min(3, left);
      out.push(take);
      left -= take;
    }
    return out;
  }

  function buildSeg(cards, who, time) {
    var seg = el('div', 'ch-seg' + (who === 'me' ? ' me' : ''));
    var runs = [];
    var cur = null;
    var i;
    for (i = 0; i < cards.length; i++) {
      var type = cards[i].kind === 'text' ? 't' : 'o';
      if (!cur || cur.type !== type) {
        cur = { type: type, items: [] };
        runs.push(cur);
      }
      cur.items.push(cards[i]);
    }
    for (i = 0; i < runs.length; i++) {
      if (runs[i].type === 't') {
        var box = el('div', 'ch-t');
        var j;
        for (j = 0; j < runs[i].items.length; j++) {
          box.appendChild(el('span', 'ch-w', runs[i].items[j].text || ''));
        }
        seg.appendChild(box);
      } else {
        var band = el('div', 'ch-o');
        var rows = splitRows(runs[i].items.length);
        var start = 0;
        var r;
        for (r = 0; r < rows.length; r++) {
          var row = el('div', 'ch-row');
          var q;
          for (q = start; q < start + rows[r]; q++) {
            var node = cardNode(runs[i].items[q], q);
            if (node) { row.appendChild(node); }
          }
          start += rows[r];
          band.appendChild(row);
        }
        seg.appendChild(band);
      }
    }
    seg.appendChild(el('span', 'ch-tm', time || hhmm()));
    return seg;
  }

  function textSeg(text, who) {
    var card = { kind: 'text', text: text };
    return buildSeg([card], who, hhmm());
  }

  /* ---------- 历史：淡出 + 滚到底 ---------- */

  function applyFade() {
    if (!refs || !refs.hist) { return; }
    var list = refs.hist.children;
    var n = list.length;
    var i;
    for (i = 0; i < n; i++) {
      list[i].style.opacity = String(Math.max(0.1, 1 - (n - 1 - i) * 0.16));
    }
  }

  /* 显影（M3-b）：按住时所有段落恢复清晰、时间露出来。
     只切换 .hist 上的类，不动 applyFade 写下的内联 opacity——
     CSS 里那条 .hist.reveal .ch-seg 带 !important，盖得住阶梯；松开后自己退回。 */
  function reveal(on) {
    if (!refs || !refs.hist) { return; }
    var v = !!on;
    if (v) { refs.hist.classList.add('reveal'); } else { refs.hist.classList.remove('reveal'); }
    if (refs.btnReveal) { refs.btnReveal.setAttribute('aria-pressed', v ? 'true' : 'false'); }
  }

  function toBottom() {
    if (refs && refs.scroll) { refs.scroll.scrollTop = refs.scroll.scrollHeight; }
  }

  /* 从当前行浮上去：位置差用 transform 补，读一次布局就够 */
  function floatUp(seg, after) {
    var r0 = refs.line.getBoundingClientRect();
    refs.hist.appendChild(seg);
    if (after) { after(); }
    toBottom();
    applyFade();
    if (!seg.animate || reduced()) { return; }
    var r1 = seg.getBoundingClientRect();
    var dy = (r0.top + r0.height / 2) - (r1.top + r1.height / 2);
    seg.style.transition = 'none';
    seg.style.transform = 'translateY(' + dy + 'px)';
    void seg.offsetHeight;
    seg.style.transition = 'transform 1.1s cubic-bezier(.2,.7,.2,1);';
    seg.style.transform = '';
    later(function () { seg.style.transition = ''; }, 1200);
  }

  function reduced() {
    return (win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      doc.documentElement.classList.contains('rm');
  }

  /* ---------- 凝视感知（代表彼方正在偶发注视着你） ---------- */

  function stopGaze() {
    s.gazing = false;
    if (s.gazeTimer) {
      win.clearTimeout(s.gazeTimer);
      s.gazeTimer = 0;
    }
    if (refs && refs.gazeRipples) {
      refs.gazeRipples.classList.remove('active');
    }
  }

  function triggerGaze(durationMs) {
    if (!refs || !refs.gazeRipples || doc.hidden) { return; }
    s.gazing = true;
    refs.gazeRipples.classList.add('active');
    if (s.gazeTimer) { win.clearTimeout(s.gazeTimer); }
    var dur = durationMs || (O.rng && O.rng.range ? O.rng.range(6000, 9500) : 7500);
    s.gazeTimer = win.setTimeout(function () {
      s.gazing = false;
      if (refs && refs.gazeRipples) {
        refs.gazeRipples.classList.remove('active');
      }
    }, dur);
  }

  function rollGazeOnFocus() {
    /* 纯随机自然掷骰（不加人为控制概率）：
       投掷自然随机骰，完全凭机缘感知彼方投来的凝视 */
    if (O.rng && O.rng.int && O.rng.int(1, 4) === 1) {
      triggerGaze();
    } else {
      stopGaze();
    }
  }

  /* ---------- 我的书写：板面镜像 ---------- */

  function clearLine() {
    while (refs.line.firstChild) { refs.line.removeChild(refs.line.firstChild); }
    refs.line.className = 'line';
    s.live = [];
    s.liveNodes = [];
    s.caret = null;
  }

  function renderMe() {
    if (s.mode !== 'me') {
      if (refs.draft) {
        var dv = refs.say.value;
        if (dv.length > 0) {
          refs.draft.hidden = false;
          refs.draft.textContent = dv;
        } else {
          refs.draft.hidden = true;
          refs.draft.textContent = '';
        }
      }
      return;
    }
    if (refs.draft) { refs.draft.hidden = true; refs.draft.textContent = ''; }
    clearLine();
    refs.line.className = 'line me';
    var chars = Array.prototype.slice.call(refs.say.value);
    if (!chars.length) {
      if (s.focused) {
        refs.line.appendChild(el('span', 'ch-caret'));
      } else if (s.history.length === 0 && s.pending === 0) {
        var eg = el('div', 'empty-guide');
        eg.appendChild(el('span', 'eg-title', '轻触此处书写想说的话'));
        eg.appendChild(el('span', 'eg-step', '先「放上板」 · 再「递出」向虚空'));
        refs.line.appendChild(eg);
      } else {
        refs.line.appendChild(el('span', 'ph', '轻触此处书写'));
      }
      s.prev = chars;
      return;
    }
    var p = 0;
    while (p < chars.length && p < s.prev.length && chars[p] === s.prev[p]) { p += 1; }
    var buf = '';
    function flush() {
      if (buf) { refs.line.appendChild(doc.createTextNode(buf)); buf = ''; }
    }
    var i;
    for (i = 0; i < chars.length; i++) {
      if (chars[i] === '\n') {
        flush();
        refs.line.appendChild(doc.createElement('br'));
      } else if (i >= p) {
        flush();
        refs.line.appendChild(el('span', 'ch-nc', chars[i]));
      } else {
        buf += chars[i];
      }
    }
    flush();
    if (s.focused) {
      s.caret = el('span', 'ch-caret');
      refs.line.appendChild(s.caret);
    }
    s.prev = chars;
  }

  function setButtons() {
    var has = refs.say.value.replace(/^\s+|\s+$/g, '').length > 0;
    refs.btnPlace.disabled = !has;
    refs.btnHand.disabled = s.running || (!has && s.pending === 0);
    refs.pend.textContent = (s.pending > 0) ? ('已放上板 ' + s.pending + ' 段') : '';

    if (has && !refs.btnPlace.disabled) {
      refs.btnPlace.classList.add('guide-place');
    } else {
      refs.btnPlace.classList.remove('guide-place');
    }
    if (s.pending > 0 && !refs.btnHand.disabled) {
      refs.btnHand.classList.add('guide-hand');
    } else {
      refs.btnHand.classList.remove('guide-hand');
    }
  }

  function place() {
    var txt = refs.say.value.replace(/^\s+|\s+$/g, '');
    if (!txt) { return; }
    var item = record('me', { text: txt });
    var seg = textSeg(txt, 'me');
    var after = function () {
      refs.say.value = '';
      s.prev = [];
      if (refs.draft) { refs.draft.hidden = true; refs.draft.textContent = ''; }
      stopGaze();
      renderMe();
    };
    if (s.restoring) {
      /* 恢复还没摆完：这一段先排队，等旧段落接上再露头，顺序和落库一致 */
      s.queued.push({ node: seg, item: item });
      after();
    } else {
      floatUp(seg, after);
      s.history.push(item);
      persist();
    }
    s.pending += 1;
    cancelIdleProactive();
    s.proactiveStreak = 0;
    setButtons();
  }

  function hand() {
    if (s.running) { return; }
    if (refs.say.value.replace(/^\s+|\s+$/g, '').length) { place(); }
    if (s.pending === 0) { return; }
    s.pending = 0;
    cancelIdleProactive();
    s.proactiveStreak = 0;
    startRound(false);
  }

  /* ---------- 对方的一轮与静默主动传讯（问骰 + 拼接字卡） ---------- */

  function cancelIdleProactive() {
    if (s.idleTimer) {
      win.clearTimeout(s.idleTimer);
      s.idleTimer = 0;
    }
  }

  function scheduleIdleProactive() {
    cancelIdleProactive();
    if (s.running || s.restoring || s.pending > 0 || doc.hidden) { return; }

    /* 纯随机脉动周期：每次自然间隔后，系统掷骰叩问 */
    var cycleMs = O.rng && O.rng.range ? Math.round(O.rng.range(15000, 30000)) : 20000;

    s.idleTimer = win.setTimeout(function () {
      if (s.running || s.restoring || s.pending > 0 || doc.hidden) { return; }

      var isFirst = s.history.length === 0;

      /* 纯随机自然掷骰（不加人为控制概率）：
         完全凭自然机缘决定彼方此刻是否有话想说 */
      var willing = false;
      if (O.rng && O.rng.int) {
        willing = isFirst ? (O.rng.int(1, 2) === 1) : (O.rng.int(1, 3) === 1);
      }

      /* 连续主动发言最多 2 次，避免无休止自说自话 */
      if (!isFirst && (s.proactiveStreak || 0) >= 2) {
        willing = false;
      }

      if (willing) {
        /* 摇骰得缘：彼方有话想说，正式进入 1~2 分钟拼接字卡阶段 */
        beginPickingCards();
      } else {
        /* 未成缘：彼方继续沉静倾听，开启下一轮心念周期 */
        scheduleIdleProactive();
      }
    }, cycleMs);
  }

  /* 拼接字卡阶段：真正给 1~2 分钟让对方在后台有时间去拼接字卡；
     如果在这期间没有成功拼接出字卡，则不发出信息 */
  function beginPickingCards() {
    if (s.running) { return; }
    cancelIdleProactive();
    s.proactiveStreak = (s.proactiveStreak || 0) + 1;
    s.locked = true;
    s.mode = 'wait';
    clearLine();
    refs.line.className = 'line wait';

    var sense = el('div', 'ch-sensing');
    sense.appendChild(el('span', 'cs-orb'));
    sense.appendChild(el('span', 'cs-text', '对方正在拼接字卡…'));
    refs.line.appendChild(sense);

    /* 若用户输入框里已有未放上板的草稿，转到底部 myDraft 显影保留，绝不丢失 */
    if (refs.draft) {
      var dv = refs.say.value;
      if (dv.length > 0) {
        refs.draft.hidden = false;
        refs.draft.textContent = dv;
      } else {
        refs.draft.hidden = true;
        refs.draft.textContent = '';
      }
    }
    setButtons();

    /* 对方主动发信息：真正给 1~2 分钟让对方在后台有时间去拼接字卡；
       如果在这期间没有成功拼接出字卡，则不发出信息 */
    var plan = O.engine.plan({
      win: [1, 2],
      sil: 0,
      cards: (O.storage.prefs ? O.storage.prefs().cards : [1, 4]),
      probs: (O.storage.prefs ? O.storage.prefs().probs : {}),
      decks: deckSnapshot(),
      proactive: true
    });

    if (hooks && hooks.light) { hooks.light(); }
    s.plan = plan;
    s.index = 0;
    s.startAt = Date.now();
    s.running = true;
    tick();
  }

  function deckSnapshot() {
    return O.decks && O.decks.snapshot ? O.decks.snapshot() : { word: { items: [] }, special: { items: [] }, tarot: { items: [] } };
  }

  function startPlanAndRun() {
    var p = O.storage.prefs ? O.storage.prefs() : {};
    var plan = O.engine.plan({
      win: p.win,
      sil: p.sil,
      cards: p.cards,
      probs: p.probs,
      decks: deckSnapshot(),
      proactive: false
    });
    if (hooks && hooks.light) { hooks.light(); }
    s.plan = plan;
    s.index = 0;
    s.startAt = Date.now();
    s.running = true;
    tick();
  }

  function startRound(proactive) {
    if (s.running) { return; }
    cancelIdleProactive();
    if (proactive) {
      beginPickingCards();
      return;
    }
    s.proactiveStreak = 0;
    s.locked = true;
    s.mode = 'wait';
    clearLine();
    refs.line.className = 'line wait';
    var sense = el('div', 'ch-sensing');
    sense.appendChild(el('span', 'cs-orb'));
    sense.appendChild(el('span', 'cs-text', '对方正在感知…'));
    refs.line.appendChild(sense);
    setButtons();
    startPlanAndRun();
  }

  function tick() {
    if (!s.running) { return; }
    var plan = s.plan;
    if (!plan) { s.running = false; return; }
    var t = (Date.now() - s.startAt) * s.speed;
    while (s.index < plan.events.length && plan.events[s.index].t <= t) {
      exec(plan.events[s.index]);
      s.index += 1;
      /* exec 里的 send / extinguish 会直接收尾，把 running 关掉、plan 清空 */
      if (!s.running || !s.plan) { return; }
    }
    if (s.index >= plan.events.length) {
      s.running = false;
      return;
    }
    s.timer = win.setTimeout(tick, TICK);
  }

  function playSfx(key) {
    if (O.sfx && O.storage.prefs().sound !== false) { O.sfx.play(key); }
  }

  function beginThemLive() {
    if (s.mode === 'them') { return; }
    s.mode = 'them';
    clearLine();
    refs.line.className = 'line them';
    s.caret = el('span', 'ch-caret');
    refs.line.appendChild(s.caret);
  }

  function pushCard(card) {
    beginThemLive();
    var node = cardNode(card, s.live.length, true);
    var isCard = !!node;
    if (!isCard) {
      node = el('span', 'ch-nc', card.text || '');
    }
    refs.line.insertBefore(node, s.caret || null);
    s.live.push(card);
    s.liveNodes.push(node);
    toBottom();
    if (isCard) {
      armContact();
      /* will-change 只在动画期间挂着（drop-spec §7），760ms 后连 .ch-drop 一起摘掉 */
      win.setTimeout(function () { node.classList.remove('ch-drop'); }, 760);
    } else {
      later(function () { playSfx('drop'); }, 465);
    }
  }

  /* 接触点 465ms 出声（drop-spec §3：0.665 × 700 ≈ 465ms，40px 只剩 1px 的那一下）。
     用真实时间而不是 .ch-pr 的 animationstart：减少动效时那段动画是 none，事件根本不会来；
     也不能用 later()——它会被验收用的 setSpeed 压缩，而 CSS 动画不会被压缩。 */
  function armContact() {
    win.setTimeout(function () { playSfx('drop'); }, 465);
  }

  /* 撤回：B1 向上抽走（drop-spec §4），落定后邻卡归位（§5）。
     时间跟 CSS 对齐，不走 later()——later 会被验收用的 setSpeed 压缩，动画却不会被压缩。 */
  function popCard() {
    if (!s.liveNodes.length) { return; }
    var node = s.liveNodes.pop();
    s.live.pop();
    if (!node) { return; }
    playSfx('retract');
    var cd = node.querySelector('.ch-cd');
    if (!cd) {
      node.classList.add('ch-gone');
      win.setTimeout(function () { dropNode(node); }, 620);
      return;
    }
    if (reduced()) {
      cd.style.opacity = '0';
      win.setTimeout(function () { dropNode(node); }, 80);
      return;
    }
    cd.classList.add('out');
    win.setTimeout(function () { retractDone(node); }, 230);
  }

  function dropNode(node) {
    if (node && node.parentNode) { node.parentNode.removeChild(node); }
  }

  /* 移除被撤回的卡，再用 FLIP 把同一行剩下的卡挪过去：
     记位置 → 摘节点 → 量新位置 → 内联 transform 补差值 → 过渡回 0。
     用 offsetLeft（不受 transform 影响），整个过程只有 transform 在动。 */
  function retractDone(node) {
    var row = node.parentNode;
    if (!row) { return; }
    var list = Array.prototype.slice.call(row.querySelectorAll('.ch-slot'));
    var xs = [];
    var i;
    for (i = 0; i < list.length; i++) { xs.push(list[i].offsetLeft); }
    row.removeChild(node);
    for (i = 0; i < list.length; i++) {
      if (list[i] === node) { continue; }
      moveBy(list[i], xs[i] - list[i].offsetLeft);
    }
  }

  function moveBy(node, dx) {
    if (!dx) { return; }
    var rot = node.style.getPropertyValue('--rot') || '0deg';
    var dy = node.style.getPropertyValue('--dy') || '0px';
    node.classList.add('ch-move');
    node.style.transform = 'translateX(' + dx + 'px) rotate(' + rot + ') translateY(' + dy + ')';
    void node.offsetWidth;
    node.style.transform = '';
    win.setTimeout(function () {
      node.classList.remove('ch-move');
      node.style.transform = '';
    }, 480);
  }

  function clearAll() {
    var nodes = s.liveNodes.slice(0);
    var i;
    for (i = 0; i < nodes.length; i++) {
      (function (n, k) {
        later(function () {
          if (!n.classList.contains('ch-nc')) { n.classList.add('ch-gone'); }
          later(function () { if (n.parentNode) { n.parentNode.removeChild(n); } }, 620);
        }, k * 70);
      })(nodes[i], i);
    }
    s.live = [];
    s.liveNodes = [];
    playSfx('clear');
  }

  function commitThem() {
    var cards = s.live.slice(0);
    var caret = s.caret;
    if (caret && caret.parentNode) { caret.parentNode.removeChild(caret); }
    s.caret = null;
    if (!cards.length) {
      clearLine();
      endRound();
      return;
    }
    var seg = buildSeg(cards, 'them', hhmm());
    var item = record('them', { cards: cards });
    if (s.restoring) {
      s.queued.push({ node: seg, item: item });
    } else {
      refs.hist.appendChild(seg);
      s.history.push(item);
      persist();
    }
    clearLine();
    toBottom();
    applyFade();
    endRound();
  }

  function endRound() {
    s.running = false;
    s.locked = false;
    s.mode = 'me';
    s.plan = null;
    clearLine();
    refs.line.className = 'line';
    renderMe();
    setButtons();
    scheduleIdleProactive();
  }

  function exec(ev) {
    switch (ev.type) {
      case 'start':
        beginThemLive();
        break;
      case 'drop':
        pushCard(ev.card);
        break;
      case 'retract':
        popCard();
        break;
      case 'clear':
        clearAll();
        break;
      case 'pause':
        if (s.caret) { s.caret.classList.add('pool'); }
        playSfx('pause');
        break;
      case 'resume':
        if (s.caret) { s.caret.classList.remove('pool'); }
        break;
      case 'abandon':
        refs.line.classList.add('wash');
        playSfx('abandon');
        later(function () {
          clearLine();
          beginThemLive();
        }, 1000);
        break;
      case 'send':
        commitThem();
        break;
      case 'force':
        var list = ev.cards || [];
        var i;
        for (i = 0; i < list.length; i++) {
          (function (c, k) { later(function () { pushCard(c); }, k * 320); })(list[i], i);
        }
        later(commitThem, list.length * 320 + 700);
        break;
      case 'silence':
        /* 1~2 分钟内未成功拼接出字卡：不发出任何信息，静默归隐 */
        playSfx('silence');
        later(function () {
          clearLine();
          endRound();
        }, 500);
        break;
      case 'extinguish':
        playSfx('silence');
        if (hooks && hooks.snuff) { hooks.snuff(); }
        later(endRound, 900);
        break;
      default:
        break;
    }
  }

  /* ---------- 落库（M3-a）：会话投影 + 事件流 ---------- */

  /* 一条历史段落落库的形状（M3-a 定稿，用户 2026-11-25 选的 A 案）：
       { t, at, who, text, cards }
     who='me'   只带 text（我在板上写下的一段话）
     who='them' 只带 cards（对方落下的卡，按落卡顺序；撤回和抹掉的不在里面）
     t 是距会话开始的毫秒数（星图与回放按它排），at 是落定时刻（印时间、算起止）。 */

  function record(who, payload) {
    var at = Date.now();
    if (!s.startedAt) { s.startedAt = at; }
    return {
      t: at - s.startedAt,
      at: at,
      who: who,
      text: who === 'me' ? (payload.text || '') : '',
      cards: who === 'them' ? (payload.cards || []) : []
    };
  }

  /* 星图卡片上的「牌堆」一栏只记名字：不记下标、不记张数（START-HERE-3 §5）。只装有卡的堆。 */
  function deckNames() {
    if (!O.decks || !O.decks.meta) { return []; }
    var meta = O.decks.meta();
    var out = [];
    var i;
    for (i = 0; i < meta.length; i++) {
      if (meta[i] && meta[i].count > 0) { out.push(meta[i].name); }
    }
    return out;
  }

  /* 每落一段写两处：ev:<No> 是这条会话的全量事件流（回放/星图只读它），
     sessions 只放投影（编号/起止/消息数/牌堆名）。msgCount 按段落算：我一段、对方一段都算 1。
     写不进去不弹窗：设置页「数据」一节写着当前存储是谁，提示放那儿。 */
  function persist() {
    if (!s.no || !O.db) { return; }
    var last = s.history.length ? s.history[s.history.length - 1] : null;
    var row = {
      no: s.no,
      startedAt: s.startedAt,
      endedAt: last ? last.at : s.startedAt,
      msgCount: s.history.length,
      decks: deckNames(),
      recipient: s.recipient ? s.recipient.name : ''
    };
    var i;
    var found = false;
    for (i = 0; i < s.sessions.length; i++) {
      if (s.sessions[i] && s.sessions[i].no === s.no) { s.sessions[i] = row; found = true; }
    }
    if (!found) { s.sessions.push(row); }
    O.db.saveEvents(s.no, s.history).then(null, function () { s.persistFail = true; });
    O.db.saveSessions(s.sessions).then(null, function () { s.persistFail = true; });
  }

  /* 恢复时把一条记录还原成 buildSeg 吃的卡数组 */
  function segCards(item) {
    if (item.who === 'me') { return [{ kind: 'text', text: item.text || '' }]; }
    return item.cards || [];
  }

  /* 刷新后按 No. 恢复：先读 sessions 认领这条会话的起止，再读 ev:<No> 把段落按顺序摆回去。
     恢复不打浮上动画——那是「新写下一段」的动效，不该给昨天的段落补播。
     读不出来就当没有历史，不拦着人继续写。 */
  function restore() {
    var no = O.storage.prefs().session || '';
    s.no = no;
    if (!no || !O.db) { return Promise.resolve(false); }
    var gen = s.gen;
    var items = [];
    s.restoring = true;
    return O.db.loadSessions().then(function (list) {
      var i;
      s.sessions = list || [];
      for (i = 0; i < s.sessions.length; i++) {
        if (s.sessions[i] && s.sessions[i].no === no && s.sessions[i].startedAt) {
          s.startedAt = s.sessions[i].startedAt;
        }
      }
      return O.db.loadEvents(no);
    }).then(function (list) {
      items = list || [];
      if (gen !== s.gen) { return false; }
      var i;
      for (i = 0; i < items.length; i++) {
        refs.hist.appendChild(buildSeg(segCards(items[i]), items[i].who, hhmmAt(items[i].at || Date.now())));
      }
      return true;
    }, function () {
      return false;
    }).then(function (ok) {
      var q = s.queued;
      var i;
      s.queued = [];
      s.restoring = false;
      if (gen !== s.gen) { return false; }
      s.history = items;
      for (i = 0; i < q.length; i++) {
        if (q[i].node) { refs.hist.appendChild(q[i].node); }
        s.history.push(q[i].item);
      }
      /* 尾巴上连续的我方段落 = 已放上板但还没递出：算回 pending，递出按钮才不会哑掉 */
      s.pending = 0;
      for (i = s.history.length - 1; i >= 0; i--) {
        if (s.history[i] && s.history[i].who === 'me') { s.pending += 1; } else { break; }
      }
      toBottom();
      applyFade();
      setButtons();
      if (q.length) { persist(); }
      scheduleIdleProactive();
      return ok;
    });
  }

  /* 送走：给当前会话的投影补上 endedAt，事件流原样留着（星图要读的就是它）。
     一句话都没说过的会话不落库——省得星图上多一个空光点。 */
  function endSession() {
    var at = Date.now();
    var i;
    var row = null;
    if (!s.no || !O.db) { return Promise.resolve(false); }
    for (i = 0; i < s.sessions.length; i++) {
      if (s.sessions[i] && s.sessions[i].no === s.no) { row = s.sessions[i]; }
    }
    if (!row) {
      if (!s.history.length) { return Promise.resolve(false); }
      row = {
        no: s.no,
        startedAt: s.startedAt || at,
        endedAt: at,
        msgCount: s.history.length,
        decks: deckNames(),
        recipient: s.recipient ? s.recipient.name : ''
      };
      s.sessions.push(row);
    } else {
      if (!row.startedAt) { row.startedAt = at; }
      row.endedAt = at;
      row.msgCount = s.history.length;
    }
    return O.db.saveSessions(s.sessions).then(function () { return true; }, function () { return false; });
  }

  function setRecipient(info) {
    s.recipient = info || null;
    var bar = doc.getElementById('bondBar');
    var who = doc.getElementById('bondWho');
    if (bar && who) {
      if (s.recipient && s.recipient.name) {
        who.textContent = s.recipient.name;
        bar.hidden = false;
      } else {
        bar.hidden = true;
      }
    }
  }

  /* 清空全部数据之后用：库删了，内存里这份也必须扔，否则下一段落库会把它写回去。 */
  function reset(no) {
    stopGaze();
    cancelIdleProactive();
    s.proactiveStreak = 0;
    if (s.timer) { win.clearTimeout(s.timer); }
    s.gen += 1;
    s.running = false;
    s.pausedAt = 0;
    s.plan = null;
    s.locked = false;
    s.pending = 0;
    s.mode = 'me';
    s.history = [];
    s.sessions = [];
    s.queued = [];
    s.restoring = false;
    s.persistFail = false;
    s.no = no || '';
    s.startedAt = 0;
    setRecipient(null);
    if (refs) {
      if (refs.hist) {
        while (refs.hist.firstChild) { refs.hist.removeChild(refs.hist.firstChild); }
        applyFade();
      }
      clearLine();
      refs.line.className = 'line';
      renderMe();
      setButtons();
      scheduleIdleProactive();
    }
    return true;
  }

  /* 显影的按住交互：pointer 优先，没有 PointerEvent 的 WebView 退回 touch / mouse。
     长按不能变成选中或系统菜单：按钮上关掉 callout（CSS），contextmenu 直接拦掉。
     keydown 让键盘也能按住（空格 / 回车），失焦与切后台一律松开。 */
  function bindReveal(btn) {
    if (!btn) { return; }
    function on() { reveal(true); }
    function off() { reveal(false); }
    if (win.PointerEvent) {
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    } else {
      btn.addEventListener('touchstart', on);
      btn.addEventListener('touchend', off);
      btn.addEventListener('touchcancel', off);
      btn.addEventListener('mousedown', on);
      btn.addEventListener('mouseup', off);
      btn.addEventListener('mouseleave', off);
    }
    btn.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter' || e.keyCode === 32 || e.keyCode === 13) {
        e.preventDefault();
        on();
      }
    });
    btn.addEventListener('keyup', off);
    btn.addEventListener('blur', off);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    win.addEventListener('blur', off);
  }

  /* ---------- 绑定 ---------- */

  function mount(r, h) {
    refs = r;
    hooks = h || {};
    refs.say.addEventListener('focus', function () {
      s.focused = true;
      renderMe();
      rollGazeOnFocus();
    });
    refs.say.addEventListener('blur', function () {
      s.focused = false;
      renderMe();
      stopGaze();
    });
    refs.say.addEventListener('input', function () { renderMe(); setButtons(); });
    refs.say.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        place();
      }
    });
    refs.now.addEventListener('click', function () {
      refs.say.focus();
    });
    refs.btnPlace.addEventListener('click', place);
    refs.btnHand.addEventListener('click', hand);
    bindReveal(refs.btnReveal);
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) {
        reveal(false);
        stopGaze();
        cancelIdleProactive();
        if (s.running) {
          win.clearTimeout(s.timer);
          s.pausedAt = Date.now();
        }
      } else {
        if (s.running && s.pausedAt) {
          s.startAt += Date.now() - s.pausedAt;
          s.pausedAt = 0;
          tick();
        } else if (!s.running && s.pending === 0) {
          scheduleIdleProactive();
        }
      }
    });
    renderMe();
    setButtons();
    restore();
  }

  /* 只给验收用：看播放器内部状态 */
  function debug() {
    return {
      speed: s.speed,
      mode: s.mode,
      locked: s.locked,
      index: s.index,
      total: s.plan ? s.plan.events.length : -1,
      silent: s.plan ? !!s.plan.silent : null,
      durationMs: s.plan ? s.plan.durationMs : -1,
      elapsed: s.plan ? Date.now() - s.startAt : -1,
      types: s.plan ? s.plan.events.map(function (e) { return e.type; }).join(',') : '',
      no: s.no,
      history: s.history.length,
      pending: s.pending,
      restoring: s.restoring,
      persisted: !s.persistFail
    };
  }

  /* 只给验收用：把时间线压缩 n 倍播放 */
  function setSpeed(n) { s.speed = n > 0 ? n : 1; }

  O.chat = {
    mount: mount,
    setSpeed: setSpeed,
    place: place,
    hand: hand,
    debug: debug,
    restore: restore,
    reset: reset,
    reveal: reveal,
    endSession: endSession,
    setRecipient: setRecipient
  };
})(window);