# 参考站实测规格：导航栏滚动收起 + 悬停浮层定位

> 由主理人用真实 Chrome（1440x900）点击/滚轮操作 forum.hanakos.cc 逐项测量得到。
> 实现时直接照做，不要再抓参考站。

## 一、导航栏滚动收起（scroll hide）

参考站导航是 `<header class="fixed top-4 left-4 right-4 z-40 max-w-6xl mx-auto transition-transform duration-300 ease-in-out">`。

- 初始：`transform: translateY(0)`，`getBoundingClientRect().top = 16`（`top-4`）
- 向下滚动超过阈值：`transform: translateY(-99px)`，`top` 变成 **-83**（完全移出视口上方）
- 过渡：`transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

**实测阈值（关键）**：

| 滚动操作 | 导航栏状态 |
| --- | --- |
| 向下滚 1px | 不动（top=16） |
| 向下滚 50px | 不动（top=16） |
| 向下滚 100px | **收起**（top=-83） |
| 向下滚 150px / 200px | 保持收起 |
| 收起后向上滚 1px / 2px / 5px | 仍收起（top=-83） |
| 收起后向上滚 10px | **展开**（top=16） |
| 收起后向上滚 20px / 50px | 展开 |

**结论**：向下需要累计约 80~100px 才收起；向上只需累计约 8~10px 就展开。
这是一个明显的滞后（hysteresis），不是「一滚就动」。

**实现要点**：
1. 用 `transform: translateY(-Npx)` 隐藏，不要用 `top`（避免触发 layout）。
2. N 必须大于导航高度，参考站高 66px 却用 99px，是为完全移出并留余量。
3. 顶部边界：`scrollY <= 0` 时必须强制展开（回到页首一定会看到导航）。
4. 用 rAF 节流 scroll 事件，不要每个 scroll 事件都改 DOM。
5. 转场覆盖层（ptr）激活时不要参与滚动收起逻辑，避免干扰。

## 二、悬停浮层定位（上/下自动翻转）

参考站浮层高 384px（资料卡），`data-align="start"`（左对齐）。

**实测数据（1440x900，viewport 高 900）**：

| 头像 y | 头像高 | 浮层高 | 下方可用空间 | 实际 side | 浮层 top |
| --- | --- | --- | --- | --- | --- |
| 266 | 40 | 384 | 900-266-40 = 594 | **bottom** | 308 |
| 768 | 40 | 384 | 900-768-40 = 92 | **top** | 366 |
| 51 | 40 | 384 | 900-51-40 = 809 | **bottom** | 90 |
| 262 | 40 | 384 | 900-262-40 = 598 | **bottom** | 301 |
| 473 | 40 | 384 | 900-473-40 = 387 | **top** | 51 |

**判定规则**：

- 计算 `spaceBelow = viewportH - 头像.bottom - 间隙`，`spaceAbove = 头像.top - 间隙`
- **下方空间 >= 浮层高** → `side = bottom`，浮层 `top = 头像.bottom + 间隙`
- **下方空间不足** → `side = top`，浮层 `bottom = 头像.top - 间隙`（即 `top = 头像.top - 间隙 - 浮层高`）
- 两个方向都不够时，选空间大的那边，并钳制在视口内

**间隙实测**：头像 y=266、高 40，浮层 top=308 → 间隙 = 308 - (266+40) = **2px**。
注意：浮层 top=366（side=top，头像 y=768）→ 浮层 bottom = 366+384 = 750，头像 top 768 → 间隙 = 768 - 750 = **18px**。
两个方向的间隙不同（下面 2px、上面 18px），推断是 Radix 的 `sideOffset` 加上箭头/对齐调整；
**本项目统一取 22px（现有 `POPOVER_GAP`）即可，不必逐像素复刻**。

**与现有实现的差异**：

我方已有 `computePopoverPosition()` 做上下自动选择，但：
1. 需要考虑浮层高度是**动态**的（照片浮层高随图片比例变化，320 宽时 3:4 照片高约 478px，16:9 约 232px），
   不能用固定 384 判断。
2. 必须考虑 `NAV_SAFE_TOP`（导航栏收起/展开会改变安全区）。

## 三、滚动时浮层跟随

用户反馈「源网站鼠标悬停时移动鼠标滚轮是可以跟着走的」。
参考站浮层是 Radix popper，`position: fixed` + 每帧由 popper 重新计算位置，
所以滚动时浮层跟着锚点移动。

我方现有实现：`window.addEventListener('scroll', handleViewportChange, { capture: true })`
→ `positionPopover()` 重新定位。**需要实测确认我方滚动时浮层是否跟手**，
若不跟，检查 scroll 监听是否被 detach，以及 `positionPopover` 是否读的是最新锚点矩形。