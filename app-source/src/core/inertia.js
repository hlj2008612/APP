import { state } from './state.js';
import { WORLD_W, WORLD_H, FRAME_MS } from './config.js';
import { mod } from './utils.js';
import { updateRender } from './renderer.js';

// 边界环绕修正，保证无限画布
function wrapScroll() {
    state.scrollX = mod(state.scrollX, WORLD_W);
    state.scrollY = mod(state.scrollY, WORLD_H);
}

// 速度衰减：与帧率无关。旧实现每帧固定 *0.91，在 120Hz 屏幕上
// 拖拽惯性只有 60Hz 时的一半长。改为按真实时间衰减。
const DECAY_PER_MS = Math.pow(0.91, 1 / FRAME_MS);
const MIN_SPEED = 0.4;

// 惯性滚动动画循环
function mainLoop(ts) {
    if (state.rafId === null) return; // 已被 destroyPhotoWall 取消

    const prev = state.rafPrev || ts;
    const dt = Math.min(ts - prev, 64); // 切后台回来时不要一次跳很远
    state.rafPrev = ts;

    let shouldContinue = false;
    if (state.inertiaActive) {
        state.scrollX += state.velocityX;
        state.scrollY += state.velocityY;
        wrapScroll();

        const decay = Math.pow(DECAY_PER_MS, dt);
        state.velocityX *= decay;
        state.velocityY *= decay;

        if (Math.abs(state.velocityX) < MIN_SPEED && Math.abs(state.velocityY) < MIN_SPEED) {
            state.inertiaActive = false;
            state.velocityX = 0; state.velocityY = 0;
            if (state.canvas) state.canvas.classList.remove('grabbing');
        }
        updateRender();
        shouldContinue = state.inertiaActive;
    }

    // 【旧 bug 修复】这里原来是 `if (needsUpdate && !inertiaActive)`：
    // 惯性收尾的那一帧 inertiaActive 已置 false，若此刻 needsUpdate 为真
    // 就必须留到下一次交互才渲染。现在无条件消费 needsUpdate。
    if (state.needsUpdate) {
        state.needsUpdate = false;
        updateRender();
    }

    if (shouldContinue) {
        state.rafId = requestAnimationFrame(mainLoop);
    } else {
        state.rafId = null;
        state.rafPrev = 0;
    }
}

function startLoop() {
    if (state.rafId === null) {
        state.rafPrev = 0;
        state.rafId = requestAnimationFrame(mainLoop);
    }
}

// 【旧 bug 修复】旧实现写成 `if (!state.rafId) requestAnimationFrame(mainLoop)`，
// 只看 rafId 不看是否真的在循环：当 rafId 已被 cancelAnimationFrame 取消
// 却没置空、或 id 恰好为 0 时，会把循环彻底丢掉（画面卡死不再更新）。
// 另外原来 scheduleUpdate() 在被驱动的那一帧里也会白白起第二个 RAF。
export function scheduleUpdate() {
    state.needsUpdate = true;
    startLoop();
}

export function startInertia() {
    if (Math.abs(state.velocityX) < MIN_SPEED && Math.abs(state.velocityY) < MIN_SPEED) {
        state.inertiaActive = false;
        if (state.canvas) state.canvas.classList.remove('grabbing');
        scheduleUpdate();
        return;
    }
    state.inertiaActive = true;
    if (state.canvas) state.canvas.classList.add('grabbing');
    startLoop();
}

export function stopInertia() {
    state.inertiaActive = false;
    state.velocityX = 0; state.velocityY = 0;
    if (state.canvas) state.canvas.classList.remove('grabbing');
}

export function cancelLoop() {
    if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
    }
    state.rafPrev = 0;
    state.inertiaActive = false;
    state.needsUpdate = false;
}