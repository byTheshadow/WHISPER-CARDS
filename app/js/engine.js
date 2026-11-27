/* 回合引擎（M3）
   一次「对方的一轮」= 一条时间线：先整条抽好，再按时间播放（对齐原型 v2 的 planRound）。
   这里只做纯逻辑：不碰 DOM、不碰存储、不读系统时钟；随机一律走 Oracle.rng。
   气场（M4）没有接进来，节奏系数恒为 1。

   事件类型（与回放、星图共用同一套名字）：
     start     开始书写
     drop      落一张卡（带 card）
     retract   收回最后一张
     clear     整行抹掉
     pause     停顿（光标化成小滩）
     resume    停顿结束
     abandon   整行化开，重新开始
     send      就此送出
     force     到时限仍未送出：草稿里的原样发出；草稿为空才随机拼一张
     extinguish 沉默轮：到时限烛火熄灭，一张卡也不落
*/
(function (win) {
  'use strict';
  var O = win.Oracle = win.Oracle || {};

  var GAP = [700, 2100];        /* 两次动作之间 */
  var PAUSE = [1500, 4500];     /* 停顿持续 */
  var ABANDON = [2500, 6000];   /* 化开之后重新开始前 */
  var SEND_GAP = [900, 2200];   /* 最后一张到送出的留白 */
  var START = [500, 1500];      /* 开始到第一个动作 */
  var GUARD = 80;               /* 事件上限：再长也不让它抽出没完没了的时间线 */
  var LIMIT = 0.88;             /* 所有主动作必须落在时长窗口的前 88% 内，留出收尾 */

  function rng() { return O.rng; }

  /* 把所有非空牌堆摊平成一个数组：{ deck, kind, ... }。支持动态新增与删除的任意牌堆。 */
  function collect(decks) {
    var out = [];
    var keys = Object.keys(decks || {});
    var i;
    var j;
    var deck;
    var items;
    for (i = 0; i < keys.length; i++) {
      deck = decks[keys[i]];
      items = deck && deck.items ? deck.items : [];
      for (j = 0; j < items.length; j++) {
        out.push(normalize(keys[i], items[j]));
      }
    }
    return out;
  }

  function normalize(deck, item) {
    if (deck === 'tarot' || (item && (item.kind === 'tarot' || item.upright != null))) {
      return {
        deck: deck,
        kind: 'tarot',
        num: (item && item.num) || '',
        name: (item && item.name) || '',
        upright: (item && item.upright) || '',
        reversed: (item && item.reversed) || '',
        side: rng().chance(0.5) ? 'reversed' : 'upright',
        image: (item && item.image) || ''
      };
    }
    if (item && item.kind === 'gift') {
      return {
        deck: deck,
        kind: 'gift',
        gift: item.gift || '',
        name: item.name || '',
        meaning: item.meaning || ''
      };
    }
    if (item && item.image) {
      return { deck: deck, kind: 'image', image: item.image };
    }
    return { deck: deck, kind: 'text', text: (item && item.text) || '' };
  }

  function draw(pool) {
    if (!pool.length) { return null; }
    return pool[rng().int(0, pool.length - 1)];
  }

  /* 一条时间线。
     opt = { win:[min,max] 分钟, sil:0–60, cards:[min,max], probs:{retract,clear,pause,abandon,send}, decks } */
  function plan(opt) {
    var o = opt || {};
    var win = o.win || [2, 5];
    var sil = typeof o.sil === 'number' ? o.sil : 15;
    var cards = o.cards || [1, 4];
    var probs = o.probs || {};
    var pRetract = (probs.retract || 0);
    var pClear = probs.clear || 0;
    var pPause = probs.pause || 0;
    var pAbandon = probs.abandon || 0;
    var pSend = probs.send || 0;

    var pool = collect(o.decks || {});
    var duration = Math.round(rng().range(win[0] * 60000, win[1] * 60000));

    if (rng().chance(sil / 100)) {
      return {
        silent: true,
        durationMs: duration,
        events: [{ t: duration, type: 'extinguish' }],
        stats: { drops: 0, sends: 0, forced: false, steps: 0 }
      };
    }

    var events = [];
    var t = Math.round(rng().range(START[0], START[1]));
    var open = 0;
    var sent = false;
    var active = true;
    var guard = 0;
    var limit = duration * LIMIT;
    var stats = { drops: 0, sends: 0, forced: false, steps: 0 };
    var a = pRetract;
    var b = a + pClear;
    var c = b + pPause;
    var d = c + pAbandon;

    events.push({ t: t, type: 'start' });

    while (t < limit && !sent && guard < GUARD) {
      guard += 1;
      stats.steps += 1;
      t += Math.round(rng().range(GAP[0], GAP[1]));
      if (t >= limit) { break; }

      if (!active) {
        events.push({ t: t, type: 'start' });
        active = true;
        continue;
      }

      var pick = rng().float() * 100;

      if (pick < a) {
        if (open > 0) { events.push({ t: t, type: 'retract' }); open -= 1; }
      } else if (pick < b) {
        if (open > 0) { events.push({ t: t, type: 'clear' }); open = 0; }
      } else if (pick < c) {
        var pd = Math.round(rng().range(PAUSE[0], PAUSE[1]));
        events.push({ t: t, type: 'pause' });
        events.push({ t: t + pd, type: 'resume' });
        t += pd;
      } else if (pick < d) {
        events.push({ t: t, type: 'abandon' });
        open = 0;
        active = false;
        t += Math.round(rng().range(ABANDON[0], ABANDON[1]));
      } else if (open >= cards[1]) {
        events.push({ t: t, type: 'send' });
        sent = true;
        stats.sends += 1;
      } else {
        var card = draw(pool);
        if (card) {
          events.push({ t: t, type: 'drop', card: card });
          open += 1;
          stats.drops += 1;
        }
        if (open >= cards[0] && rng().chance(pSend / 100)) {
          t += Math.round(rng().range(SEND_GAP[0], SEND_GAP[1]));
          events.push({ t: t, type: 'send' });
          sent = true;
          stats.sends += 1;
        }
      }
    }

    if (!sent) {
      if (o.proactive) {
        /* 对方主动发信息：1~2 分钟未成功拼接出字卡，不强行发卡，归于沉静 */
        if (open > 0) {
          events.push({ t: Math.min(duration - 400, Math.round(limit + 400)), type: 'clear' });
        }
        events.push({ t: duration, type: 'silence' });
        stats.forced = false;
      } else {
        /* 用户主动发信息：严格走原有设置规则（草稿原样发出，草稿为空随机拼，走 force） */
        var payload = [];
        if (open === 0) {
          var n = rng().int(cards[0], cards[1]);
          var i;
          var extra;
          for (i = 0; i < n; i++) {
            extra = draw(pool);
            if (extra) { payload.push(extra); stats.drops += 1; }
          }
        }
        events.push({ t: duration, type: 'force', cards: payload });
        stats.forced = true;
      }
    }

    events.sort(function (x, y) { return x.t - y.t; });
    return { silent: false, durationMs: duration, events: events, stats: stats };
  }

  O.engine = { plan: plan, collect: collect, normalize: normalize };
})(window);