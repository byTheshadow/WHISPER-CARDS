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
      var restore = el('button', 'ab r', '恢复内置');
      restore.type = 'button';
      restore.disabled = !deck || deck.source === 'builtin';
      restore.addEventListener('click', function () { restoreDeck(deckKey); });
      acts.appendChild(restore);
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
    var sure = win.confirm('确认完全删除「' + name + '」？此操作不可撤销。');
    if (!sure) { return; }
    delete decks[deckKey];
    mutateSeq += 1;
    O.db.saveDecks(decks).then(render);
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
    mutateSeq += 1;
    var deck = decks[deckKey];
    var fresh = O.builtin.fresh(deckKey);
    var sure = win.confirm('用内置的 ' + count(fresh) + ' 张替换现在的 ' + count(deck) + ' 张？');
    if (!sure) { return; }
    var prev = decks[deckKey];
    decks[deckKey] = fresh;
    O.db.saveDecks(decks).then(function () {
      render();
    }).then(null, function () {
      decks[deckKey] = prev;
      win.alert('保存失败：本机存储不可用，牌堆没有改动。');
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

  /* ---------- 全部卡牌 ---------- */

  function itemRow(deckKey, item) {
    var row = el('div', 'ac');
    if (item.kind === 'gift') {
      var gico = el('span', 'ac__i gift');
      gico.appendChild(O.giftIcons.make(item.gift));
      row.appendChild(gico);
      var gbody = el('span', 'ac__g');
      gbody.appendChild(el('span', 'ac__gn', item.name || '无题'));
      if (item.meaning) { gbody.appendChild(el('span', 'ac__p', item.meaning)); }
      row.appendChild(gbody);
      return row;
    }
    if (item.image) {
      var im = doc.createElement('img');
      im.className = 'ac__i';
      im.src = item.image;
      im.alt = '';
      row.appendChild(im);
    }
    if (deckKey === 'tarot') {
      row.appendChild(el('span', 'ac__n', item.num || '—'));
      row.appendChild(el('span', 'ac__m', item.name || '无题'));
      var mean = '正位 ' + (item.upright || '未填') + '　逆位 ' + (item.reversed || '未填');
      row.appendChild(el('span', 'ac__p', mean));
      return row;
    }
    if (item.text) {
      row.appendChild(el('span', 'ac__t', item.text));
    } else if (item.image) {
      row.appendChild(el('span', 'ac__t', '（只有图）'));
    }
    return row;
  }

  /* 2000 张也不能一次全塞进 DOM：按 300 一批补，覆盖层一关就停。 */
  function renderAllItems(deckKey, items) {
    var i = 0;
    if (!items.length) {
      els.aList.appendChild(el('p', 'emp', '这堆是空的。'));
      return;
    }
    function step() {
      if (els.ovAll.hidden) { return; }
      var chunk = doc.createDocumentFragment();
      var end = Math.min(items.length, i + 300);
      for (; i < end; i++) { chunk.appendChild(itemRow(deckKey, items[i])); }
      els.aList.appendChild(chunk);
      if (i < items.length) { win.setTimeout(step, 0); }
    }
    step();
  }

  function openAll(deckKey) {
    if (!decks || !decks[deckKey]) { return; }
    var deck = decks[deckKey];
    els.aDeck.textContent = '· ' + ((deck && deck.name) || LABEL[deckKey] || '牌堆');
    els.aCnt.textContent = '共 ' + count(deck) + ' 张';
    els.aList.textContent = '';
    O.ui.openOv(els.ovAll, els.aClose);
    renderAllItems(deckKey, (deck.items || []).slice(0));
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