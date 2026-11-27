/* 牌库页（P2）
   视觉以 F:\参考html\decks.html 为准：汇总行 + 三张牌堆卡 + 两个全屏覆盖层（粘贴 / 选图）。
   数据在 IndexedDB 的 decks 键；这里只做"取出来、画出来、改完存回去"。
   解析规则是纯确定性的（设计定案 §4.1）：不去重、不截断、不做任何语义判断。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;
  var el = O.ui.el;

  var KEYS = ['word', 'special', 'tarot'];
  var LABEL = { word: '字卡', special: '特殊卡', tarot: '塔罗' };
  var MAX_TEXT = 200;
  var MAX_CARDS = 2000;
  var MAX_IMAGES = 60;
  var MAX_GIFTS = 60;

  var decks = null;
  var loading = null;
  var mutateSeq = 0;
  var api = null;
  var els = {};
  var paste = { deck: 'word', armed: false };
  var picks = [];
  var pickBusy = false;
  var gift = { picked: 'bouquet' };

  function byId(id) { return doc.getElementById(id); }

  function count(deck) { return deck && deck.items ? deck.items.length : 0; }

  function sourceLabel(deck) {
    if (!deck) { return '空'; }
    if (deck.source === 'builtin') { return '内置'; }
    if (deck.source === 'image') { return '自定义 · 图卡'; }
    if (deck.source === 'gift') { return '自定义 · 礼物'; }
    return '自定义';
  }

  /* ---------- 列表 ---------- */

  function thumbs(deckKey, deck) {
    var box = el('div', 'th');
    var items = deck && deck.items ? deck.items : [];
    var i;
    var item;
    var n = 0;
    if (items.length === 0) {
      box.appendChild(el('p', 'emp', '空着。贴一些字，或选几张图。'));
      return box;
    }
    if (deckKey === 'tarot') {
      for (i = 0; i < items.length && n < 3; i++) {
        item = items[i];
        if (item.image) {
          var im = doc.createElement('img');
          im.className = 'mi';
          im.src = item.image;
          im.alt = '';
          box.appendChild(im);
          n += 1;
          continue;
        }
        var card = el('span', 'mt');
        card.appendChild(el('span', 'n', item.num || ''));
        card.appendChild(el('span', 'm', item.name || ''));
        card.appendChild(el('span', 'p', '正位'));
        box.appendChild(card);
        n += 1;
      }
      box.appendChild(el('span', 'mt back'));
      return box;
    }
    /* 预览只放 6 项：礼物先露最多 3 个（新加的礼物不然永远排在 16 张字卡后面看不见），
       剩下的位置按原来的导入顺序补文字卡 / 图卡。没有礼物时和以前完全一样。 */
    var order = [];
    var k;
    for (k = 0; k < items.length && order.length < 3; k++) {
      if (items[k].kind === 'gift') { order.push(items[k]); }
    }
    for (k = 0; k < items.length && order.length < 6; k++) {
      if (items[k].kind !== 'gift') { order.push(items[k]); }
    }
    for (i = 0; i < order.length; i++) {
      item = order[i];
      if (item.image) {
        var img = doc.createElement('img');
        img.className = 'mi';
        img.src = item.image;
        img.alt = '';
        box.appendChild(img);
      } else if (item.kind === 'gift') {
        var gico = el('span', 'mg');
        gico.appendChild(O.giftIcons.make(item.gift));
        box.appendChild(gico);
      } else if (item.text) {
        box.appendChild(el('span', 'mw' + (deckKey === 'special' ? ' sp' : ''), item.text));
      }
    }
    return box;
  }

  function deckCard(deckKey) {
    var deck = decks[deckKey];
    var card = el('article', 'dk');
    var head = el('div', 'dh');
    var dName = (deck && deck.name) || LABEL[deckKey] || '自定义牌堆';
    head.appendChild(el('span', 'dn', dName));
    var meta = el('span', 'dm');
    meta.appendChild(doc.createTextNode(count(deck) + ' 张'));
    meta.appendChild(el('i', 'isep'));
    meta.appendChild(doc.createTextNode(sourceLabel(deck)));
    head.appendChild(meta);

    var more = el('button', 'more', '全部');
    more.type = 'button';
    more.disabled = count(deck) === 0;
    more.addEventListener('click', function () { openAll(deckKey); });
    head.appendChild(more);
    card.appendChild(head);
    card.appendChild(thumbs(deckKey, deck));

    var acts = el('div', 'da');
    var pasteBtn = el('button', 'ab', '粘贴导入');
    pasteBtn.type = 'button';
    pasteBtn.addEventListener('click', function () { openPaste(deckKey); });
    acts.appendChild(pasteBtn);

    acts.appendChild(el('i', 'sep'));

    var imgBtn = el('button', 'ab', '选图导入');
    imgBtn.type = 'button';
    imgBtn.addEventListener('click', function () { openImages(deckKey); });
    acts.appendChild(imgBtn);

    if (deckKey === 'special') {
      acts.appendChild(el('i', 'sep'));
      var giftBtn = el('button', 'ab', '加礼物');
      giftBtn.type = 'button';
      giftBtn.addEventListener('click', function () { openGift('special'); });
      acts.appendChild(giftBtn);
    }

    acts.appendChild(el('i', 'sep'));

    var clearBtn = el('button', 'ab', '清空');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () { onClearDeck(deckKey, clearBtn); });
    acts.appendChild(clearBtn);

    if (deckKey === 'word' || deckKey === 'special' || deckKey === 'tarot') {
      var isDefaultIntact = deck && deck.source === 'builtin' && count(deck) > 0;
      if (!isDefaultIntact) {
        var restore = el('button', 'ab r', '恢复内置');
        restore.type = 'button';
        restore.addEventListener('click', function () { restoreDeck(deckKey); });
        acts.appendChild(restore);
      }
    }

    acts.appendChild(el('i', 'sep'));
    var delBtn = el('button', 'ab del', '删除');
    delBtn.type = 'button';
    delBtn.addEventListener('click', function () { onDeleteDeck(deckKey); });
    acts.appendChild(delBtn);

    card.appendChild(acts);
    return card;
  }

  function createNewDeck() {
    var name = win.prompt('请输入新牌堆名称：', '新牌堆');
    if (!name || !name.trim()) { return; }
    name = name.trim();
    var id = 'deck_' + Date.now().toString(36);
    decks[id] = {
      name: name,
      source: 'custom',
      updatedAt: Date.now(),
      items: []
    };
    mutateSeq += 1;
    O.db.saveDecks(decks).then(render);
  }

  function onDeleteDeck(deckKey) {
    var deck = decks[deckKey];
    var name = (deck && deck.name) || LABEL[deckKey] || '此牌堆';
    O.ui.confirm({
      title: '确认删除牌堆',
      msg: '确认完全删除「' + name + '」？此操作不可撤销。',
      okText: '确认删除',
      cancelText: '取消',
      danger: true
    }).then(function (sure) {
      if (!sure) { return; }
      delete decks[deckKey];
      mutateSeq += 1;
      O.db.saveDecks(decks).then(render);
    });
  }

  function render() {
    if (!els.list) { return; }
    els.list.textContent = '';
    var keys = Object.keys(decks || {});
    var total = 0;
    var i;
    for (i = 0; i < keys.length; i++) { total += count(decks[keys[i]]); }
    els.sum.textContent = '共 ' + keys.length + ' 堆洗在一起抽　总计 ' + total + ' 张';
    for (i = 0; i < keys.length; i++) { els.list.appendChild(deckCard(keys[i])); }

    var newBtn = el('button', 'btn-new-deck', '+ 新建牌堆');
    newBtn.type = 'button';
    newBtn.addEventListener('click', createNewDeck);
    els.list.appendChild(newBtn);

    if (O.db.mode() !== 'indexeddb') {
      els.list.appendChild(el('p', 'd-note', '存储：' + O.db.label() + '。系统可能在空间紧张时清理本机数据。'));
    }
  }

  /* ---------- 解析：粘贴 ---------- */

  function textOf(item) {
    if (!item) { return ''; }
    if (typeof item === 'string') { return item; }
    return typeof item.text === 'string' ? item.text : (typeof item.name === 'string' ? item.name : '');
  }

  function isDataImage(v) {
    return typeof v === 'string' && v.indexOf('data:image/') === 0;
  }

  function cleanImage(v, dropped) {
    if (typeof v === 'undefined' || v === null || v === '') { return null; }
    if (isDataImage(v)) { return v; }
    dropped.badImage += 1;
    return null;
  }

  function parseJson(raw, deckKey, out) {
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      out.badJson = true;
      return;
    }
    var list = null;
    if (Array.isArray(data)) {
      list = data;
    } else if (data && typeof data === 'object' && Array.isArray(data.cards)) {
      list = data.cards;
    }
    if (!list) {
      out.badJson = true;
      return;
    }
    var i;
    for (i = 0; i < list.length; i++) {
      var rawItem = list[i];
      if (typeof rawItem === 'string') {
        if (rawItem.length > MAX_TEXT) { out.tooLong.push(i + 1); continue; }
        out.items.push({ text: rawItem });
        continue;
      }
      if (!rawItem || typeof rawItem !== 'object') { out.tooLong.push(i + 1); continue; }
      if (deckKey === 'tarot') {
        var name = typeof rawItem.name === 'string' ? rawItem.name : '';
        if (!name) { out.tooLong.push(i + 1); continue; }
        out.items.push({
          num: typeof rawItem.num === 'string' ? rawItem.num : '',
          name: name,
          upright: typeof rawItem.upright === 'string' ? rawItem.upright : '',
          reversed: typeof rawItem.reversed === 'string' ? rawItem.reversed : '',
          image: cleanImage(rawItem.image, out)
        });
      } else {
        var text = typeof rawItem.text === 'string' ? rawItem.text : '';
        var img = cleanImage(rawItem.image, out);
        if (!text && !img) { out.tooLong.push(i + 1); continue; }
        if (text.length > MAX_TEXT) { out.tooLong.push(i + 1); continue; }
        out.items.push(img ? { text: text, image: img } : { text: text });
      }
    }
  }

  function parseLines(raw, deckKey, out) {
    var lines = raw.split('\n');
    var i;
    var line;
    for (i = 0; i < lines.length; i++) {
      line = lines[i].trim();
      if (!line) { continue; }
      if (line.length > MAX_TEXT) { out.tooLong.push(i + 1); continue; }
      if (deckKey === 'tarot') {
        out.items.push({ num: '', name: line, upright: '', reversed: '' });
      } else {
        out.items.push({ text: line });
      }
    }
  }

  function parsePaste(rawText, deckKey) {
    var out = { items: [], tooLong: [], badJson: false, badImage: 0, html: false, duplicates: 0 };
    var raw = String(rawText == null ? '' : rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var trimmed = raw.replace(/^\s+/, '');
    if (trimmed.charAt(0) === '<') {
      out.html = true;
      return out;
    }
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      parseJson(trimmed, deckKey, out);
    } else {
      parseLines(raw, deckKey, out);
    }
    /* 重复只统计、不去重：去重属于纠偏。 */
    var seen = {};
    var i;
    var key;
    for (i = 0; i < out.items.length; i++) {
      key = textOf(out.items[i]);
      if (!key) { continue; }
      if (seen[key]) { out.duplicates += 1; } else { seen[key] = 1; }
    }
    return out;
  }

  function longestOf(items) {
    var i;
    var max = 0;
    var len;
    for (i = 0; i < items.length; i++) {
      len = textOf(items[i]).length;
      if (len > max) { max = len; }
    }
    return max;
  }

  function feedback() {
    var parsed = parsePaste(els.pta.value, paste.deck);
    els.fb.textContent = '';
    var n = parsed.items.length;

    if (parsed.html) {
      els.fb.appendChild(el('span', 'q', '看起来是网页源码，已拒收。贴纯文字或 JSON。'));
      setPasteEnabled(false);
      disarm();
      return 0;
    }
    if (parsed.badJson) {
      els.fb.appendChild(el('span', 'q', 'JSON 读不出来。要 {cards:[…]} 或直接一个数组。'));
      setPasteEnabled(false);
      disarm();
      return 0;
    }
    if (n === 0) {
      els.fb.appendChild(el('span', 'q', parsed.tooLong.length ? '每一行都超过 200 字，全部拒收。' : '还没有内容'));
      setPasteEnabled(false);
      disarm();
      return 0;
    }
    els.fb.appendChild(el('span', null, '已识别 ' + n + ' 张'));
    els.fb.appendChild(el('i', 'sep'));
    els.fb.appendChild(el('span', null, '最长 ' + longestOf(parsed.items) + ' 字'));
    if (parsed.duplicates) {
      els.fb.appendChild(el('i', 'sep'));
      els.fb.appendChild(el('span', 'q', parsed.duplicates + ' 行重复'));
    }
    if (parsed.tooLong.length) {
      els.fb.appendChild(el('i', 'sep'));
      els.fb.appendChild(el('span', 'q', '第 ' + parsed.tooLong.slice(0, 6).join('、') + ' 行超 200 字，已拒收'));
    }
    if (parsed.badImage) {
      els.fb.appendChild(el('i', 'sep'));
      els.fb.appendChild(el('span', 'q', parsed.badImage + ' 张图的地址不是本机数据，已丢弃'));
    }
    setPasteEnabled(true);
    disarm();
    return n;
  }

  function setPasteEnabled(on) {
    els.pReplace.disabled = !on;
    els.pAppend.disabled = !on;
  }

  function disarm() {
    paste.armed = false;
    els.pReplace.textContent = '替换现有';
  }

  function openPaste(deckKey) {
    if (pickBusy) { return; }
    paste.deck = deckKey;
    els.pDeck.textContent = '· ' + LABEL[deckKey];
    els.pta.value = '';
    feedback();
    disarm();
    O.ui.openOv(els.ovPaste, els.pta);
  }

  function finishPaste(msg) {
    els.fb.textContent = '';
    els.fb.appendChild(el('span', null, msg));
    setPasteEnabled(false);
    win.setTimeout(function () {
      O.ui.closeOv(els.ovPaste);
      render();
    }, 1100);
  }

  function commitPaste(mode) {
    if (!decks) { return; }
    var parsed = parsePaste(els.pta.value, paste.deck);
    var n = parsed.items.length;
    if (!n) { return; }
    var deck = decks[paste.deck];
    var items;
    if (mode === 'replace') {
      items = parsed.items.slice(0);
    } else {
      items = (deck.items || []).slice(0).concat(parsed.items);
    }
    if (items.length > MAX_CARDS) {
      var ok = win.confirm('加起来 ' + items.length + ' 张，超过 ' + MAX_CARDS + ' 张。只留前 ' + MAX_CARDS + ' 张？');
      if (!ok) { return; }
      items = items.slice(0, MAX_CARDS);
    }
    saveDeck(paste.deck, {
      name: (deck && deck.name) || LABEL[paste.deck] || "自定义牌堆",
      source: 'paste',
      updatedAt: Date.now(),
      items: items
    }, mode === 'replace' ? '已替换为 ' + n + ' 张' : '已追加 ' + n + ' 张，洗回牌堆');
  }

  /* opts 不给 = 走粘贴弹层那套收尾；礼物弹层自己带 ov / fb，别串到粘贴的反馈条上。 */
  function saveDeck(deckKey, next, okMsg, opts) {
    var o = opts || {};
    var ov = o.ov || els.ovPaste;
    var fb = o.fb || els.fb;
    mutateSeq += 1;
    var prev = decks[deckKey];
    decks[deckKey] = next;
    O.db.saveDecks(decks).then(function () {
      fb.textContent = '';
      fb.appendChild(el('span', null, okMsg));
      if (!o.ov) { setPasteEnabled(false); }
      win.setTimeout(function () {
        O.ui.closeOv(ov);
        render();
      }, 1100);
    }).then(null, function (err) {
      decks[deckKey] = prev;
      fb.textContent = '';
      fb.appendChild(el('span', 'q', '保存失败：' + ((err && err.message) || '本机存储不可用')));
      if (!o.ov) { setPasteEnabled(false); }
    });
  }

  function restoreDeck(deckKey) {
    if (!decks || !decks[deckKey]) { return; }
    var deck = decks[deckKey];
    var fresh = O.builtin.fresh(deckKey);
    O.ui.confirm({
      title: '恢复内置牌堆',
      msg: '确认用内置的 ' + count(fresh) + ' 张替换现在的 ' + count(deck) + ' 张？',
      okText: '确认恢复',
      cancelText: '取消'
    }).then(function (sure) {
      if (!sure) { return; }
      mutateSeq += 1;
      var prev = decks[deckKey];
      decks[deckKey] = fresh;
      O.db.saveDecks(decks).then(function () {
        render();
      }).then(null, function () {
        decks[deckKey] = prev;
        win.alert('保存失败：本机存储不可用，牌堆没有改动。');
      });
    });
  }

  /* ---------- 清空（点第二下才生效） ---------- */

  var clearArmed = {};

  function onClearDeck(deckKey, btn) {
    if (!decks || !decks[deckKey]) { return; }
    if (!clearArmed[deckKey]) {
      clearArmed[deckKey] = true;
      btn.textContent = '再点一次';
      win.setTimeout(function () {
        clearArmed[deckKey] = false;
        btn.textContent = '清空';
      }, 2600);
      return;
    }
    clearArmed[deckKey] = false;
    btn.textContent = '清空';
    var prev = decks[deckKey];
    mutateSeq += 1;
    decks[deckKey] = { name: LABEL[deckKey], source: 'paste', updatedAt: Date.now(), items: [] };
    O.db.saveDecks(decks).then(function () {
      render();
    }).then(null, function () {
      decks[deckKey] = prev;
      render();
      win.alert('保存失败：本机存储不可用，牌堆没有改动。');
    });
  }

  /* ---------- 展字笺（全景字卡台） ---------- */

  var activeFilter = 'all';
  var wSelIndex = -1;
  var tarotSel = null;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function getDeckItems(key) {
    return (decks && decks[key] && decks[key].items) ? decks[key].items : [];
  }

  function renderWordSection(items) {
    var sec = el('div', 'deck-sec');
    sec.setAttribute('data-sec', 'word');
    if (activeFilter !== 'all' && activeFilter !== 'word') { sec.hidden = true; }

    var head = el('div', 'sec-head-bar');
    var h3 = el('h3');
    h3.appendChild(doc.createTextNode('字卡'));
    h3.appendChild(el('em', '', 'Words'));
    head.appendChild(h3);
    head.appendChild(el('p', '', '点选一字，看它想说的话'));
    sec.appendChild(head);

    var wl = el('div', 'wl');
    var stage = el('div', 'wl-stage');
    stage.appendChild(el('span', 'wl-corner wl-c1'));
    stage.appendChild(el('span', 'wl-corner wl-c2'));

    var wlNo = el('span', 'wl-no', '01 / ' + pad2(Math.max(1, items.length)));
    stage.appendChild(wlNo);

    var wlIn = el('div', 'wl-in');
    var wlChar = el('div', 'wl-char', (items[0] && items[0].text) || '—');
    var wlRule = el('span', 'wl-rule');
    var wlText = el('p', 'wl-text', (items[0] && items[0].text) ? '心念所至，字墨生辉。' : '此堆尚无字卡。');
    wlIn.appendChild(wlChar);
    wlIn.appendChild(wlRule);
    wlIn.appendChild(wlText);
    stage.appendChild(wlIn);
    stage.appendChild(el('span', 'w-seal', '拓'));
    wl.appendChild(stage);

    var list = el('ul', 'wl-list');
    var i;
    for (i = 0; i < items.length; i++) {
      (function (item, idx) {
        var li = el('li', 'wl-item');
        var btn = el('button', 'wl-row' + (idx === 0 ? ' on' : ''));
        btn.type = 'button';
        btn.appendChild(el('span', 'wn', pad2(idx + 1)));
        btn.appendChild(el('span', 'wc', item.text || (item.image ? '图' : '—')));
        btn.appendChild(el('span', 'wt', item.text ? ('字卡 · ' + item.text) : '自定义图卡'));
        btn.addEventListener('click', function () {
          var rows = list.querySelectorAll('.wl-row');
          var k;
          for (k = 0; k < rows.length; k++) { rows[k].classList.remove('on'); }
          btn.classList.add('on');
          wlIn.classList.add('swap');
          win.setTimeout(function () {
            wlNo.textContent = pad2(idx + 1) + ' / ' + pad2(items.length);
            wlChar.textContent = item.text || '—';
            wlText.textContent = item.text ? ('字卡 · 「' + item.text + '」已入牌序。') : '自定义图卡。';
            wlIn.classList.remove('swap');
          }, 240);
        });
        li.appendChild(btn);
        list.appendChild(li);
      })(items[i], i);
    }
    wl.appendChild(list);
    sec.appendChild(wl);
    return sec;
  }

  function renderTarotSection(items) {
    var sec = el('div', 'deck-sec');
    sec.setAttribute('data-sec', 'tarot');
    if (activeFilter !== 'all' && activeFilter !== 'tarot') { sec.hidden = true; }

    var head = el('div', 'sec-head-bar');
    var h3 = el('h3');
    h3.appendChild(doc.createTextNode('塔罗'));
    h3.appendChild(el('em', '', 'Arcana'));
    head.appendChild(h3);
    head.appendChild(el('p', '', '牌从袋中摆好 · 点选即可修改牌意与翻转'));
    sec.appendChild(head);

    var stage = el('div', 'tr-stage');

    /* 塔罗牌袋 */
    var pouchWrap = el('div', 'pouch-wrap');
    var pouch = el('div', 'pouch');
    pouch.innerHTML = '<svg viewBox="0 0 220 260" aria-hidden="true">' +
      '<ellipse class="pk-in" cx="110" cy="80" rx="54" ry="13"/>' +
      '<path class="pk-line" d="M56 80 C 72 65, 148 65, 164 80"/>' +
      '<path class="pk-body" d="M56 80 C 38 112, 20 168, 38 214 C 54 250, 166 250, 182 214 C 200 168, 182 112, 164 80 C 146 95, 74 95, 56 80 Z"/>' +
      '<path class="pk-stitch" d="M60 97 C 82 110, 138 110, 160 97"/>' +
      '<text class="pk-txt" x="110" y="195" text-anchor="middle">ARCANA</text>' +
      '</svg>';
    pouchWrap.appendChild(pouch);

    var pouchAct = el('div', 'pouch-act');
    var pouchN = el('p', 'pouch-n', '已摆出 ' + items.length + ' 张');
    pouchAct.appendChild(pouchN);

    var addBtn = el('button', 'btn-quiet', '＋ 添一张新牌');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () {
      var fresh = { num: String(items.length), name: '新牌', upright: '心意明朗', reversed: '稍安勿躁' };
      items.push(fresh);
      saveCurrentDecks('已添加一张新塔罗');
    });
    pouchAct.appendChild(addBtn);
    pouchWrap.appendChild(pouchAct);
    stage.appendChild(pouchWrap);

    /* 牌阵展示 */
    var gridBox = el('div', 'tgrid-box');
    var i;
    for (i = 0; i < items.length; i++) {
      (function (item, idx) {
        var wrap = el('div', 'tslot-wrap');
        var card = el('div', 'tc-card');
        var inner = el('div', 'tc-inner');
        inner.appendChild(el('span', 'tc-num', item.num || pad2(idx + 1)));

        var glyph = el('div', 'tc-glyph');
        glyph.innerHTML = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="12"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6"/></svg>';
        inner.appendChild(glyph);

        inner.appendChild(el('span', 'tc-name', item.name || '无题'));
        inner.appendChild(el('span', 'tc-pos', '正位'));
        card.appendChild(inner);

        var meanBox = el('div', 'tc-mean-box');
        meanBox.appendChild(el('p', 'tc-mean-text', item.upright || '心意澄澈，水到渠成。'));
        card.appendChild(meanBox);

        card.addEventListener('click', function () {
          var allCards = gridBox.querySelectorAll('.tc-card');
          var m;
          for (m = 0; m < allCards.length; m++) { allCards[m].classList.remove('sel'); }
          card.classList.add('sel');
          selectTarot(item, idx, card);
        });

        wrap.appendChild(card);
        gridBox.appendChild(wrap);
      })(items[i], i);
    }
    stage.appendChild(gridBox);

    /* 侧边编辑面板 */
    var aside = el('aside', 'ed-aside');
    var emptyHint = el('p', 'emp', '点选一张牌，在这里修改名字、牌意或翻转');
    aside.appendChild(emptyHint);

    var edBody = el('div', 'ed-body');
    edBody.hidden = true;

    var edTop = el('div', 'ed-top-bar');
    var edTitle = el('h4', '', '第 01 张');
    var edClose = el('button', 'ed-close', '×');
    edClose.type = 'button';
    edClose.addEventListener('click', function () {
      edBody.hidden = true;
      emptyHint.hidden = false;
      var allCards = gridBox.querySelectorAll('.tc-card');
      var m;
      for (m = 0; m < allCards.length; m++) { allCards[m].classList.remove('sel'); }
    });
    edTop.appendChild(edTitle);
    edTop.appendChild(edClose);
    edBody.appendChild(edTop);

    var edNumF = el('div', 'ed-field');
    edNumF.appendChild(el('label', '', '编号'));
    var edNumIn = el('input');
    edNumF.appendChild(edNumIn);
    edBody.appendChild(edNumF);

    var edNameF = el('div', 'ed-field');
    edNameF.appendChild(el('label', '', '牌名'));
    var edNameIn = el('input');
    edNameF.appendChild(edNameIn);
    edBody.appendChild(edNameF);

    var edOrientF = el('div', 'ed-field');
    edOrientF.appendChild(el('span', 'ed-lbl', '朝向'));
    var segBox = el('div', 'seg-orient');
    var btnUp = el('button', 'on', '正位');
    var btnDown = el('button', '', '逆位');
    btnUp.type = 'button';
    btnDown.type = 'button';
    segBox.appendChild(btnUp);
    segBox.appendChild(btnDown);
    edOrientF.appendChild(segBox);
    edBody.appendChild(edOrientF);

    var edUpF = el('div', 'ed-field');
    edUpF.appendChild(el('label', '', '正位牌意'));
    var edUpTa = el('textarea');
    edUpTa.rows = 2;
    edUpF.appendChild(edUpTa);
    edBody.appendChild(edUpF);

    var edDownF = el('div', 'ed-field');
    edDownF.appendChild(el('label', '', '逆位牌意'));
    var edDownTa = el('textarea');
    edDownTa.rows = 2;
    edDownF.appendChild(edDownTa);
    edBody.appendChild(edDownF);

    var actBox = el('div', 'ed-actions');
    var btnFlip = el('button', 'btn-quiet', '翻看牌意');
    btnFlip.type = 'button';
    var btnDel = el('button', 'btn-quiet danger', '删除这张');
    btnDel.type = 'button';
    actBox.appendChild(btnFlip);
    actBox.appendChild(btnDel);
    edBody.appendChild(actBox);

    aside.appendChild(edBody);
    stage.appendChild(aside);
    sec.appendChild(stage);

    function selectTarot(item, idx, cardElm) {
      emptyHint.hidden = true;
      edBody.hidden = false;
      edTitle.textContent = '第 ' + pad2(idx + 1) + ' 张';
      edNumIn.value = item.num || '';
      edNameIn.value = item.name || '';
      edUpTa.value = item.upright || '';
      edDownTa.value = item.reversed || '';

      edNumIn.oninput = function () {
        item.num = edNumIn.value;
        cardElm.querySelector('.tc-num').textContent = item.num || '·';
        saveDecksDebounced();
      };
      edNameIn.oninput = function () {
        item.name = edNameIn.value;
        cardElm.querySelector('.tc-name').textContent = item.name || '无题';
        saveDecksDebounced();
      };
      edUpTa.oninput = function () {
        item.upright = edUpTa.value;
        cardElm.querySelector('.tc-mean-text').textContent = (cardElm.classList.contains('rev') ? item.reversed : item.upright) || '（未填）';
        saveDecksDebounced();
      };
      edDownTa.oninput = function () {
        item.reversed = edDownTa.value;
        cardElm.querySelector('.tc-mean-text').textContent = (cardElm.classList.contains('rev') ? item.reversed : item.upright) || '（未填）';
        saveDecksDebounced();
      };

      btnUp.onclick = function () {
        btnUp.classList.add('on');
        btnDown.classList.remove('on');
        cardElm.classList.remove('rev');
        cardElm.querySelector('.tc-pos').textContent = '正位';
        cardElm.querySelector('.tc-mean-text').textContent = item.upright || '（未填）';
      };
      btnDown.onclick = function () {
        btnDown.classList.add('on');
        btnUp.classList.remove('on');
        cardElm.classList.add('rev');
        cardElm.querySelector('.tc-pos').textContent = '逆位';
        cardElm.querySelector('.tc-mean-text').textContent = item.reversed || '（未填）';
      };

      btnFlip.onclick = function () {
        cardElm.classList.toggle('mean');
      };

      btnDel.onclick = function () {
        items.splice(idx, 1);
        saveCurrentDecks('已移除该塔罗牌');
      };
    }

    return sec;
  }

  function renderGiftSection(items) {
    var sec = el('div', 'deck-sec');
    sec.setAttribute('data-sec', 'gift');
    if (activeFilter !== 'all' && activeFilter !== 'gift') { sec.hidden = true; }

    var head = el('div', 'sec-head-bar');
    var h3 = el('h3');
    h3.appendChild(doc.createTextNode('礼物'));
    h3.appendChild(el('em', '', 'Gifts'));
    head.appendChild(h3);
    head.appendChild(el('p', '', '轻触一枚，翻看赠言与心意'));
    sec.appendChild(head);

    var plate = el('div', 'sheet-plate');
    plate.appendChild(el('div', 'sweep-light'));

    var grid = el('div', 'gift-cards-grid');
    var i;
    for (i = 0; i < items.length; i++) {
      (function (item) {
        var cell = el('div', 'gift-card-cell');
        var card = el('div', 'gift-item');

        var inner = el('div', 'gift-inner');
        inner.appendChild(el('span', 'g-seal', '礼'));

        var ico = el('span', 'g-ico');
        ico.appendChild(O.giftIcons.make(item.gift || 'bouquet'));
        inner.appendChild(ico);

        inner.appendChild(el('span', 'gn', item.name || '赠礼'));
        inner.appendChild(el('span', 'gs', '礼 · 寄春'));
        card.appendChild(inner);

        var back = el('div', 'gift-back');
        back.appendChild(el('p', 'gb-text', item.meaning || '替你点在窗边，归来不必摸黑。'));
        back.appendChild(el('span', 'gb-name', item.name || '赠礼'));
        card.appendChild(back);

        card.addEventListener('click', function () {
          card.classList.toggle('turned');
        });

        cell.appendChild(card);
        grid.appendChild(cell);
      })(items[i]);
    }
    plate.appendChild(grid);
    sec.appendChild(plate);
    return sec;
  }

  var saveTimer = 0;
  function saveDecksDebounced() {
    if (saveTimer) { win.clearTimeout(saveTimer); }
    saveTimer = win.setTimeout(function () {
      O.db.saveDecks(decks);
    }, 600);
  }

  function saveCurrentDecks(msg) {
    mutateSeq += 1;
    O.db.saveDecks(decks).then(function () {
      render();
      openAll(activeFilter);
    });
  }

  function renderStage(container) {
    container.textContent = '';
    var wordItems = getDeckItems('word');
    var tarotItems = getDeckItems('tarot');
    var giftItems = [];
    var specItems = getDeckItems('special');
    var i;
    for (i = 0; i < specItems.length; i++) {
      if (specItems[i].kind === 'gift') { giftItems.push(specItems[i]); }
    }
    if (giftItems.length === 0) {
      /* 如果特殊卡里没有礼物，自动装配几个默认精美礼物方便把玩 */
      giftItems = [
        { kind: 'gift', gift: 'bouquet', name: '一束花', meaning: '从这边的春天剪下的，不知你那边几月。' },
        { kind: 'gift', gift: 'lamp', name: '一盏灯', meaning: '替你点在窗边，回来时不必摸黑。' },
        { kind: 'gift', gift: 'letter', name: '一封信', meaning: '写了很多，最后只留下一句：想你。' },
        { kind: 'gift', gift: 'umbrella', name: '一把伞', meaning: '若下雨，就撑这一把。' }
      ];
    }

    container.appendChild(renderWordSection(wordItems));
    container.appendChild(renderTarotSection(tarotItems));
    container.appendChild(renderGiftSection(giftItems));
  }

  function openAll(deckKey) {
    if (!decks) { return; }
    activeFilter = (deckKey === 'special' ? 'gift' : deckKey) || 'all';

    var fltBtns = els.deckFilters ? els.deckFilters.querySelectorAll('button') : [];
    var b;
    for (b = 0; b < fltBtns.length; b++) {
      fltBtns[b].classList.toggle('on', fltBtns[b].getAttribute('data-f') === activeFilter);
    }

    var totalCnt = count(decks.word) + count(decks.tarot) + count(decks.special);
    if (els.aCnt) { els.aCnt.textContent = '共 ' + totalCnt + ' 枚'; }
    if (els.aDeck) {
      els.aDeck.textContent = '· ' + (activeFilter === 'all' ? '全部' : (LABEL[activeFilter] || activeFilter));
    }

    if (els.deckStageBody) {
      renderStage(els.deckStageBody);
    }
    O.ui.openOv(els.ovAll, els.aClose);
  }

  /* ---------- 选图 ---------- */

  function updateCnt() {
    els.iCnt.textContent = '已选 ' + picks.length + ' 张';
    els.iReplace.disabled = picks.length === 0;
    els.iAppend.disabled = picks.length === 0;
    if (els.iAdd) { els.iAdd.style.display = picks.length >= MAX_IMAGES ? 'none' : ''; }
  }

  function addTile(uri, fresh) {
    var tile = el('span', 'im' + (fresh ? ' mat' : ''));
    var img = doc.createElement('img');
    img.src = uri;
    img.alt = '';
    tile.appendChild(img);
    var x = el('button', 'x');
    x.type = 'button';
    x.setAttribute('aria-label', '移除这张');
    x.addEventListener('click', function () {
      var i;
      for (i = 0; i < picks.length; i++) {
        if (picks[i].node === tile) { picks.splice(i, 1); break; }
      }
      updateCnt();
      tile.className = 'im gone';
      win.setTimeout(function () {
        if (tile.parentNode) { tile.parentNode.removeChild(tile); }
      }, 640);
    });
    tile.appendChild(x);
    els.iGrid.insertBefore(tile, els.iAdd);
    picks.push({ node: tile, uri: uri });
  }

  function openImages(deckKey) {
    paste.deck = deckKey;
    els.iDeck.textContent = '· ' + ((decks[deckKey] && decks[deckKey].name) || LABEL[deckKey] || '牌堆');
    els.iGrid.textContent = '';
    picks = [];
    els.iGrid.appendChild(els.iAdd);
    updateCnt();
    O.ui.openOv(els.ovImg, els.iAdd);
  }

  /* 选图 → canvas 压到长边 512 / JPEG 0.82 → data: URI。
     只用本机文件，不发任何请求。 */
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var reader = new win.FileReader();
      reader.onerror = function () { reject(new Error('读不了这张图')); };
      reader.onload = function () {
        var img = new win.Image();
        img.onerror = function () { reject(new Error('这张图打不开')); };
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, 512 / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var cv = doc.createElement('canvas');
          cv.width = cw;
          cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function onFiles(files) {
    if (!files || !files.length || pickBusy) { return; }
    pickBusy = true;
    var list = [];
    var i;
    for (i = 0; i < files.length; i++) { list.push(files[i]); }
    var index = 0;
    function step() {
      if (index >= list.length || picks.length >= MAX_IMAGES) {
        pickBusy = false;
        updateCnt();
        els.iFile.value = '';
        return;
      }
      var file = list[index];
      index += 1;
      if (file.type.indexOf('image/') !== 0) { step(); return; }
      compress(file).then(function (uri) {
        addTile(uri, true);
        updateCnt();
        step();
      }).then(null, function () {
        step();
      });
    }
    step();
  }

  function imgDone(verb) {
    if (!picks.length || !decks || !decks[paste.deck]) { return; }
    mutateSeq += 1;
    var uris = [];
    var i;
    for (i = 0; i < picks.length; i++) { uris.push(picks[i].uri); }
    var deck = decks[paste.deck];
    var items;
    var k;
    if (verb === 'replace') { items = []; } else { items = (deck.items || []).slice(0); }
    for (k = 0; k < uris.length; k++) {
      if (paste.deck === 'tarot') {
        items.push({ num: '', name: '', upright: '', reversed: '', image: uris[k] });
      } else {
        items.push({ text: '', image: uris[k] });
      }
    }
    if (items.length > MAX_IMAGES && verb !== 'replace') {
      win.alert('每堆最多 ' + MAX_IMAGES + ' 张带图，先清掉一些再导入。');
      return;
    }
    var prev = decks[paste.deck];
    decks[paste.deck] = {
      name: (deck && deck.name) || LABEL[paste.deck] || "自定义牌堆",
      source: 'image',
      updatedAt: Date.now(),
      items: items
    };
    O.db.saveDecks(decks).then(function () {
      els.iCnt.textContent = (verb === 'replace' ? '已替换为 ' : '已追加 ') + uris.length + ' 张，洗回牌堆';
      els.iReplace.disabled = true;
      els.iAppend.disabled = true;
      els.iAdd.style.display = 'none';
      win.setTimeout(function () {
        O.ui.closeOv(els.ovImg);
        render();
      }, 1100);
    }).then(null, function (err) {
      decks[paste.deck] = prev;
      els.iCnt.textContent = '保存失败：' + ((err && err.message) || '本机存储不可用');
    });
  }

  /* ---------- 礼物（特别卡第三种卡片）----------
     预设图形 8 个（Oracle.giftIcons），名字与含义都由用户输入、原样保存；
     这一层不做生成、不截断、不做语义判断——和粘贴导入同一条规矩。 */

  function giftCount(deck) {
    var items = deck && deck.items ? deck.items : [];
    var i;
    var n = 0;
    for (i = 0; i < items.length; i++) {
      if (items[i].kind === 'gift') { n += 1; }
    }
    return n;
  }

  function trimName(v) { return String(v).replace(/^\s+|\s+$/g, ''); }

  var giftZh = {};

  function pickGift(key) {
    gift.picked = key;
    if (els.gPick) { els.gPick.textContent = '已选：' + (giftZh[key] || ''); }
    var cells = els.gGrid.children;
    var i;
    for (i = 0; i < cells.length; i++) {
      var on = cells[i].getAttribute('data-k') === key;
      cells[i].className = on ? 'icell on' : 'icell';
      cells[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function giftReady() {
    var name = trimName(els.gName.value);
    return name.length > 0 && name.length <= 12 && els.gMeaning.value.length <= MAX_TEXT;
  }

  function giftFeedback() {
    els.gNameCnt.textContent = trimName(els.gName.value).length + ' / 12';
    els.gMeanCnt.textContent = els.gMeaning.value.length + ' / ' + MAX_TEXT;
    els.gAppend.disabled = !giftReady();
  }

  function buildGiftGrid() {
    if (els.gGrid.children.length) { return; }
    var list = O.giftIcons.list();
    var i;
    for (i = 0; i < list.length; i++) {
      (function (item) {
        var cell = el('button', 'icell');
        cell.type = 'button';
        cell.setAttribute('role', 'radio');
        cell.setAttribute('aria-checked', 'false');
        cell.setAttribute('aria-label', item.zh);
        cell.setAttribute('data-k', item.key);
        giftZh[item.key] = item.zh;
        cell.appendChild(O.giftIcons.make(item.key));
        cell.addEventListener('click', function () { pickGift(item.key); });
        els.gGrid.appendChild(cell);
      })(list[i]);
    }
  }

  function openGift() {
    if (!decks || !decks.special) { return; }
    buildGiftGrid();
    els.gName.value = '';
    els.gMeaning.value = '';
    els.gFb.textContent = '';
    pickGift('bouquet');
    giftFeedback();
    O.ui.openOv(els.ovGift, els.gName);
  }

  function commitGift() {
    if (!decks || !decks.special || !giftReady()) { return; }
    var deck = decks.special;
    var fb = els.gFb;
    if (giftCount(deck) >= MAX_GIFTS) {
      fb.textContent = '';
      fb.appendChild(el('span', 'q', '这一堆已经有 ' + MAX_GIFTS + ' 张礼物了'));
      return;
    }
    var items = (deck.items || []).slice(0);
    items.push({
      kind: 'gift',
      gift: gift.picked,
      name: trimName(els.gName.value),
      meaning: els.gMeaning.value
    });
    saveDeck('special', {
      name: LABEL.special,
      source: 'gift',
      updatedAt: Date.now(),
      items: items
    }, '已加一张礼物', { ov: els.ovGift, fb: fb });
  }
  /* ---------- 绑定 ---------- */

  function bind() {
    els.pta.addEventListener('input', feedback);
    els.pAppend.addEventListener('click', function () { commitPaste('append'); });
    els.pReplace.addEventListener('click', function () {
      if (!paste.armed) {
        paste.armed = true;
        els.pReplace.textContent = '再点一次';
        return;
      }
      commitPaste('replace');
    });
    els.pCancel.addEventListener('click', function () {
      O.ui.closeOv(els.ovPaste);
      disarm();
    });
    O.ui.bindEsc(els.ovPaste, function () {
      O.ui.closeOv(els.ovPaste);
      disarm();
    });

    els.iAdd.addEventListener('click', function () {
      if (picks.length >= MAX_IMAGES) { return; }
      els.iFile.click();
    });
    els.iFile.addEventListener('change', function () { onFiles(els.iFile.files); });
    els.iCancel.addEventListener('click', function () {
      picks = [];
      O.ui.closeOv(els.ovImg);
    });
    O.ui.bindEsc(els.ovImg, function () {
      picks = [];
      O.ui.closeOv(els.ovImg);
    });
    els.iAppend.addEventListener('click', function () { imgDone('append'); });
    els.iReplace.addEventListener('click', function () { imgDone('replace'); });

    els.gName.addEventListener('input', giftFeedback);
    els.gMeaning.addEventListener('input', giftFeedback);
    els.gAppend.addEventListener('click', commitGift);
    els.gCancel.addEventListener('click', function () { O.ui.closeOv(els.ovGift); });
    O.ui.bindEsc(els.ovGift, function () { O.ui.closeOv(els.ovGift); });

    els.aClose.addEventListener('click', function () { O.ui.closeOv(els.ovAll); });
    O.ui.bindEsc(els.ovAll, function () { O.ui.closeOv(els.ovAll); });

    if (els.deckFilters) {
      els.deckFilters.addEventListener('click', function (e) {
        var btn = e.target;
        if (!btn || btn.tagName !== 'BUTTON') { return; }
        var f = btn.getAttribute('data-f');
        if (!f) { return; }
        var fltBtns = els.deckFilters.querySelectorAll('button');
        var b;
        for (b = 0; b < fltBtns.length; b++) { fltBtns[b].classList.remove('on'); }
        btn.classList.add('on');
        activeFilter = f;
        var secs = els.deckStageBody ? els.deckStageBody.querySelectorAll('.deck-sec') : [];
        var s;
        for (s = 0; s < secs.length; s++) {
          var secF = secs[s].getAttribute('data-sec');
          secs[s].hidden = !(activeFilter === 'all' || activeFilter === secF);
        }
      });
    }
  }

  function mount(refs) {
    els = refs;
    bind();
  }

  /* 首次运行写入内置牌库。
     坑：file:// 下第一次开 IndexedDB（或退到 localStorage）可能要十几秒，
     这期间用户可能已经动手导入了。所以落种前先看 mutateSeq 有没有变过：
     变过就说明 decks 已经是用户/别的流程改好的，不能再拿内置盖回去。 */
  function load() {
    if (loading) { return loading; }
    var seq = mutateSeq;
    loading = O.db.loadDecks().then(function (data) {
      if (data && typeof data === "object" && Object.keys(data).length > 0) {
        decks = data;
        return true;
      }
      if (!decks) { decks = O.builtin.all(); }
      if (mutateSeq !== seq) { return true; }
      return O.db.saveDecks(decks).then(function () { return true; }, function () { return false; });
    });
    loading.then(function () { loading = null; }, function () { loading = null; });
    return loading;
  }

  function open() {
    if (!decks) {
      if (els.sum) { els.sum.textContent = '正在读牌堆…'; }
      return load().then(function () { render(); }, function (err) {
        if (els.sum) { els.sum.textContent = '牌堆读不出来：' + ((err && err.message) || '本机存储不可用'); }
      });
    }
    render();
    return Promise.resolve(true);
  }

  O.decks = {
    mount: mount,
    load: load,
    open: open,
    render: render,
    total: function () {
      if (!decks) { return 0; }
      var keys = Object.keys(decks);
      var sum = 0;
      for (var i = 0; i < keys.length; i++) { sum += count(decks[keys[i]]); }
      return sum;
    },
    counts: function () {
      if (!decks) { return {}; }
      var res = {};
      var keys = Object.keys(decks);
      for (var i = 0; i < keys.length; i++) { res[keys[i]] = count(decks[keys[i]]); }
      return res;
    },
    snapshot: function () { return decks || {}; },
    loaded: function () { return decks !== null; },
    meta: function () {
      if (!decks) { return []; }
      var keys = Object.keys(decks);
      return keys.map(function (k) {
        var deck = decks[k];
        return {
          key: k,
          name: (deck && deck.name) || LABEL[k] || '自定义牌堆',
          count: count(deck),
          source: sourceLabel(deck)
        };
      });
    }
  };
})(window);