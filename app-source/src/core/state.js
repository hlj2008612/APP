import { WORLD_W, WORLD_H } from './config.js';

// ================================================================
//  原生照片墙全局状态
//  【维护提示】：scrollX / velocityX 更新极频繁，
//  不要改成 Vue 的 ref / reactive，否则会造成严重性能问题
// ================================================================

// 必须保持 object literal：V8 会给它分配隐藏类 / 稳定形状，
// 之后每帧读写属性都走内联缓存；不要改成 class、getter 或 Proxy。
export const state = {
    // 视口尺寸：惰性初始化，模块 import 时不读 window（SSR / 测试友好）
    viewW: 0,
    viewH: 0,
    scrollX: 0,
    scrollY: 0,

    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    lastMoveTime: 0,

    velocityX: 0,
    velocityY: 0,
    inertiaActive: false,

    moveDxHistory: [],
    moveDyHistory: [],

    needsUpdate: false,
    rafId: null,
    rafPrev: 0,
    canvas: null,

    // 渲染引擎在启动时把槽位数组挂到这里。
    // 【不要】在 state.js 顶部 import renderer.js 拿它：那会形成
    // state <-> renderer 的循环依赖，而 renderer 在模块求值期就要读 state，
    // 会撞上 TDZ（"Cannot access 'col' before initialization"）。
    // 依赖方向必须保持单向：renderer -> state。
    worldCol: null,  // 固定 300 项的槽位数组，索引 = row * WORLD_COLS + col
    prf: 1,          // prefers-reduced-motion 时为 0，用来跳过可选动效
    hoverIndex: -1,  // 悬停的图片序号（0 基），用于卡片放大
};

export function initViewport() {
    state.viewW = window.innerWidth;
    state.viewH = window.innerHeight;
    state.scrollX = WORLD_W / 2 - state.viewW / 2;
    state.scrollY = WORLD_H / 2 - state.viewH / 2;
}

export function setCanvas(el) {
    state.canvas = el;
}

export function resetView() {
    state.scrollX = WORLD_W / 2 - state.viewW / 2;
    state.scrollY = WORLD_H / 2 - state.viewH / 2;
}

export function isReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 供 Vue 在 mounted / updated 后按需关闭 keep-alive 冻结（见 PhotoWall.vue）
export function requestUpdate() {
    state.needsUpdate = true;
}