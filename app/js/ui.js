/* 公共小件（三页共用一套，不在页面里各写一份；START-HERE-3 §3.1）
   开关 / 分段 / 折叠 / 按住确认 / 全屏覆盖层。
   规矩：用户数据只走 createElement + textContent；className 只由代码给，不拼用户内容。
   基线 Chrome 61：不假定 pointer 事件、不用可选链、不写 inset 简写。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) { node.className = cls; }
    if (typeof text === 'string') { node.textContent = text; }
    return node;
  }

  /* ---------- 全屏覆盖层（牌库页在用） ---------- */

  function openOv(node, focusEl) {
    node.hidden = false;
    node.className = 'ov on';
    doc.body.classList.add('lock');
    if (focusEl && typeof focusEl.focus === 'function') {
      win.setTimeout(function () { try { focusEl.focus(); } catch (e) { /* 焦点拿不到就算了 */ } }, 30);
    }
  }

  function closeOv(node) {
    node.className = 'ov';
    node.hidden = true;
    doc.body.classList.remove('lock');
  }

  function bindEsc(node, onEsc) {
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        onEsc();
      }
    });
  }

  /* ---------- 开关 ---------- */

  function switchCtl(opts) {
    var o = opts || {};
    var b = el('button', 'sw');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    if (o.label) { b.setAttribute('aria-label', o.label); }
    function set(on) { b.setAttribute('aria-checked', on ? 'true' : 'false'); }
    b.addEventListener('click', function () {
      var next = b.getAttribute('aria-checked') !== 'true';
      set(next);
      if (o.onChange) { o.onChange(next); }
    });
    set(!!o.value);
    return { node: b, set: set };
  }

  /* ---------- 分段 ---------- */

  function segCtl(opts) {
    var o = opts || {};
    var wrap = el('div', 'segc');
    var btns = [];
    var i;
    function set(value) {
      var k;
      for (k = 0; k < btns.length; k++) {
        var on = btns[k].getAttribute('data-v') === value;
        btns[k].className = on ? 'on' : '';
        btns[k].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    function pick(opt) {
      var b = el('button', null, opt.t);
      b.type = 'button';
      b.setAttribute('data-v', opt.v);
      b.addEventListener('click', function () {
        set(opt.v);
        if (o.onChange) { o.onChange(opt.v); }
      });
      wrap.appendChild(b);
      btns.push(b);
    }
    for (i = 0; i < o.options.length; i++) { pick(o.options[i]); }
    set(o.value);
    return { node: wrap, set: set };
  }

  /* ---------- 折叠 ----------
     高度走 inline style，因为 Chrome 61 没有 height:auto 过渡。
     展开状态下窗口变宽会重算一次高度；收起状态不重算，省一次强制布局。 */

  function foldCtl(opts) {
    var o = opts || {};
    var host = el('div', 'fold');
    var head = el('div', 'fold__head');
    var label = el('div', 'row__label');
    label.appendChild(doc.createTextNode(o.label || ''));
    if (o.hint) { label.appendChild(el('small', null, o.hint)); }
    head.appendChild(label);
    var btn = el('button', 'lnk', o.openText || '展开');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    head.appendChild(btn);
    var panel = el('div', 'fold__panel');
    var inner = el('div', 'fold__in');
    if (o.body) { inner.appendChild(o.body); }
    panel.appendChild(inner);
    host.appendChild(head);
    host.appendChild(panel);

    var isOpen = false;
    function set(next, instant) {
      isOpen = !!next;
      btn.textContent = isOpen ? (o.closeText || '收起') : (o.openText || '展开');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (instant) { panel.style.transition = 'none'; }
      panel.style.height = isOpen ? (inner.offsetHeight + 'px') : '0px';
      if (instant) { void panel.offsetHeight; panel.style.transition = ''; }
    }
    btn.addEventListener('click', function () { set(!isOpen, false); });
    win.addEventListener('resize', function () { if (isOpen) { set(true, true); } });
    set(!!o.open, true);
    return {
      node: host,
      set: set,
      toggle: function () { set(!isOpen, false); }
    };
  }

  /* ---------- 按住确认（底部弹层） ----------
     规矩：按住约 1.2s 进度条走满，走满后松手才执行；没走满就松手 = 取消，进度归零。 */

  function holdSheet(opts) {
    var o = opts || {};
    var root = el('div', 'hk');
    root.setAttribute('aria-hidden', 'true');
    var scrim = el('div', 'hk__scrim');
    var pn = el('div', 'hk__pn');
    pn.setAttribute('role', 'dialog');
    pn.setAttribute('aria-modal', 'true');

    var title = el('div', 'hk__t', o.title || '');
    var body = el('p', 'hk__b', o.body || '');
    var hold = el('button', 'hk__hold', o.holdText || '按住');
    hold.type = 'button';
    var bar = el('div', 'hk__bar');
    var fill = el('i');
    bar.appendChild(fill);
    var hint = el('div', 'hk__h', o.hintText || '');
    var cancel = el('button', 'hk__cancel', o.cancelText || '取消');
    cancel.type = 'button';

    pn.appendChild(title);
    pn.appendChild(body);
    pn.appendChild(hold);
    pn.appendChild(bar);
    pn.appendChild(hint);
    pn.appendChild(cancel);
    root.appendChild(scrim);
    root.appendChild(pn);
    doc.body.appendChild(root);

    var timer = 0;
    var pressed = false;
    var filled = false;
    var busy = false;
    var returnFocus = null;

    function reset() {
      win.clearTimeout(timer);
      pressed = false;
      filled = false;
      busy = false;
      hold.disabled = false;
      hold.textContent = o.holdText || '按住';
      hint.textContent = o.hintText || '';
      fill.style.transition = 'none';
      fill.style.transform = 'scaleX(0)';
      void fill.offsetHeight;
      fill.style.transition = '';
    }

    function press() {
      if (busy || pressed) { return; }
      pressed = true;
      fill.style.transition = 'transform 1.2s linear';
      fill.style.transform = 'scaleX(1)';
      hold.textContent = o.pressingText || '继续按住';
      hint.textContent = o.pressingHint || '松手即取消';
      timer = win.setTimeout(function () {
        filled = true;
        hold.textContent = o.readyText || '松手执行';
        hint.textContent = '';
      }, 1200);
    }

    /* 执行中不改口说"已完成"：先写"正在执行"，等 Promise 落地再写结果，然后才收起弹层。
       本机存储慢的时候（file:// 下首次开库十几秒）用户看得到它还在做。 */
    function execute() {
      busy = true;
      hold.disabled = true;
      hold.textContent = o.busyText || '正在执行…';
      hint.textContent = '';
      function settle(text) {
        return function () {
          hold.textContent = text;
          win.setTimeout(function () { api.close(); }, 600);
        };
      }
      var result = o.onConfirm ? o.onConfirm() : null;
      if (result && typeof result.then === 'function') {
        result.then(settle(o.doneText || '已执行'), settle(o.failText || '没有完成'));
      } else {
        settle(o.doneText || '已执行')();
      }
    }

    function release() {
      if (!pressed) { return; }
      win.clearTimeout(timer);
      pressed = false;
      if (filled) { execute(); }
      else { reset(); }
    }

    var api = {
      open: function () {
        returnFocus = doc.activeElement;
        reset();
        root.className = 'hk on';
        root.setAttribute('aria-hidden', 'false');
        doc.body.classList.add('lock');
        win.setTimeout(function () { try { hold.focus(); } catch (e) { /* 焦点拿不到就算了 */ } }, 30);
      },
      close: function () {
        if (!root.classList.contains('on')) { return; }
        reset();
        root.className = 'hk';
        root.setAttribute('aria-hidden', 'true');
        doc.body.classList.remove('lock');
        if (returnFocus && typeof returnFocus.focus === 'function') {
          try { returnFocus.focus(); } catch (e) { /* 焦点拿不到就算了 */ }
        }
        returnFocus = null;
      },
      node: root
    };

    hold.addEventListener('touchstart', function (e) { e.preventDefault(); press(); });
    hold.addEventListener('touchend', function (e) { e.preventDefault(); release(); });
    hold.addEventListener('touchcancel', function (e) { e.preventDefault(); release(); });
    hold.addEventListener('mousedown', function (e) { e.preventDefault(); press(); });
    hold.addEventListener('mouseup', release);
    hold.addEventListener('mouseleave', release);
    hold.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cancel.addEventListener('click', api.close);
    scrim.addEventListener('click', api.close);
    bindEsc(pn, api.close);

    return api;
  }

  /* ---------- 步进器 ----------
     Chrome 61 上 range 的样式不可控，而且这套视觉里没有滑块（参考稿是双滑块/两个数字都行，
     这里选最稳的一种）：纯文字的「− 值 ＋」，一次一步，到头就禁用。 */

  function stepCtl(opts) {
    var o = opts || {};
    var min = typeof o.min === 'number' ? o.min : 0;
    var max = typeof o.max === 'number' ? o.max : 100;
    var step = o.step || 1;
    var value = o.value;
    var wrap = el('div', 'stp');
    wrap.setAttribute('role', 'group');
    if (o.label) { wrap.setAttribute('aria-label', o.label); }
    var minus = el('button', 'stp__b', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', (o.label || '') + ' 减少');
    var val = el('span', 'stp__v', '');
    val.setAttribute('aria-live', 'polite');
    var plus = el('button', 'stp__b', '＋');
    plus.type = 'button';
    plus.setAttribute('aria-label', (o.label || '') + ' 增加');
    wrap.appendChild(minus);
    wrap.appendChild(val);
    wrap.appendChild(plus);

    function paint() {
      val.textContent = String(value) + (o.unit || '');
      minus.disabled = value <= min;
      plus.disabled = value >= max;
    }

    function set(v, silent) {
      var n = Math.round(typeof v === 'number' ? v : parseFloat(v));
      if (isNaN(n)) { return; }
      if (n < min) { n = min; }
      if (n > max) { n = max; }
      value = n;
      paint();
      if (!silent && o.onChange) { o.onChange(n); }
    }

    minus.addEventListener('click', function () { set(value - step); });
    plus.addEventListener('click', function () { set(value + step); });
    paint();
    return { node: wrap, set: set, get: function () { return value; } };
  }

  O.ui = {
    el: el,
    openOv: openOv,
    closeOv: closeOv,
    bindEsc: bindEsc,
    switchCtl: switchCtl,
    segCtl: segCtl,
    foldCtl: foldCtl,
    stepCtl: stepCtl,
    holdSheet: holdSheet
  };
})(window);