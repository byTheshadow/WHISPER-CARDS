/* 预设礼物图形（8 个）
   几何数据来自外包交付的 gift-icons\gift-<key>.svg（manifest.json 提供中文名与说明），
   一条条搬成路径表在这里用 createElementNS 现场拼：颜色跟 currentColor 走（深浅色自动适配），
   不额外发请求、不塞 data: URI，也不把 SVG 当 <img> 引。
   下面 NS 里那个 http:// 是 SVG 命名空间标识符（XML 名字），不是网络资源。 */
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};
  var doc = win.document;
  var NS = 'http://www.w3.org/2000/svg';
  var ROOT = {
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  };

  var ICONS = [
    {
      key: "bouquet", zh: "花束",
      parts: [
        ["path", { d: "M18 42L29.5 14" }],
        ["path", { d: "M24 42V15" }],
        ["path", { d: "M30 42L17.5 16.5" }],
        ["circle", { cx: "31", cy: "10.5", r: "3.5" }],
        ["circle", { cx: "24", cy: "11.5", r: "3.5" }],
        ["circle", { cx: "16", cy: "13.5", r: "3.5" }],
        ["path", { d: "M21 26C17.5 23.5 14 23.5 12.5 24.5C13.5 27 17 28 21 26Z" }],
        ["path", { d: "M26.5 24C30 21.5 33.5 21.5 35 22.5C34 25 30.5 26 26.5 24Z" }],
        ["path", { d: "M18.5 32.5H29.5" }],
        ["path", { d: "M24 32.5C21.5 34.5 19.5 37 18.5 38.5" }],
        ["path", { d: "M24 32.5C26.5 34.5 28.5 37 29.5 38.5" }]
      ]
    },
    {
      key: "candle", zh: "蜡烛",
      parts: [
        ["path", { d: "M24 6.5C21 10.5 20.5 13 20.5 14.5C20.5 16.5 22 18 24 18C26 18 27.5 16.5 27.5 14.5C27.5 13 27 10.5 24 6.5Z" }],
        ["line", { x1: "24", y1: "18", x2: "24", y2: "21.5" }],
        ["path", { d: "M17.5 21.5H30.5V38.5H17.5Z" }],
        ["path", { d: "M17.5 26C20 26 21 29.5 22.5 29.5C24 29.5 24.5 25 26.5 25C28.5 25 28.5 27.5 30.5 27.5" }],
        ["line", { x1: "11.5", y1: "38.5", x2: "36.5", y2: "38.5" }],
        ["path", { d: "M15 38.5L16.5 42H31.5L33 38.5" }],
        ["path", { d: "M31.5 33H35C36.5 33 37.5 34 37.5 35.5C37.5 37 36.5 38.5 34.5 38.5" }]
      ]
    },
    {
      key: "key", zh: "钥匙",
      parts: [
        ["circle", { cx: "24", cy: "13.5", r: "7" }],
        ["circle", { cx: "24", cy: "13.5", r: "2.5" }],
        ["line", { x1: "20.5", y1: "20.5", x2: "27.5", y2: "20.5" }],
        ["line", { x1: "24", y1: "20.5", x2: "24", y2: "41.5" }],
        ["path", { d: "M24 32.5H31V35.5H27.5V38.5H31V41.5H24" }]
      ]
    },
    {
      key: "letter", zh: "信",
      parts: [
        ["rect", { x: "6.5", y: "12.5", width: "35", height: "23", rx: "2" }],
        ["path", { d: "M7 13L24 25.5L41 13" }],
        ["path", { d: "M7 35L19.5 22.5" }],
        ["path", { d: "M41 35L28.5 22.5" }],
        ["circle", { cx: "24", cy: "25.5", r: "3" }],
        ["circle", { cx: "24", cy: "25.5", r: "0.75", fill: "currentColor", stroke: "none" }]
      ]
    },
    {
      key: "teacup", zh: "茶杯",
      parts: [
        ["path", { d: "M12.5 21.5H31.5V27.5C31.5 32.5 27.5 36.5 22 36.5C16.5 36.5 12.5 32.5 12.5 27.5V21.5Z" }],
        ["path", { d: "M31.5 24H34.5C36.5 24 38 25.5 38 27.5C38 29.5 36.5 31 34.5 31H31" }],
        ["line", { x1: "8.5", y1: "36.5", x2: "35.5", y2: "36.5" }],
        ["path", { d: "M11.5 36.5L14 40H30L32.5 36.5" }],
        ["path", { d: "M18.5 16.5C18.5 14.5 20 13.5 20 11.5C20 9.5 18.5 8.5 18.5 6.5" }],
        ["path", { d: "M25.5 16.5C25.5 14.5 27 13.5 27 11.5C27 9.5 25.5 8.5 25.5 6.5" }]
      ]
    },
    {
      key: "moon", zh: "月亮",
      parts: [
        ["path", { d: "M34.5 34.5A15.5 15.5 0 1 1 20.5 8A12.5 12.5 0 0 0 34.5 34.5Z" }],
        ["path", { d: "M34.5 12.5V18.5M31.5 15.5H37.5" }],
        ["circle", { cx: "28", cy: "22", r: "1", fill: "currentColor", stroke: "none" }]
      ]
    },
    {
      key: "feather", zh: "羽毛",
      parts: [
        ["path", { d: "M11 41C17 33 26.5 21 37.5 8.5" }],
        ["path", { d: "M37.5 8.5C30 9.5 22.5 15 18 22.5L22.5 22L16.5 25.5C15 28.5 14.5 31.5 15.5 35C19 35.5 22.5 34.5 25.5 32.5L25 28L28.5 29.5C34.5 24 38 16.5 37.5 8.5Z" }],
        ["line", { x1: "25.5", y1: "22", x2: "29.5", y2: "14.5" }],
        ["line", { x1: "21.5", y1: "27", x2: "29.5", y2: "25" }]
      ]
    },
    {
      key: "bell", zh: "铃铛",
      parts: [
        ["circle", { cx: "24", cy: "9.5", r: "2.5" }],
        ["path", { d: "M15 24C15 17.5 18.5 12 24 12C29.5 12 33 17.5 33 24C33 29.5 35.5 33 37.5 34.5H10.5C12.5 33 15 29.5 15 24Z" }],
        ["line", { x1: "14", y1: "30.5", x2: "34", y2: "30.5" }],
        ["path", { d: "M20.5 34.5C20.5 36.5 22 38.5 24 38.5C26 38.5 27.5 36.5 27.5 34.5" }],
        ["circle", { cx: "24", cy: "40.5", r: "1", fill: "currentColor", stroke: "none" }]
      ]
    }
  ];

  function forKey(key) {
    var i;
    for (i = 0; i < ICONS.length; i++) {
      if (ICONS[i].key === key) { return ICONS[i]; }
    }
    return null;
  }

  /* 返回一个 <svg> 元素；尺寸交给 CSS（.mg / .icell / .ac__i.gift 各自定）。 */
  function make(key) {
    var icon = forKey(key) || ICONS[0];
    var svg = doc.createElementNS(NS, 'svg');
    var k;
    var i;
    var j;
    var node;
    var attrs;
    for (k in ROOT) {
      if (Object.prototype.hasOwnProperty.call(ROOT, k)) { svg.setAttribute(k, ROOT[k]); }
    }
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (i = 0; i < icon.parts.length; i++) {
      node = doc.createElementNS(NS, icon.parts[i][0]);
      attrs = icon.parts[i][1];
      for (j in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, j)) { node.setAttribute(j, attrs[j]); }
      }
      svg.appendChild(node);
    }
    return svg;
  }

  function list() {
    var out = [];
    var i;
    for (i = 0; i < ICONS.length; i++) { out.push({ key: ICONS[i].key, zh: ICONS[i].zh }); }
    return out;
  }

  O.giftIcons = { make: make, list: list };
})(window);
