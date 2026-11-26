/* IndexedDB 封装（库名 stardust，v1，只有一个 kv 对象仓库）
   放体积大的东西：decks（三个牌堆）、sessions（会话）、events（M3 起的事件流）。
   坑：file:// 下首次打开 IndexedDB 可能十几秒不回调（实测 >15s），所以必须有超时降级，
   阈值用 20s，别用 1.2s。超时或不可用时整体退到 localStorage（再不行退到内存），
   界面上必须写明"不会保留"，不能假装存上了。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var DB_NAME = 'stardust';
  var DB_VER = 1;
  var STORE = 'kv';
  var LS_KEY = 'stardust.store.v1';
  var OPEN_TIMEOUT = 20000;

  var db = null;
  var mode = 'memory';
  var reason = '';
  var opening = null;
  var cache = { decks: null, sessions: null, events: {} };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function lsWrite(obj) {
    try {
      win.localStorage.setItem(LS_KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function lsRead() {
    try {
      var raw = win.localStorage.getItem(LS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function lsUsable() {
    var k = LS_KEY + '.probe';
    try {
      win.localStorage.setItem(k, '1');
      win.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function openIdb() {
    return new Promise(function (resolve, reject) {
      if (!win.indexedDB) { reject(new Error('没有 indexedDB')); return; }
      var req;
      try {
        req = win.indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var handle = req.result;
        if (!handle.objectStoreNames.contains(STORE)) { handle.createObjectStore(STORE); }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打不开')); };
      req.onblocked = function () { reject(new Error('被其他窗口占用')); };
    });
  }

  function tryIdb() {
    return new Promise(function (resolve) {
      var done = false;
      var timer = win.setTimeout(function () {
        if (done) { return; }
        done = true;
        resolve({ ok: false, why: '打开超时（' + (OPEN_TIMEOUT / 1000) + 's）' });
      }, OPEN_TIMEOUT);
      openIdb().then(function (handle) {
        if (done) { return; }
        done = true;
        win.clearTimeout(timer);
        db = handle;
        resolve({ ok: true, why: '' });
      }, function (err) {
        if (done) { return; }
        done = true;
        win.clearTimeout(timer);
        resolve({ ok: false, why: (err && err.message) || '打不开' });
      });
    });
  }

  /* 从 localStorage 升到 IndexedDB 时，把降级期间写下的那份搬过去一次。
     不搬就会出现：这次超时落进 localStorage 存了牌堆，下次 IndexedDB 正常了，
     读到的是空库，于是又拿内置牌库落种，用户刚导入的东西看起来凭空消失。
     只做一次性搬运，之后仍然只有一个真值，不双写、不镜像。 */
  function promoteFromLs() {
    var all = lsRead();
    var keys = Object.keys(all);
    if (!keys.length) { return Promise.resolve(false); }
    var chain = Promise.resolve(true);
    var i;
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return get(key).then(function (cur) {
          if (cur !== null) { return true; }
          return put(key, all[key]).then(function () { return true; }, function () { return false; });
        });
      });
    });
    return chain.then(function () {
      try { win.localStorage.removeItem(LS_KEY); } catch (e) { /* 没有 localStorage */ }
      return true;
    });
  }

  function ready() {
    if (opening) { return opening; }
    opening = tryIdb().then(function (r) {
      if (r.ok) {
        mode = 'indexeddb';
        return promoteFromLs().then(function () { return 'indexeddb'; }, function () { return 'indexeddb'; });
      }
      reason = r.why;
      if (lsUsable()) { mode = 'localStorage'; return mode; }
      mode = 'memory';
      return mode;
    });
    return opening;
  }

  function get(key) {
    return new Promise(function (resolve, reject) {
      if (mode !== 'indexeddb') {
        var all = lsRead();
        resolve(typeof all[key] === 'undefined' ? null : all[key]);
        return;
      }
      var tx;
      try { tx = db.transaction(STORE, 'readonly'); } catch (e) { reject(e); return; }
      var req = tx.objectStore(STORE).get(key);
      req.onsuccess = function () { resolve(typeof req.result === 'undefined' ? null : req.result); };
      req.onerror = function () { reject(req.error || new Error('读取失败')); };
    });
  }

  function put(key, value) {
    return new Promise(function (resolve, reject) {
      if (mode === 'memory') { reject(new Error('没有可用的存储')); return; }
      if (mode === 'localStorage') {
        var all = lsRead();
        all[key] = value;
        if (!lsWrite(all)) {
          mode = 'memory';
          reject(new Error('本机空间不够'));
          return;
        }
        resolve(true);
        return;
      }
      var tx;
      try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { reject(e); return; }
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('写入失败')); };
      tx.onabort = function () { reject(tx.error || new Error('写入中断')); };
    });
  }

  function ensure() {
    if (mode === 'memory' && reason) { return Promise.reject(new Error('牌堆存储不可用：' + reason)); }
    if (mode === 'memory') { return Promise.reject(new Error('牌堆存储不可用')); }
    return Promise.resolve(true);
  }

  function loadDecks() {
    return ready().then(ensure).then(function () {
      if (cache.decks) { return clone(cache.decks); }
      return get('decks').then(function (value) {
        cache.decks = value || null;
        return value ? clone(value) : null;
      });
    });
  }

  function saveDecks(decks) {
    return ready().then(ensure).then(function () {
      return put('decks', decks);
    }).then(function () {
      cache.decks = clone(decks);
      return true;
    });
  }

  function loadSessions() {
    return ready().then(ensure).then(function () {
      if (cache.sessions) { return clone(cache.sessions); }
      return get('sessions').then(function (value) {
        cache.sessions = value || null;
        return value ? clone(value) : [];
      });
    });
  }

  function saveSessions(list) {
    return ready().then(ensure).then(function () {
      return put('sessions', list);
    }).then(function () {
      cache.sessions = clone(list);
      return true;
    });
  }

  /* 事件流：一次会话一整条，键 ev:<会话号>。回放与星图都只读这一份。
     每段历史一条记录（{t, at, who, text, cards}），形状由 chat.js 定，这里只负责存取。 */
  function evKey(no) { return 'ev:' + no; }

  function loadEvents(no) {
    return ready().then(ensure).then(function () {
      var key = evKey(no);
      if (cache.events[key]) { return clone(cache.events[key]); }
      return get(key).then(function (value) {
        var list = value && value.length ? value : [];
        cache.events[key] = list;
        return clone(list);
      });
    });
  }

  function saveEvents(no, list) {
    return ready().then(ensure).then(function () {
      return put(evKey(no), list);
    }).then(function () {
      cache.events[evKey(no)] = clone(list);
      return true;
    });
  }

  function dropIdb() {
    return new Promise(function (resolve) {
      if (!win.indexedDB) { resolve(true); return; }
      var settled = false;
      var timer = win.setTimeout(function () { if (!settled) { settled = true; resolve(false); } }, 3000);
      try {
        var req = win.indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = function () { if (!settled) { settled = true; win.clearTimeout(timer); resolve(true); } };
        req.onerror = function () { if (!settled) { settled = true; win.clearTimeout(timer); resolve(false); } };
        req.onblocked = function () { if (!settled) { settled = true; win.clearTimeout(timer); resolve(false); } };
      } catch (e) {
        if (!settled) { settled = true; win.clearTimeout(timer); resolve(false); }
      }
    });
  }

  function clear() {
    cache = { decks: null, sessions: null, events: {} };
    try { win.localStorage.removeItem(LS_KEY); } catch (e) { /* 没有 localStorage */ }
    return dropIdb().then(function () {
      db = null;
      opening = null;
      mode = 'memory';
      reason = '';
      return true;
    });
  }

  function label() {
    if (mode === 'indexeddb') { return 'IndexedDB'; }
    if (mode === 'localStorage') { return 'localStorage（降级）'; }
    if (reason) { return '内存（' + reason + '）'; }
    return '内存（不会保留）';
  }

  O.db = {
    ready: ready,
    loadDecks: loadDecks,
    saveDecks: saveDecks,
    loadSessions: loadSessions,
    saveSessions: saveSessions,
    loadEvents: loadEvents,
    saveEvents: saveEvents,
    clear: clear,
    mode: function () { return mode; },
    label: label
  };
})(window);