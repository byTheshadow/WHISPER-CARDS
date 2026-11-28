/* 设置层（偏好）
   只存呈现与规则参数：localStorage 同步读，首帧就能用，不会先闪一下默认色。
   牌堆 / 会话 / 事件流走 IndexedDB（见 db.js），这里不双写、不镜像。
   本轮补齐 M3 引擎要用的字段（win / sil / open / cards / fade / speed / probs）：
   界面还没露出来的，先按默认值存着；读旧版本时缺什么补什么，并写回一次。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var KEY = 'stardust.prefs.v1';
  var DEFAULTS = {
    theme: 'light',
    bgTheme: 'A',
    rm: false,
    session: '',
    win: [2, 5],
    sil: 15,
    open: false,
    cards: [1, 4],
    fade: true,
    speed: '1',
    sound: true,
    chatMode: 'sync',       /* sync 心念共感（模式1） | async 凝思落笺（模式2） */
    probs: { retract: 4, clear: 6, pause: 14, abandon: 5, send: 25 }
  };
  var PROB_KEYS = ['retract', 'clear', 'pause', 'abandon', 'send'];
  var prefs = null;
  var mode = 'memory';

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function clampInt(v, lo, hi, fallback) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    if (isNaN(n)) { return fallback; }
    n = Math.round(n);
    if (n < lo) { return lo; }
    if (n > hi) { return hi; }
    return n;
  }

  function pair(raw, lo, hi, fallback) {
    var a = fallback[0];
    var b = fallback[1];
    if (raw && raw.length === 2) {
      a = clampInt(raw[0], lo, hi, a);
      b = clampInt(raw[1], lo, hi, b);
    }
    if (b < a) { b = a; }
    return [a, b];
  }

  function sanitize(raw) {
    var p = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') { return p; }
    if (raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system') { p.theme = raw.theme; }
    if (raw.bgTheme === 'A' || raw.bgTheme === 'C' || raw.bgTheme === 'D') { p.bgTheme = raw.bgTheme; }
    if (typeof raw.rm === 'boolean') { p.rm = raw.rm; }
    if (typeof raw.session === 'string' && /^[0-9]{4}$/.test(raw.session)) { p.session = raw.session; }
    p.win = pair(raw.win, 1, 15, DEFAULTS.win);
    p.cards = pair(raw.cards, 1, 12, DEFAULTS.cards);
    p.sil = clampInt(raw.sil, 0, 60, DEFAULTS.sil);
    if (typeof raw.open === 'boolean') { p.open = raw.open; }
    if (typeof raw.fade === 'boolean') { p.fade = raw.fade; }
    if (raw.speed === '1' || raw.speed === '2' || raw.speed === '3') { p.speed = raw.speed; }
    if (typeof raw.sound === 'boolean') { p.sound = raw.sound; }
    if (raw.chatMode === 'sync' || raw.chatMode === 'async') { p.chatMode = raw.chatMode; }
    var i;
    var k;
    for (i = 0; i < PROB_KEYS.length; i++) {
      k = PROB_KEYS[i];
      if (raw.probs && typeof raw.probs === 'object') {
        p.probs[k] = clampInt(raw.probs[k], 0, 60, DEFAULTS.probs[k]);
      }
    }
    return p;
  }

  function read() {
    try {
      var raw = win.localStorage.getItem(KEY);
      mode = 'localstorage';
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      mode = 'memory';
      return null;
    }
  }

  function write() {
    if (mode !== 'localstorage') { return; }
    try {
      win.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (e) {
      mode = 'memory';
    }
  }

  function load() {
    var raw = read();
    prefs = sanitize(raw);
    /* theme 三种：light / dark / system（P3 加，system 由 app.js 求值） */
    /* 迁移：旧版本只有 theme / rm / session，缺字段补默认值后写回一次。
       只在确实缺东西时写，避免每次启动都动一遍存储。 */
    if (raw && JSON.stringify(raw) !== JSON.stringify(prefs)) { write(); }
    return clone(prefs);
  }

  function save(next) {
    prefs = sanitize(next);
    write();
    return clone(prefs);
  }

  function clear() {
    prefs = clone(DEFAULTS);
    try { win.localStorage.removeItem(KEY); } catch (e) { /* 没有 localStorage */ }
    return clone(prefs);
  }

  function info() {
    return { prefs: mode === 'localstorage' ? 'localStorage' : '内存（不会保留）' };
  }

  load();

  O.storage = {
    load: load,
    save: save,
    clear: clear,
    prefs: function () { return clone(prefs); },
    defaults: function () { return clone(DEFAULTS); },
    mode: function () { return mode; },
    info: info
  };
})(window);