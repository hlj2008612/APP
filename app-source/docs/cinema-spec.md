# 影院页（Cinema）实现规格

> 归档说明：本文档记录 `/cinema` 页面（参考站的 cinemaMode）的实测规格，
> 供后续维护者对照。实现见 `src/views/Cinema.vue`。

> 本文件由主理人用真实 Chrome 实测参考站 forum.hanakos.cc 后逐字记录。
> 实现时【直接照此文件做】，不要再去抓参考站。

## 0. 参考站对应关系

参考站**没有** /cinema 路径（那是 404）。用户说的「导航栏中的影视」= 参考站的 cinemaMode，
地址 `/?cinema=1`，是首页的一个全屏模式。

我方 `/cinema` 路由已存在且已在 App.vue 的 ROUTE_ORDER 里，**直接在该路由实现**。

## 1. 页面垂直结构（1440x900 实测）

外层 `.relative.w-full.flex.flex-col`，再外层 `.relative.z-10.pt-24`（给固定导航留 96px）。

三段依次：
1. 顶部 neon-marquee 跑马灯，h=72
2. cinema-stage 照片流舞台，flex:1，overflow:hidden
3. 底部 neon-marquee 跑马灯，h=72

## 2. cinema-stage 三层

```css
.cinema-stage {
  position: relative; flex: 1; overflow: hidden;
  background: radial-gradient(rgba(30,20,40,.3), transparent 70%);
}
.cinema-tilted {
  position: absolute; inset: 0;
  transform: rotate(-10deg) scale(1.1);
  transform-origin: center center;
}
.cinema-cols { display: flex; gap: 8px; height: 100%; width: 100%; }
/* md 断点 gap: 10px */
```

## 3. 七列

```css
.cinema-col { position: relative; overflow: hidden; min-width: 0; flex: 1; }
.cinema-col-track {
  display: flex; flex-direction: column; gap: 8px;
  will-change: transform;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
```

方向交替：第 1/3/5/7 列 `scroll-down`，第 2/4/6 列 `scroll-up`。
实测动画时长依次：**55 / 62 / 50 / 68 / 58 / 64 / 52 秒**。

## 4. 滚动关键帧（逐字）

```css
@keyframes cinemaScrollDown {
  0%   { transform: translateY(0); }
  100% { transform: translateY(-50%); }
}
@keyframes cinemaScrollUp {
  0%   { transform: translateY(-50%); }
  100% { transform: translateY(0); }
}
```

**无缝循环的前提**：每列内容必须**复制一份**，使 track 高度恰好是内容高度的 2 倍。
少了这一步，-50% 会跳到内容中间，肉眼可见。

## 5. 卡片

```css
.cinema-card {
  width: 100%; aspect-ratio: 3 / 4;
  border-radius: 8px; overflow: hidden; position: relative;
  border: 1px solid rgba(255,255,255,.1);
  transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s, filter .35s;
  filter: brightness(1) saturate(1);
}
```

内部 `<img>`：`position:absolute; inset:0; width:100%; height:100%; object-fit:cover;`
`transition: transform .7s;` hover 时 `scale(1.05)`。

底部信息条：`position:absolute; left:0; right:0; bottom:0; padding:8px;`
背景 `linear-gradient(to top, rgba(0,0,0,.9), rgba(0,0,0,.6), transparent)`。

## 6. 悬停效果（逐字）

```css
.cinema-card:hover {
  transform: translateY(-4px) scale(1.04);
  box-shadow: 0 0 40px rgba(244,114,182,.55), 0 12px 40px rgba(0,0,0,.5);
  z-index: 5;
  filter: brightness(1.08) saturate(1.1);
}
.cinema-col:hover .cinema-col-track { animation-play-state: paused; }
.cinema-stage:has(.cinema-card:hover) .cinema-card:not(:hover) {
  filter: brightness(.45) saturate(.75);
}
```

## 7. 霓虹跑马灯

结构：
```
.neon-marquee
├─ .neon-marquee-leds (aria-hidden)
├─ .neon-marquee-track.to-left
│   ├─ .neon-marquee-text  ← 第 1 段
│   └─ .neon-marquee-text  ← 第 2 段（内容必须与第 1 段完全相同）
├─ .neon-marquee-highlight-top
└─ .neon-marquee-highlight-bottom
```

```css
.neon-marquee {
  position: relative; width: 100%; height: 72px; overflow: hidden;
  background: linear-gradient(#1a0612, #0f0409 50%, #1a0612);
  border-top: 1px solid rgba(255,80,140,.2);
  border-bottom: 1px solid rgba(255,80,140,.2);
  box-shadow: inset 0 0 30px rgba(236,72,153,.25), 0 0 20px rgba(236,72,153,.15);
}
.neon-marquee-leds {
  position: absolute; inset: 0;
  background-image: radial-gradient(circle, rgba(255,90,160,.18) 1.2px, transparent 1.5px);
  background-size: 8px 8px;
  opacity: .8; mix-blend-mode: screen; pointer-events: none;
}
.neon-marquee-track {
  position: absolute; inset: 0;
  display: flex; align-items: center; white-space: nowrap;
  animation-timing-function: linear; animation-iteration-count: infinite;
  will-change: transform;
}
.neon-marquee-track.to-left { animation-name: neonScrollLeft; }
.neon-marquee-text {
  display: inline-block; padding: 0 1.5rem;
  font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  font-weight: 800;
  font-size: clamp(22px, 3.2vh, 36px);
  letter-spacing: .18em;
  color: #ffe8f1;
  text-shadow:
    0 0 2px #fff,
    0 0 6px rgba(255,220,235,.95),
    0 0 14px rgba(255,100,170,.85),
    0 0 28px rgba(236,72,153,.7),
    0 0 48px rgba(190,24,93,.5);
  animation: neonFlicker 4.5s ease-in-out infinite;
}
@keyframes neonFlicker {
  0%,100% { opacity: 1 } 47% { opacity: 1 } 48% { opacity: .75 } 49% { opacity: 1 }
  72% { opacity: 1 } 73% { opacity: .85 } 74% { opacity: 1 }
}
@keyframes neonScrollLeft {
  0%   { transform: translateX(0) }
  100% { transform: translateX(-50%) }
}
.neon-marquee-highlight-top {
  position: absolute; left: 0; right: 0; height: 1px; top: 0;
  background: linear-gradient(90deg, transparent, rgba(255,180,210,.5), rgba(255,180,210,.8), rgba(255,180,210,.5), transparent);
}
.neon-marquee-highlight-bottom {
  position: absolute; left: 0; right: 0; height: 1px; bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(190,24,93,.6), transparent);
}
```

### 跑马灯文字

参考站是品牌词 `ホタル・シアター  •  FIREFLY CINEMA  •  NOW PLAYING  •  映画祭  •  NIGHT SHOW  •  夜の劇場  ·  `。
我方主题是照片墙，改成匹配的（保留日文与全角符号，保持视觉语言一致）：

```
GALLERY  •  PHOTO WALL  •  NOW SHOWING  •  写真  •  NIGHT GALLERY  •  夜の写真館  ·  
```

两段 span 内容必须完全相同才能无缝。

## 8. 技术约束（必须遵守）

1. 图片必须从 `src/core/imageManifest.js` 导入 `IMAGE_POOL` 和 `assetUrl`，
   用 `assetUrl(entry.thumb)` 取地址。**绝不要硬编码 `/images/...`**（会破坏子路径部署）。
2. 20 张图，7 列，每列内容复制一份做无缝循环。参考站卡片数 6/4/4/4/4/4/4，20 张可循环复用。
3. `<img>` 必须 `loading="lazy" decoding="async" draggable="false"`。
4. 样式写进 `src/views/Cinema.vue` 的 `<style scoped>`。
   **注意 `@keyframes` 名是全局命名空间，scoped 不隔离**，必须加 `cinema-` 前缀避免与
   `src/assets/main.css` 冲突（那里已有 ptr-* / pt-cube-* 等）。
5. **必须尊重 prefers-reduced-motion**：`src/assets/main.css` 已有全局规则把
   `animation-duration` 压到 `0.01ms`，会打死这些循环动画。要在 Cinema.vue 里加放行规则，
   让 reduced 环境仍能正常滚动，或明确降级为静态网格并说明理由。
6. 不引入新依赖。除 Cinema.vue 外尽量不改其它文件（确有必要需说明理由）。
7. 移动端适配：7 列在窄屏会很挤，参考站靠 rotate+scale 撑开。给出窄屏方案。

## 9. 交付要求

1. 改完必须用 `npm run build` 验证构建通过。
2. 报告要明确区分「实测通过」和「仅代码推断」。
3. 列出改动文件清单、关键实现理由、仍有风险的地方。

## 10. 可访问资料

| 内容 | 路径 |
|---|---|
| 项目根 | `D:\桌面\photo-wall-vue` |
| 目标文件 | `src/views/Cinema.vue`（现为 14 行占位页） |
| 图片清单 | `src/core/imageManifest.js` |
| 全局样式 | `src/assets/main.css` |
| 图片素材 | `public/images/thumbnails/*.webp`（20 张，最长边 560px，共 525 KB） |
| 路由 | `src/router/index.js` |
| 导航 | `src/components/NavBar.vue` |
| 参考站实际效果截图 | `C:\Users\黄立键\AppData\Local\Temp\pw_shots\cinemamode.png`（1440x900） |

## 11. 未知项

我方没有真实的照片标题/作者数据。卡片底部信息条可以只显示序号，或省略，由实现者判断。
