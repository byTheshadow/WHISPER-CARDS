/* 礼物卡片（对话页用）
   正面 = 图形 + 名字；点一下（或 Enter / Space）绕 Y 轴翻到背面看含义。
   规矩来自参考稿 D 段：一次只翻一张；再点翻回；减少动效时只是"换面"，不转。
   对话页 M3 落地时只要把 card 插进文字流里，别在这里猜排版。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;

  var openCard = null;
  var openClose = null;

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) { node.className = cls; }
    if (typeof text === 'string') { node.textContent = text; }
    return node;
  }

  function closeOpen() {
    if (openCard && openClose) { openClose(); }
    openCard = null;
    openClose = null;
  }

  /* item: { kind:'gift', gift:'bouquet', name:'花束', meaning:'…' }
     opts: { big:true } 只给试验页用的放大态 */
  function create(item, opts) {
    var o = opts || {};
    var data = item || {};
    var name = data.name || '无题';
    var meaning = data.meaning || '';
    var base = 'gcard' + (o.big ? ' tall' : '');

    var card = el('span', base);
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-expanded', 'false');
    card.setAttribute('aria-label', '礼物「' + name + '」' + (meaning ? '，点开看含义' : '，还没有写含义'));

    var inner = el('span', 'gcard-in');

    var front = el('span', 'gf');
    var ico = el('span', 'gf-ico');
    if (O.giftIcons) { ico.appendChild(O.giftIcons.make(data.gift)); }
    front.appendChild(ico);
    front.appendChild(el('span', 'gf-nm', name));

    var back = el('span', 'gb');
    back.appendChild(el('span', 'gb-nm', name));
    back.appendChild(el('span', 'gb-tx', meaning || '还没有写含义'));

    inner.appendChild(front);
    inner.appendChild(back);
    card.appendChild(inner);

    function close() {
      card.className = base;
      card.setAttribute('aria-expanded', 'false');
    }

    function open() {
      card.className = base + ' flipped';
      card.setAttribute('aria-expanded', 'true');
    }

    function toggle() {
      var wasOpen = openCard === card;
      closeOpen();
      if (!wasOpen) {
        open();
        openCard = card;
        openClose = close;
      }
    }

    card.addEventListener('click', toggle);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) {
        e.preventDefault();
        toggle();
      }
    });

    return card;
  }

  O.giftCard = { create: create, closeAll: closeOpen };
})(window);