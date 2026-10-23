<template>
  <div id="canvas" ref="canvasRef"></div>
  
  <!-- 右上角圆形关闭按钮 -->
  <button class="close-btn" @click="handleClose" aria-label="关闭">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  </button>
</template>

<script setup>
import { onMounted, onUnmounted, ref, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { initPhotoWall, destroyPhotoWall, installCanvasAPI } from '../core/main.js';

const canvasRef = ref(null);
const router = useRouter();

// 代际令牌：onMounted 触发后若组件在异步期间被卸载，
// 这一次初始化就必须作废，绝不能把事件绑到已卸载的 canvas 上。
let generation = 0;

onMounted(async () => {
  // 未登录则回到登录页
  if (sessionStorage.getItem('photoWallLoggedIn') !== 'true') {
    router.push('/login');
    return;
  }
  const canvas = canvasRef.value;
  if (!canvas) return;

  const myGen = ++generation;

  // 等一帧：确保 <transition>/keep-alive 激活结束、元素已进入文档流并拿到布局，
  // 否则 viewW/viewH 可能与最终尺寸不一致。
  await nextTick();
  if (myGen !== generation) return;   // 已被卸载，放弃

  // 【关键】initPhotoWall 现在是同步的（内部不再 await 图片加载），
  // 因此不存在"await 期间组件被卸载"的窗口期。
  installCanvasAPI();
  initPhotoWall(canvas);
});

onUnmounted(() => {
  // 作废所有在途初始化
  generation++;
  destroyPhotoWall(canvasRef.value);
});

// 关闭按钮：返回首页
//
// 【为什么不是 router.push('/')】那样会绕开转场覆盖层，直接硬跳 ——
// 站内其它所有导航（导航栏、退出登录）都走 App.vue 的 runTransition，
// 只有这里不播，退出照片墙时会突兀地闪一下。转场由覆盖层自己负责 push，
// 时机是"擦入盖住旧页面之后"，所以这里只需要把目标路径交给它。
const handleClose = () => {
  if (typeof window !== 'undefined' && typeof window.playPageTransition === 'function') {
    window.playPageTransition('/');
    return;
  }
  // 理论上不该发生（App.vue 常驻挂载时就会装上这个桥接）。
  // 真的没有也不能让点击失效：退化成原来的直接跳转。
  router.push('/');
};
</script>

<style scoped>
#canvas {
  width: 100vw; height: 100vh;
  cursor: grab; position: relative; overflow: hidden;
}
#canvas:active { cursor: grabbing; }

/* 【移动端手势】画布自己接管单指拖拽（input.js 的 onPointerDown/Move 里
   preventDefault 掉了 touchstart/touchmove），给浏览器一个明确声明：
   · touch-action: none —— 不做浏览器原生平移 / 双击缩放的手势判定，
     单指拖拽从第一帧就跟手，也不会触发 300ms 点击延迟；
   · overscroll-behavior: none —— 双击放大到「先放大再拖动」时，手指拖到
     边界不会把整页拖着上下弹（iOS Safari 的下拉刷新 / 橡皮筋同样被禁掉）。
   桌面端只影响触控手势，鼠标行为（cursor / hover / wheel）完全不变。 */
#canvas {
  touch-action: none;
  overscroll-behavior: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

/* 右上角圆形关闭按钮 */
.close-btn {
  position: fixed;
  /* 【安全区】刘海 / 圆角屏下按钮要落在物理安全区内，否则可能被遮挡或误触。
     env() 在非刘海设备（含全部桌面浏览器）上取不到值，自动回落到原来的 24px，
     桌面端（>=1024px）位置一个像素都不变。 */
  top: calc(24px + env(safe-area-inset-top, 0px));
  right: calc(24px + env(safe-area-inset-right, 0px));
  z-index: 99998;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(20, 20, 25, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #ffffff;
  cursor: pointer;
  transition: all 0.25s ease;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  padding: 0;
}
/* 键盘用户保留可见焦点环（main.css 里已有全局 :focus-visible 规则）。
   原来这里是 outline: none，会把键盘焦点环也一起抹掉。 */
.close-btn:focus-visible {
  outline: 2px solid #4a9eff;
  outline-offset: 2px;
}
.close-btn:hover {
  background: rgba(40, 40, 50, 0.75);
  border-color: rgba(255, 255, 255, 0.25);
  transform: scale(1.08);
}
.close-btn:active {
  transform: scale(0.96);
}
</style>

<style>
/* 卡片全局样式（原生 JS 生成，不能用 scoped） */
.item {
  position: absolute; border-radius: 16px; overflow: hidden; pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); transition: box-shadow 0.3s ease;
  transform-origin: center center; display: flex; align-items: center; justify-content: center;
  backface-visibility: hidden;
}
.item img {
  position: relative; width: 100%; height: 100%; object-fit: contain;
  display: block; transition: transform 0.4s ease; flex-shrink: 0;
}
/* 注意：.item 是 pointer-events:none，:hover 永远不会命中（悬停放大由 JS 的
   state.hoverIndex 驱动，见 src/core/renderer.js 的 isHovered）。这条规则是死代码，
   保留只会误导后来者，故删除。 */
</style>