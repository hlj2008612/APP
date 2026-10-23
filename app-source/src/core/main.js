import { state, initViewport, setCanvas, resetView, isReducedMotion } from './state.js';
import { whenImagesReady } from './config.js';
import { buildCards, updateRender, setHover, getCard, destroyCards } from './renderer.js';
import { bindEvents, unbindEvents } from './input.js';
import { cancelLoop, scheduleUpdate } from './inertia.js';

// 初始化照片墙（由 PhotoWall.vue 在 onMounted 时调用）
//
// 该函数【不再 await 任何东西】：旧实现是 `await buildCards(canvasEl)`，
// 期间用户离开页面就会把事件绑到已经卸载的 canvas 上。现在同步完成绑定，
// 图片清单的异步加载只在后面补一次重绘。
export function initPhotoWall(canvasEl) {
    if (!canvasEl) return;

    initViewport();
    setCanvas(canvasEl);
    state.prf = isReducedMotion() ? 0 : 1;
    state.hoverIndex = -1;
    state.needsUpdate = false;

    buildCards(canvasEl);
    bindEvents(canvasEl);
    updateRender();

    // 清单到位后尺寸表会变（数据源一致时结果不变），补一帧即可
    whenImagesReady().then(() => {
        if (state.canvas === canvasEl) {
            state.needsUpdate = true;
            scheduleUpdate();
        }
    });
}

// 销毁照片墙（由 PhotoWall.vue 在 onUnmounted 时调用）
export function destroyPhotoWall(canvasEl) {
    unbindEvents(canvasEl);
    cancelLoop();          // 取消 RAF + 清 inertiaActive / needsUpdate
    // 【bug 修复】这里必须回收卡片：destroyCards() 会移除 300 个 DOM 节点、
    // 清空 cards Map、复位槽位数组和 state.worldCol。
    // 旧实现漏了这一步，而 renderer.js 里的 destroyCards() 全项目无人调用，
    // 于是每次离开 /wall 再回来都会残留 300 个节点与卡片对象（DOM 与内存双重泄漏）。
    destroyCards();
    setHover(-1);
    setCanvas(null);
    state.isDragging = false;
    state.velocityX = 0;
    state.velocityY = 0;
    state.moveDxHistory = [];
    state.moveDyHistory = [];
    state.hoverIndex = -1;
}

// ---- 调试入口（等价于旧 src/assets/main.js 的 window.canvasAPI） ----
// 旧 assets/main.js 引用了完全不存在的 updateRender / resetHintTimer 等符号，
// 一旦被 import 就抛 ReferenceError，已删除；这里补上可用的等价实现。
export function installCanvasAPI() {
    if (typeof window === 'undefined') return;
    window.canvasAPI = {
        resetView() {
            resetView();
            scheduleUpdate();
        },
        refresh() {
            scheduleUpdate();
        },
        // 返回某张卡片的当前几何（仅调试用）
        card(c, r) {
            const card = getCard(c, r);
            return { x: card.x, y: card.y, w: card.w, h: card.h, attached: card.attached };
        },
    };
}