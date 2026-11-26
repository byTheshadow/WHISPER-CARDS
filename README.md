# 显影 · 传讯字卡 / WHISPER CARDS

一块会回话的板。

你写下想说的话，放到板上，递出去；对面用你自己导入的字卡、塔罗、礼物卡，一张一张拼出回应。

## 它是什么

- **纯前端、离线可跑**：`app/` 双击 `index.html` 就能用，不需要构建、不需要服务器
- **对面没有 AI**：每一次落卡都来自本机随机（`crypto` + 拒绝采样），没有语义判断，意义由你自己赋予
- **数据只在这台设备上**：IndexedDB 优先，打不开就降到 `localStorage`，再不行进内存——界面会如实写出当前存在哪里
- **零外链、零音频文件**：没有网络请求；音效全部是 Web Audio 现场合成

## 打开

直接双击 `app/index.html`。

`file://` 下第一次打开 IndexedDB 可能需要十几秒（会先降级到 `localStorage`，恢复后一次性搬回去）。用任意静态服务器打开也行，行为一致。

## 目录

```
app/index.html      唯一入口；三个 .page：chat / settings / decks
app/css/            theme（变量）→ base（骨骼/纸面/控件）→ anim → 三个页面样式 → 礼物卡
app/js/             按依赖顺序加载：
                    rng → starfield → candle → storage → db → deck-builtin →
                    gift-icons → gift-card → engine → chat → ui → sfx → decks → settings → app
```

几个关键的：

| 文件 | 职责 |
|---|---|
| `engine.js` | 回合引擎（纯逻辑，不碰 DOM、不读系统时钟） |
| `chat.js` | 对话页：板面交互、时间线播放、落卡/撤回/显影动效、历史落库与恢复 |
| `db.js` | IndexedDB 封装（20s 超时降级、降级期数据回搬） |
| `deck-builtin.js` | 内置 40 张字卡 / 16 张特殊卡 / 78 张塔罗 |

## 词表

这套产品里不用「AI / 算法 / 预测」这些词：

**连接**（开场）· **显影**（按住看清历史；也是落卡动效的名字）· **落卡**（对面写出一张）· **送走**（结束这一次会话）

## 兼容性

- 目标容器：小红书小工具（H5），`file://` 也可用
- 基线 Chrome 61：不用 `?.` / `??` / flex `gap` / `inset` 简写 / `clamp` / `:is()` / `:has()` / `type="module"`
- **真机（iOS / Android）与 Chrome 61 均未实测**

## 状态

对话 / 引擎 / 牌库 / 设置 / 音效 / 落卡动效 / 显影 / 送走 / 本地持久化已完成；星图、会话回放、导出（PNG）还没做。