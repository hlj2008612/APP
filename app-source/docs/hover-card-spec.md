# 参考站悬停资料卡（Radix HoverCard）实测规格

> 归档说明：本文档由主理人用真 Chrome 155.0.8059.40 + playwright-core，在
> `https://forum.hanakos.cc/` 上逐项实测得出。用于对齐本项目画报页的悬停浮层。
> 每一行都标注了「实测」或「推测」，未实测的一律不写成结论。

## 一、实测数据（1440x900）

| 项目 | 实测值 | 来源 |
|---|---|---|
| 浮层 wrapper 定位 | `position:fixed` + `transform: translate(29px, 307.5px)` | 实测 `[data-radix-popper-content-wrapper]` 的 inline style |
| 浮层尺寸 | **288 x 384~390 px**（高度随内容变化） | 实测 |
| 圆角 | **16px** | 实测 computed style |
| 背景 | `rgba(20,20,28,0.55)` | 实测 |
| 背景滤镜 | `blur(24px) saturate(1.5)` | 实测 |
| 边框 | `1px solid rgba(255,255,255,0.15)` | 实测 |
| 阴影 | 三层：`rgba(0,0,0,.5) 0 24px 64px`, `rgba(132,204,22,.06) 0 0 24px`, `rgba(255,255,255,.12) 0 1px 0 inset` | 实测 |
| **入场动画** | **`0.3s cubic-bezier(0.16, 1, 0.3, 1)`**，`animation-name: enter` | 实测 `getComputedStyle().animation` |
| transform-origin | `0px 0px`（由 Radix Popper 注入） | 实测 |
| `data-side` | **`bottom`** | 实测（HoverCard 默认）|
| `data-align` | **`start`** | 实测（非默认的 center）|
| **打开延迟** | **约 255ms**（实测首次出现） | 实测 |
| **关闭延迟** | **约 224ms**（`pointerleave` -> `data-state` 变化） | 实测 |
| 快速掠过 | 120ms 后离开 -> **不弹出**（证明 openDelay 生效） | 实测 |
| **指针移入浮层内部** | **浮层保持打开，不关闭** | 实测（移入浮层正中 1500ms 仍 open） |

## 二、触发区（关键，曾两次误判）

**实测：只在「头像 + 作者名」这一整块触发，不是整个卡片。**

- 悬停卡片图片区 (360,200) -> **closed**（不弹）
- 悬停头像 (347,409) -> **open**
- 悬停处若落在卡片正文/图片，不触发。

> 【教训】前两次探测得出「整个卡片都弹」「移进浮层就关」两个错误结论，
> 都是因为测试坐标算错：一次 x=333 y=389 落在了卡格里，一次把浮层矩形算错导致
> 鼠标点到了浮层外面。**浮层的实测矩形必须先读出来，再据此计算测试点坐标，
> 不能凭推测写死坐标。**

## 三、结构（内容从上到下）

```
.user-card-banner  (h-24, 96px, 内嵌 IMG object-cover)   <- 封面图
.px-4.pb-4
  .relative.-mt-9.mb-2  圆形 64x64 头像，相对上移 36px
  .flex.items-center.gap-2
    H3  truncate text-xl font-bold  (名字)
  P  mt-1 line-clamp-2 text-sm text-white/50  (简介)
  .mt-4.grid.grid-cols-3.gap-2.border-t.border-white/10.pt-4  (三项统计: 数值+标签)
  .mt-4.flex.gap-2      (两个按钮 flex-1, 42px 高, 圆角 12px)
  BUTTON.mt-2.w-full    (全宽按钮, 42px 高, 圆角 12px, 带 svg 图标)
```

## 四、Radix HoverCard 默认值（源码核实，非本项目实测）

| 参数 | 默认值 |
|---|---|
| `openDelay` | 700ms |
| `closeDelay` | 300ms |
| Trigger 绑定的事件 | `onPointerEnter` / `onPointerLeave` / `onFocus` / `onBlur` |
| Content 上的指针事件 | **没有** `onPointerEnter`（只绑 pointerDown/Up + DismissableLayer） |
| 关闭后是否立即卸载 | **否**，Presence 先播完出场动画再卸载 |
| 键盘可达性 | Trigger 的 `onFocus` 会打开浮层 |

参考站实测 255/224ms 说明它**覆盖了默认的 700/300**。

## 五、本项目的刻意偏离（不是缺陷）

1. **内容不是资料卡，而是这张卡的照片** —— 用户 m05970 明确要求。参考站的 banner/头像/名字/三项统计/三个按钮结构**不照抄**。
2. **没有「获赞/粉丝/帖子」数据** —— 纯静态站，无后端，不伪造数字。
3. **指针移入浮层后保持打开** —— 参考站也保持打开（实测），双方一致，不是偏离。
4. **浮层内有「查看大图」按钮，必须可点击** —— 因此必须保留「指针在浮层内不关闭」的逻辑与安全区判定。
