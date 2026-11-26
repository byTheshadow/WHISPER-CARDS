/* 唯一随机源。规则：全项目只经由 Oracle.rng 取随机数；任何文件都不出现浏览器内置弱随机调用。
   整数范围必须拒绝采样，不能取模。
   seeded() 是唯一的例外出口：只给「布局 / 视觉」用（星图的星尘位置、旋臂、星云团），
   同一个种子必须每次打开都一样，所以不能用 crypto，也不能在每帧重新取。
   内容抽取（抽不抽沉默、落哪张卡、停多久）一律走 int / float / pick / chance，不许用 seeded。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var c = win.crypto || win.msCrypto;
  var pool = null;
  var idx = 0;
  var ok = !!(c && typeof c.getRandomValues === 'function');

  function refill() {
    pool = new Uint32Array(32);
    c.getRandomValues(pool);
    idx = 0;
  }

  function u32() {
    if (!ok) { throw new Error('这个环境没有 crypto.getRandomValues'); }
    if (!pool || idx >= pool.length) { refill(); }
    var v = pool[idx];
    idx = idx + 1;
    return v;
  }

  O.rng = {
    available: ok,
    u32: u32,
    float: function () { return u32() / 4294967296; },
    int: function (min, max) {
      var lo = Math.ceil(min);
      var hi = Math.floor(max);
      if (hi < lo) { throw new Error('rng.int 区间为空'); }
      var r = hi - lo + 1;
      var lim = Math.floor(4294967296 / r) * r;
      var x = u32();
      while (x >= lim) { x = u32(); }
      return lo + (x % r);
    },
    range: function (a, b) { return a + O.rng.float() * (b - a); },
    pick: function (arr) { return arr[O.rng.int(0, arr.length - 1)]; },
    chance: function (p) { return O.rng.float() < p; },
    bytes: function (n) {
      var a = new Uint8Array(n);
      var o = 0;
      while (o < n) {
        var step = Math.min(n - o, 65536);
        c.getRandomValues(a.subarray(o, o + step));
        o += step;
      }
      return a;
    },
    /* mulberry32：确定性序列。种子相同时每次结果一致。
       只允许布局 / 视觉使用（见文件头）。 */
    seeded: function (seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t = t ^ (t + Math.imul(t ^ (t >>> 7), t | 61));
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
  };
})(window);