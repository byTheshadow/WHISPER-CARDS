/* M3 事件音效（Web Audio 实时合成，无任何音频文件、不引外链）
 * 合成实现来自外包交付的 音效和落卡\sfx.js，只改了两处：
 *   ① 随机数改走 Oracle.rng（项目唯一随机源），不再用浏览器内置弱随机；
 *   ② 同时挂到 Oracle.sfx 与 window.SFX（旧试验页仍可直接引这个文件）。
 *
 * 经典脚本，暴露：
 *   window.SFX = { unlock(), play(key[, delaySec]), setVolume(0..1), ready() }
 *
 * 六个键：drop 落卡 / retract 撤回 / clear 清空 / pause 停顿 / abandon 放弃 / silence 熄灭。
 * 未解锁、音量为 0、未知的键，play() 都返回 false，不出声、不报错。
 *
 * 基线 Chrome 61 / Android WebView 61：只用 AudioContext、GainNode、BiquadFilterNode、
 * AudioBufferSourceNode、StereoPannerNode（有则用）。所有排程都基于 ctx.currentTime，不用计时器。
 */
(function (w) {
  'use strict';

  var O = w.Oracle = w.Oracle || {};
  var AC = w.AudioContext || w.webkitAudioContext;
  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var level = 0.7;          /* setVolume 传入的 0..1 */
  var voices = [];          /* 正在响或已排程的声音：{ t0, end } */

  var MAX_VOICES = 6;       /* 同时最多几个声音，再多就丢弃新的，防止叠成噪音 */
  var LOOKAHEAD = 0.008;    /* 排程提前量（秒），避免卡在当前渲染块里被截掉起音 */

  /* 滑杆的感知曲线：音量 = level²，0.5 约等于 −12dB */
  function curve(v) { return v * v; }
  function clamp01(v) { v = +v; return v > 1 ? 1 : (v > 0 ? v : 0); }
  function rnd(a, b) { return a + O.rng.float() * (b - a); }

  /* ---------- 共享白噪声：解锁时生成一次，所有声音从随机位置截取 ---------- */
  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var raw = O.rng.bytes(len * 2);
    var i;
    for (i = 0; i < len; i++) {
      var v = raw[i * 2] | (raw[i * 2 + 1] << 8);
      d[i] = ((v < 32768 ? v : v - 65536) / 32768) * 0.92;
    }
    return buf;
  }
  function noiseSrc(t0, dur) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    var off = rnd(0, noiseBuf.duration - dur - 0.05);
    s.start(t0, off, dur + 0.02);
    return s;
  }
  function filt(type, f, q) {
    var b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (q != null) { b.Q.value = q; }
    return b;
  }
  /* 包络：从 0 线性起音到 peak，可选保持 hold 秒，再指数衰减到 floor，最后线性落到真正的 0
     —— 起止都没有台阶，不会咔哒 */
  function env(g, t0, attack, peak, decayEnd, hold) {
    var p = g.gain;
    p.value = 0;                     /* GainNode 默认是 1：不先归零，包络开始前声源会满幅漏出 */
    p.setValueAtTime(0, ctx.currentTime);
    p.setValueAtTime(0, t0);
    p.linearRampToValueAtTime(peak, t0 + attack);
    if (hold) { p.setValueAtTime(peak, t0 + attack + hold); }
    p.exponentialRampToValueAtTime(0.0008, decayEnd);
    p.linearRampToValueAtTime(0, decayEnd + 0.01);
  }
  /* 反向包络：从近乎无声指数涨到 peak，再在 fall 秒内线性收掉 —— 像倒放，听起来是"吸" */
  function envRise(g, t0, rise, peak, fall) {
    var p = g.gain;
    p.value = 0;
    p.setValueAtTime(0, ctx.currentTime);
    p.setValueAtTime(0.0008, t0);
    p.exponentialRampToValueAtTime(peak, t0 + rise);
    p.linearRampToValueAtTime(0, t0 + rise + fall);
  }
  /* 分层声像：有 StereoPanner 才建，没有就直接连 */
  function panTo(node, dest, pan) {
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      p.connect(dest);
      return p;
    }
    node.connect(dest);
    return null;
  }

  /* ---------- 声部的输出端：每次新建 gain（不复用），可选声像 ---------- */
  function voiceOut(key, t0, end, gain, pan) {
    var out = ctx.createGain();
    out.gain.value = gain;
    var tail = out;
    if (ctx.createStereoPanner && pan) {
      var p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      tail = p;
    }
    tail.connect(master);
    voices.push({ key: key, t0: t0, end: end });
    return { out: out, tail: tail, panner: tail === out ? null : tail };
  }
  function release(nodes, last) {
    /* 最后一个声源结束时把整条链断开，交给 GC；这是事件回调，不是排程 */
    last.onended = function () {
      for (var i = 0; i < nodes.length; i++) {
        try { nodes[i].disconnect(); } catch (e) { /* 已断开 */ }
      }
    };
  }
  /* 计算 t0 时刻已有几个声音在响（全部 / 同一个键），并清理已结束的记录 */
  function overlapAt(t0, key) {
    var now = ctx.currentTime, r = { all: 0, same: 0 }, keep = [];
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (v.end > now) {
        keep.push(v);
        if (v.t0 <= t0 && v.end > t0) { r.all++; if (v.key === key) { r.same++; } }
      }
    }
    voices = keep;
    return r;
  }

  /* ======================================================================
   * drop · 落卡：纸片轻碰木面 —— 短、闷、带一点摩擦。总长 ≈ 220ms
   *
   *   noise ─ bandpass 290Hz Q1.2 ─ lowpass 1.2kHz ─ gBody ┐  木面：闷的一下
   *   noise ─ bandpass 1.9kHz Q0.8 ─────────────── gTick  ├─ out ─ (pan) ─ master
   *   noise ─ highpass 1.1kHz ─ bandpass 2.8→1.5kHz ─ lowpass 4.2kHz ─ gRub ┘  纸面：一点摩擦
   * ====================================================================== */
  function drop(t0, duck) {
    var k = rnd(0.94, 1.06);                  /* 每次略有不同，连击不像机关枪 */
    var end = t0 + 0.22;
    var vo = voiceOut('drop', t0, end, 0.9 * duck * rnd(0.86, 1), rnd(-0.12, 0.12));
    var out = vo.out;

    /* 木面：低频带通噪声，3ms 起音，100ms 衰减。中心放在 290Hz 而不是更低，手机外放才听得见 */
    var sB = noiseSrc(t0, 0.11);
    var bB = filt('bandpass', 290 * k, 1.2);
    var lB = filt('lowpass', 1200, 0.5);
    var gB = ctx.createGain();
    env(gB, t0, 0.003, 3.2, t0 + 0.1);
    sB.connect(bB); bB.connect(lB); lB.connect(gB); gB.connect(out);

    /* 接触的一下：极短的中频噪声，1.5ms 起音，18ms 衰减，量很小 */
    var sT = noiseSrc(t0, 0.03);
    var bT = filt('bandpass', 1900 * k, 0.8);
    var gT = ctx.createGain();
    env(gT, t0, 0.0015, 0.14, t0 + 0.018);
    sT.connect(bT); bT.connect(gT); gT.connect(out);

    /* 纸面摩擦：落定后轻轻一蹭，中心频率由亮到暗，12ms 起音，≈190ms 衰减 */
    var sR = noiseSrc(t0, 0.21);
    var hR = filt('highpass', 1100, 0.5);
    var bR = filt('bandpass', 2800 * k, 0.9);
    bR.frequency.setValueAtTime(2800 * k, t0);
    bR.frequency.exponentialRampToValueAtTime(1500 * k, t0 + 0.16);
    var lR = filt('lowpass', 4200, 0.5);       /* 削掉 4kHz 以上的嘶声，摩擦是"沙"不是"嘶" */
    var gR = ctx.createGain();
    env(gR, t0 + 0.004, 0.012, 0.05, t0 + 0.19);
    sR.connect(hR); hR.connect(bR); bR.connect(lR); lR.connect(gR); gR.connect(out);

    release([sB, bB, lB, gB, sT, bT, gT, sR, hR, bR, lR, gR, out, vo.tail], sR);
    return true;
  }

  /* ======================================================================
   * retract · 撤回：反向的"吸"，比落卡更短更轻。总长 ≈ 140ms
   *
   *   noise ─ bandpass 900→2100Hz Q1.1 ─ lowpass 3kHz ─ gAir  ┐
   *   noise ─ bandpass 380→520Hz Q1.4 ──────────────── gBody ├─ out ─ (pan) ─ master
   *
   * 两层都用反向包络：慢慢涨上来，到顶后 22–25ms 收掉。滤波中心一起往上滑，像被抽走。
   * ====================================================================== */
  function retract(t0, duck) {
    var k = rnd(0.95, 1.05);
    var end = t0 + 0.15;
    var vo = voiceOut('retract', t0, end, 0.9 * duck * rnd(0.88, 1), rnd(-0.1, 0.1));
    var out = vo.out;

    var sA = noiseSrc(t0, 0.14);
    var bA = filt('bandpass', 900 * k, 1.1);
    bA.frequency.setValueAtTime(900 * k, t0);
    bA.frequency.exponentialRampToValueAtTime(2100 * k, t0 + 0.115);
    var lA = filt('lowpass', 3000, 0.5);
    var gA = ctx.createGain();
    envRise(gA, t0, 0.115, 0.06, 0.022);
    sA.connect(bA); bA.connect(lA); lA.connect(gA); gA.connect(out);

    var sB = noiseSrc(t0, 0.14);
    var bB = filt('bandpass', 380 * k, 1.4);
    bB.frequency.setValueAtTime(380 * k, t0);
    bB.frequency.exponentialRampToValueAtTime(520 * k, t0 + 0.11);
    var gB = ctx.createGain();
    envRise(gB, t0, 0.11, 0.5, 0.025);
    sB.connect(bB); bB.connect(gB); gB.connect(out);

    release([sA, bA, lA, gA, sB, bB, gB, out, vo.tail], sA);
    return true;
  }

  /* ======================================================================
   * clear · 清空：一段很轻的"扫"，噪声由亮到暗，声像从左扫到右。总长 ≈ 430ms
   *
   *   noise ─ bandpass 4.5k→700Hz Q0.7 ─ lowpass 7k→1.4kHz ─ gSweep ┐
   *   noise ─ bandpass 600Hz Q0.9 ──────────────────────── gFloor  ├─ out ─ pan(−0.25→+0.25) ─ master
   * ====================================================================== */
  function clear(t0, duck) {
    var end = t0 + 0.45;
    var vo = voiceOut('clear', t0, end, 0.9 * duck, -0.25);
    var out = vo.out;
    if (vo.panner) {
      vo.panner.pan.setValueAtTime(-0.25, t0);
      vo.panner.pan.linearRampToValueAtTime(0.25, t0 + 0.4);
    }

    var sS = noiseSrc(t0, 0.44);
    var bS = filt('bandpass', 4500, 0.7);
    bS.frequency.setValueAtTime(4500, t0);
    bS.frequency.exponentialRampToValueAtTime(700, t0 + 0.4);
    var lS = filt('lowpass', 7000, 0.5);
    lS.frequency.setValueAtTime(7000, t0);
    lS.frequency.exponentialRampToValueAtTime(1400, t0 + 0.4);
    var gS = ctx.createGain();
    env(gS, t0, 0.06, 0.038, t0 + 0.43, 0.12);
    sS.connect(bS); bS.connect(lS); lS.connect(gS); gS.connect(out);

    /* 底下一层很淡的中低频，让"扫"有一点贴着桌面的分量 */
    var sF = noiseSrc(t0, 0.36);
    var bF = filt('bandpass', 600, 0.9);
    var gF = ctx.createGain();
    env(gF, t0 + 0.03, 0.08, 0.12, t0 + 0.35, 0.08);
    sF.connect(bF); bF.connect(gF); gF.connect(out);

    release([sS, bS, lS, gS, sF, bF, gF, out, vo.tail], sS);
    return true;
  }

  /* ======================================================================
   * pause · 停顿：一滴水落在纸上，圆、软。总长 ≈ 300ms
   *
   *   noise ─ bandpass 640→880Hz Q9 ─ lowpass 1.6kHz ─ gDrop ┐  高 Q 带通让噪声"共鸣"出一个圆的音色，
   *   noise ─ lowpass 380Hz Q0.6 ───────────────────── gSoak ├─ out ─ master   但听不出音名，不会像 beep
   *
   * 起音 6ms（比落卡软一倍），共鸣中心在 60ms 里往上滑一点，是水滴的特征；纸吸水所以没有清脆的尾巴。
   * ====================================================================== */
  function pause(t0, duck) {
    var k = rnd(0.96, 1.04);
    var end = t0 + 0.31;
    var vo = voiceOut('pause', t0, end, 0.9 * duck, 0);
    var out = vo.out;

    var sD = noiseSrc(t0, 0.3);
    var bD = filt('bandpass', 640 * k, 9);
    bD.frequency.setValueAtTime(640 * k, t0);
    bD.frequency.exponentialRampToValueAtTime(880 * k, t0 + 0.06);
    var lD = filt('lowpass', 1600, 0.5);
    var gD = ctx.createGain();
    env(gD, t0, 0.006, 0.79, t0 + 0.29);
    sD.connect(bD); bD.connect(lD); lD.connect(gD); gD.connect(out);

    var sK = noiseSrc(t0, 0.1);
    var lK = filt('lowpass', 380, 0.6);
    var gK = ctx.createGain();
    env(gK, t0, 0.008, 0.11, t0 + 0.08);
    sK.connect(lK); lK.connect(gK); gK.connect(out);

    release([sD, bD, lD, gD, sK, lK, gK, out, vo.tail], sD);
    return true;
  }

  /* ======================================================================
   * abandon · 放弃：气声散掉，尾部更长。总长 ≈ 640ms
   *
   *   noise ─ bandpass 1.3kHz Q0.5 ─ lowpass 3k→600Hz ─ gL ─ pan −0.3 ┐
   *   noise ─ bandpass 1.1kHz Q0.5 ─ lowpass 3k→600Hz ─ gR ─ pan +0.3 ├─ out ─ master
   *
   * 两路独立的噪声分到左右，起音错开 25ms —— 声音从中间"散"开，而不是一个点在响。
   * ====================================================================== */
  function abandon(t0, duck) {
    var end = t0 + 0.65;
    var vo = voiceOut('abandon', t0, end, 0.9 * duck, 0);
    var out = vo.out;
    var nodes = [];

    function layer(f, pan, delay) {
      var s = noiseSrc(t0, 0.64);
      var b = filt('bandpass', f, 0.5);
      var l = filt('lowpass', 3000, 0.5);
      l.frequency.setValueAtTime(3000, t0 + delay);
      l.frequency.exponentialRampToValueAtTime(600, t0 + 0.6);
      var g = ctx.createGain();
      env(g, t0 + delay, 0.045, 0.051, t0 + 0.63, 0.05);
      s.connect(b); b.connect(l); l.connect(g);
      var pn = panTo(g, out, pan);
      nodes.push(s, b, l, g);
      if (pn) { nodes.push(pn); }
      return s;
    }
    var last = layer(1300, -0.3, 0);
    layer(1100, 0.3, 0.025);

    nodes.push(out, vo.tail);
    release(nodes, last);
    return true;
  }

  /* ======================================================================
   * silence · 熄灭：一声极轻的"呼"，几乎听不见。总长 ≈ 820ms
   *
   *   noise ─ bandpass 520Hz Q0.6 ─ lowpass 1.1k→450Hz ─ gBreath ─ out ─ master
   *
   * 慢起音 140ms（是一口气，不是一下碰撞），然后很长地散掉。
   * 电平比落卡低约 14dB，安静环境下才听得到。
   * ====================================================================== */
  function silence(t0, duck) {
    var end = t0 + 0.83;
    var vo = voiceOut('silence', t0, end, 0.9 * duck, 0);
    var out = vo.out;

    var s = noiseSrc(t0, 0.82);
    var b = filt('bandpass', 520, 0.6);
    var l = filt('lowpass', 1100, 0.5);
    l.frequency.setValueAtTime(1100, t0);
    l.frequency.exponentialRampToValueAtTime(450, t0 + 0.8);
    var g = ctx.createGain();
    env(g, t0, 0.14, 0.033, t0 + 0.81, 0.06);
    s.connect(b); b.connect(l); l.connect(g); g.connect(out);

    release([s, b, l, g, out, vo.tail], s);
    return true;
  }

  var VOICES = {
    drop:    { fn: drop,    stack: true },
    retract: { fn: retract, stack: true },
    clear:   { fn: clear,   stack: false },
    pause:   { fn: pause,   stack: false },
    abandon: { fn: abandon, stack: false },
    silence: { fn: silence, stack: false }
  };

  /* ---------- 对外接口 ---------- */
  function resumeQuietly() {
    if (ctx && ctx.state !== 'running' && ctx.resume) {
      var p = ctx.resume();
      if (p && p.catch) { p.catch(function () { /* 没有手势时可能被拒，下次点击再试 */ }); }
    }
  }

  /* 必须在用户手势（click / pointerup / keydown）的回调里调用 */
  function unlock() {
    if (!AC) { return false; }
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = curve(level);
      master.connect(ctx.destination);
      noiseBuf = makeNoise();
      /* 一段 1 样本的静音，部分 WebView 需要真的播一次才算解锁 */
      var b = ctx.createBuffer(1, 1, ctx.sampleRate);
      var s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    }
    resumeQuietly();
    return true;
  }

  /* key：事件名；delaySec：可选，相对现在的延迟（秒），用于按 ctx 时钟排程 */
  function play(key, delaySec) {
    var v = VOICES[key];
    if (!v || !ctx || level <= 0) { return false; }
    resumeQuietly();
    var t0 = ctx.currentTime + LOOKAHEAD + (delaySec > 0 ? delaySec : 0);
    var n = overlapAt(t0, key);
    if (n.all >= MAX_VOICES) { return false; }
    if (!v.stack && n.same > 0) { return false; }   /* 不可叠加的音：上一声没完，这一声就不发 */
    /* 叠得越多，新来的越轻 */
    var duck = 1 / (1 + 0.35 * n.all);
    return v.fn(t0, duck);
  }

  function setVolume(v) {
    level = clamp01(v);
    if (!master) { return; }
    var g = master.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    /* 线性 30ms：到 0 时是真正的 0，而不是无限接近 */
    g.linearRampToValueAtTime(curve(level), now + 0.03);
  }

  function ready() { return !!ctx && ctx.state === 'running'; }

  /* 页面从后台回来：只要之前解锁过，就恢复 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { resumeQuietly(); }
  });
  w.addEventListener('pageshow', resumeQuietly);

  var api = { unlock: unlock, play: play, setVolume: setVolume, ready: ready };
  O.sfx = api;
  w.SFX = api;
})(window);
