import { state } from './state.js';
import { WORLD_W, WORLD_H, WORLD_COLS, WORLD_ROWS } from './config.js';
import { stopInertia, startInertia, scheduleUpdate } from './inertia.js';
import { setHover, imageIndexAt } from './renderer.js';

// 统一获取坐标（兼容鼠标和触摸）
function getPos(e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

// 键盘事件是否来自可输入控件 —— 旧实现里在登录表单输入密码时
// 打一个 a/d/w/s/r 就会滚动照片墙并 preventDefault 吞掉按键。
function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
}

// 按下：记录起点，停止惯性
function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // 【多指】第二根手指落下时不重置起点。否则双指手势里后落的那根手指
    // 会把 lastMouseX/Y 跳过去，画面瞬间跳一截；直接忽略后到的触点，
    // 拖拽继续跟第一根手指走（"第一个按下的触点"是既定行为，语义不变）。
    if (state.isDragging) return;
    stopInertia();
    state.isDragging = true;
    const p = getPos(e);
    state.lastMouseX = p.x; state.lastMouseY = p.y;
    state.lastMoveTime = performance.now();
    setHover(-1);
    state.velocityX = 0; state.velocityY = 0;
    if (state.canvas) state.canvas.classList.add('grabbing');
    if (e.cancelable) e.preventDefault();
}

// 移动：更新位置，并记录速度历史
function onPointerMove(e) {
    if (!state.isDragging) return;
    const p = getPos(e);
    const dx = p.x - state.lastMouseX;
    const dy = p.y - state.lastMouseY;
    const now = performance.now();
    const dt = Math.max(now - state.lastMoveTime, 1);

    // 【bug 修复】拖拽方向反了。
    // renderer.js 里 scrollX 是【摄像机左边界】：cellX = 世界坐标 - scrollX
    // （见 renderer.js:258）。所以 scrollX 变大 = 摄像机右移 = 内容在屏幕上【向左】走。
    // 旧实现写的是 `scrollX += dx`，于是鼠标向右拖 100px，卡片反而左移 100px ——
    // 抓住内容拖却朝反方向跑。正确手感是"内容跟着手走"，故这里取负。
    //
    // 速度历史必须用同一个符号：onPointerUp() 会从 moveDxHistory 求平均得到
    // velocityX，而 inertia.js:27 是 `scrollX += velocityX`。若只改滚动不改速度，
    // 松手瞬间照片墙会朝反方向飞出去。
    const scrollDx = -dx;
    const scrollDy = -dy;

    // 归一化到 60fps 速度
    state.moveDxHistory.push((scrollDx / dt) * 16.67);
    state.moveDyHistory.push((scrollDy / dt) * 16.67);
    if (state.moveDxHistory.length > 5) state.moveDxHistory.shift();
    if (state.moveDyHistory.length > 5) state.moveDyHistory.shift();

    state.scrollX += scrollDx;
    state.scrollY += scrollDy;
    state.lastMouseX = p.x; state.lastMouseY = p.y;
    state.lastMoveTime = now;
    scheduleUpdate();
    if (e.cancelable) e.preventDefault();
}

// 松手：计算平均速度，触发惯性
// 【多指】抬起任意一根手指时若还有别的触点留在屏幕上，说明拖拽并未结束，
// 不触发惯性（原来两指交替抬起时会突然飞出去）。
function onPointerUp(e) {
    if (!state.isDragging) return;
    if (e && e.touches && e.touches.length) return;
    state.isDragging = false;
    if (state.moveDxHistory.length) {
        state.velocityX = state.moveDxHistory.reduce((a, b) => a + b, 0) / state.moveDxHistory.length;
        state.velocityY = state.moveDyHistory.reduce((a, b) => a + b, 0) / state.moveDyHistory.length;
    }
    // 速度上限，防止飞出去
    if (Math.abs(state.velocityX) > 35) state.velocityX = Math.sign(state.velocityX) * 35;
    if (Math.abs(state.velocityY) > 35) state.velocityY = Math.sign(state.velocityY) * 35;

    if (Math.abs(state.velocityX) > 0.4 || Math.abs(state.velocityY) > 0.4) {
        startInertia();
    } else {
        if (state.canvas) state.canvas.classList.remove('grabbing');
        scheduleUpdate();
    }
    state.moveDxHistory = []; state.moveDyHistory = [];
}

// 【旧 bug 修复】以前绑的是 window 的 'mouseleave'：
// 鼠标离开文档时 window 上并不触发它，拖拽状态会卡住（松手后仍在拖）。
// 文档边界事件应该是 document 的 'mouseleave'（也叫 mouseout），
// 同时补上 window 失焦 / 页面隐藏时的兜底复位。
function onWindowBlur() {
    abortDrag();
}

function onPointerCancel() {
    abortDrag();
}

// 【旧 bug 修复】失焦 / 切后台属于【中断】，不是"用户松手"：绝不能走 onPointerUp()。
// onPointerUp() 会从 moveDxHistory 算出速度并 startInertia()，于是：
//   - 拖拽中切走窗口  -> 照片墙带着接近上限的速度自己飞走；
//   - 切到后台标签页  -> 惯性循环在隐藏标签里继续跑（白耗 CPU / 电量）。
// 中断的正确语义是：立刻停住并清理拖拽状态。
function abortDrag() {
    state.isDragging = false;
    state.moveDxHistory = [];
    state.moveDyHistory = [];
    stopInertia();
    if (state.canvas) state.canvas.classList.remove('grabbing');
    scheduleUpdate();
}

// 悬停放大：直接命中测试，不依赖 300 个卡片节点的事件监听
function onHoverMove(e) {
    if (state.isDragging) return;
    const viewW = state.viewW;
    const viewH = state.viewH;
    const dynamicScale = Math.min(1.4, Math.max(0.5, Math.min(viewW / 1400, viewH / 900)));
    const currentStep = 340 * dynamicScale;
    // 【旧 bug 修复】原实现自己造了一套坐标推导，且把 scrollX 用了两次：
    //   sx = (scrollX + clientX - viewW/2) / step
    //   m  = round(-scrollX / step - sx)          <- 这里又减了一次 scrollX
    // 展开后 clientX 的系数是负的（鼠标右移、格子坐标反而变小），且 scrollX 被计入两遍，
    // 算出的 imgIdx 与鼠标实际所在的卡片【永远对不上】，于是 isHovered 恒为 false ——
    // 悬停放大与 full 大图整体失效（真机实测：鼠标停在卡片正中心也毫无反应）。
    //
    // 正确推导（与 renderer.js 的 cellX = (wrappedCol + COLS*m)*step - scrollX 同源）：
    //   屏幕点落在格子 worldCol 上  <=>  worldCol*step - scrollX <= clientX
    //   => stateCol = floor((clientX + scrollX) / currentStep)
    // stateCol 是整数，取模后 wrappedCol 必然是整数 —— 这正是 imageIndexAt(col,row)
    // 所要求的（旧实现传进去的是浮点数，取模结果不可控）。
    const stateCol = Math.floor((e.clientX + state.scrollX) / currentStep);
    const stateRow = Math.floor((e.clientY + state.scrollY) / currentStep);
    const wrappedCol = ((stateCol % WORLD_COLS) + WORLD_COLS) % WORLD_COLS;
    const wrappedRow = ((stateRow % WORLD_ROWS) + WORLD_ROWS) % WORLD_ROWS;
    const next = imageIndexAt(wrappedCol, wrappedRow) - 1;

    // 【旧 bug 修复】旧实现只写了 state.hoverIndex 就结束了，从不请求重绘。
    // 悬停判定发生在渲染循环内部（renderer.js 的 isHovered = hoverIdx === card.imgIdx - 1），
    // 所以状态变了而没人驱动渲染时，放大与 full 大图都不会出现 ——
    // 只能等下一次碰巧有别的渲染（拖动、缩放、惯性）才会顺带生效。
    // 真机实测证据：悬停后无任何反应，手动调一次 canvasAPI.refresh() 立刻出现 2 张 full 图。
    // 这里只在序号真的变化时请求重绘，避免鼠标高频移动时疯狂排帧。
    if (next !== state.hoverIndex) {
        setHover(next);
        scheduleUpdate();
    }
}

// 滚轮：直接滚动，不停留惯性
function onWheel(e) {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); return; }
    stopInertia();
    state.scrollX -= e.deltaX;
    state.scrollY -= e.deltaY;
    scheduleUpdate();
    e.preventDefault();
}

// 键盘：WASD / 方向键移动，R 重置
function onKeyDown(e) {
    // 焦点在输入框 / 可编辑区域时完全不接管键盘
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();
    let handled = true;
    switch (key) {
        case 'arrowleft': case 'a': stopInertia(); state.scrollX -= 200; break;
        case 'arrowright': case 'd': stopInertia(); state.scrollX += 200; break;
        case 'arrowup': case 'w': stopInertia(); state.scrollY -= 200; break;
        case 'arrowdown': case 's': stopInertia(); state.scrollY += 200; break;
        case 'r':
            stopInertia();
            state.scrollX = WORLD_W / 2 - state.viewW / 2;
            state.scrollY = WORLD_H / 2 - state.viewH / 2;
            break;
        default: handled = false;
    }
    if (handled) { scheduleUpdate(); e.preventDefault(); }
}

// 窗口缩放：用匹配媒体变化 + rAF 折叠连发事件，避免拖动窗口时反复渲染
let hoverPending = false;
let hoverEvent = null;
let resizePending = false;

function onHoverRaw(e) {
    hoverEvent = e;
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(() => {
        hoverPending = false;
        if (hoverEvent) onHoverMove(hoverEvent);
        hoverEvent = null;
    });
}

// 窗口缩放
function onResize() {
    state.viewW = window.innerWidth;
    state.viewH = window.innerHeight;
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
        resizePending = false;
        scheduleUpdate();
    });
}

// 绑定所有事件
export function bindEvents(canvasEl) {
    canvasEl.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('mouseleave', onPointerUp);
    document.addEventListener('visibilitychange', onPointerCancel);
    canvasEl.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize, { passive: true });
    canvasEl.addEventListener('mousemove', onHoverRaw, { passive: true });
    canvasEl.addEventListener('mouseleave', onHoverOut, { passive: true });
}

function onHoverOut() {
    // 同上：离开画布同样要请求重绘，否则放大效果会一直停在最后一张悬停的卡片上
    if (state.hoverIndex !== -1) {
        setHover(-1);
        scheduleUpdate();
    }
}

// 解绑所有事件（组件销毁时必须调用）
export function unbindEvents(canvasEl) {
    if (!canvasEl) return;
    canvasEl.removeEventListener('mousedown', onPointerDown);
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    window.removeEventListener('blur', onWindowBlur);
    document.removeEventListener('mouseleave', onPointerUp);
    document.removeEventListener('visibilitychange', onPointerCancel);
    canvasEl.removeEventListener('touchstart', onPointerDown);
    window.removeEventListener('touchmove', onPointerMove);
    window.removeEventListener('touchend', onPointerUp);
    window.removeEventListener('touchcancel', onPointerUp);
    canvasEl.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    canvasEl.removeEventListener('mousemove', onHoverRaw);
    canvasEl.removeEventListener('mouseleave', onHoverOut);
    setHover(-1);
}