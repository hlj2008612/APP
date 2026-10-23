<template>
  <NavBar v-if="!route.meta.hideNav" @navigate="handleNavigate" @logout="handleLogout" />
  <router-view />

  <!--
    ptr 擦除转场覆盖层（复刻 https://forum.hanakos.cc）。

    【为什么它必须常驻挂载，而不是 v-if 按需挂载】转场的第一步是"擦入盖住当前页面"，
    此刻覆盖层必须已经存在；如果等到点击时才挂载，第一帧会先出现旧页面再叠上覆盖层，
    产生一次可见的闪烁。常驻挂载的代价接近零：空闲态是 .ptr-root.ptr-idle
    （visibility:hidden + pointer-events:none），内部 DOM 为空。

    【它与 hideNav 无关】/wall 与 /login 虽然不显示导航栏，但从 /cinema 进 /wall
    同样需要转场，所以这里【不能】写 v-if="!route.meta.hideNav"。

    【为什么不做降级分支】上一版实现里，不支持 View Transitions 的浏览器会退回
    PageTransition.vue（gsap 胶片转场）。本轮改用的 ptr 覆盖层是纯 CSS 动画 + Vue
    状态机，不依赖 View Transitions API，也不依赖 gsap，所有支持 CSS 动画的浏览器
    都能跑（含 Safari 与 Firefox）。保留一个降级分支既没有必要，也会让两条路径的
    观感不一致。PageTransition.vue 与 gsap 依赖已随本轮改动一并删除。
  -->
  <PtrTransition ref="transitionRef" />
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NavBar from './components/NavBar.vue';
import PtrTransition from './components/PtrTransition.vue';

const route = useRoute();
const router = useRouter();
const transitionRef = ref(null);

// 退出的转场目标：/login 不在下面的顺序表里，方向会回退成 'next'，
// 擦除照常从右侧进入 —— 与参考站"路径不在表内时仍播动画"的行为一致。
const LOGOUT_PATH = '/login';

// 方向表：决定擦除从哪一侧进入（next 从右、prev 从左）。
// 顺序与导航栏的排列一致，与参考站 ROUTE_ORDER 的作用相同。
const ROUTE_ORDER = ['/', '/wall', '/cinema', '/pictorial'];

/**
 * 由起止路径求转场方向。
 *
 * @returns {'next'|'prev'} 总有一个结果：不在表内（例如 /login）或起止相同时回退 'next'。
 *   【为什么不返回 null 表示"不转场"】参考站的做法就是不转场也要播 ——
 *   方向只影响擦入的左右侧，不影响是否播动画。真正要跳过动画的场景
 *   （系统开启"减少动态效果"、页面处于后台）由 PtrTransition 内部判断。
 */
const resolveDirection = (from, to) => {
  const a = ROUTE_ORDER.indexOf(from);
  const b = ROUTE_ORDER.indexOf(to);
  if (a === -1 || b === -1 || a === b) return 'next';
  return b > a ? 'next' : 'prev';
};

/**
 * 播放一次转场并导航。
 *
 * 【时序】ptr 覆盖层自己负责 router.push：它先擦入盖住旧页面，
 * 等擦入动画结束、新页面在覆盖层后面渲染完成后才 push，再擦出揭示新页面。
 * 所以调用方【不要】在这里再 push 一次，否则会变成先跳路由再播动画，
 * 旧页面在被盖住之前就已经消失，出现闪黑。
 *
 * @param {string} target 目标路径
 * @returns {Promise<boolean>} true = 本次转场被接受并已导航；false = 上一轮未结束、被丢弃
 */
const runTransition = async (target) => {
  const instance = transitionRef.value;

  // 组件实例不可用（理论上不该发生：它没有异步加载）。
  // 此时必须自己兜一次导航，绝不能让点击被静默吞掉。
  if (!instance) {
    router.push(target);
    return false;
  }

  const accepted = await instance.play(target, resolveDirection(route.path, target));

  // play() 返回 false 表示覆盖层正忙、本次请求被丢弃。
  // 【关键】这里必须补一次导航：否则用户点击后既没有转场也没有跳转，
  // 是最糟的一种失败（静默无响应）。旧版实现就是因为 play() 静默返回
  // 而没有兜底，导致"转场进行中点击退出"完全失效。
  if (!accepted) {
    router.push(target);
  }
  return accepted;
};

/** 导航（带转场）。 */
const handleNavigate = async (item) => {
  await runTransition(item.path);
};

/**
 * 退出登录（带转场）。
 *
 * 【调用时 sessionStorage 里的登录标记已经由 NavBar 清掉了】这是必须的：
 * router/index.js 的守卫是 to.path === '/login' && isLoggedIn() 时弹回 '/'，
 * 若标记还在，跳 /login 会被弹回首页，退出直接失败。
 * NavBar.logout() 正是先同步清除、再 emit('logout')，时序已经保证。
 */
const handleLogout = async () => {
  await runTransition(LOGOUT_PATH);
};

/**
 * 把转场入口暴露到 window，供无法直接访问本组件上下文的子路由使用。
 *
 * 【为什么需要它】runTransition 定义在这里，而 src/views/PhotoWall.vue 是子路由，
 * 拿不到本组件的上下文；/wall 上导航栏又是隐藏的（hideNav），它的关闭按钮
 * 是唯一的出口，必须也能走转场。参考站的转场是【全局点击拦截】，
 * 任何 <a> 都被接管，所以不存在这种"漏网的导航"；这里用一个小桥接等价实现。
 *
 * 【为什么不用 provide/inject】App.vue 的 <router-view /> 没有具名插槽中转，
 * 而 /wall 是 hideNav 路由、NavBar 并不渲染，注入链路要靠 router-view 传递，
 * 反而更绕。window 上挂一个函数最直接，且离开页面时会被摘掉。
 */
onMounted(() => {
  if (typeof window !== 'undefined') {
    window.playPageTransition = (target) => runTransition(target);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined' && window.playPageTransition) {
    delete window.playPageTransition;
  }
});
</script>

<!--
  body / html 的全局样式（margin、height、背景、user-select、字体）统一由
  src/assets/main.css 负责，这里只保留 #app 自身特有的规则，避免两处真相。
-->
<style>
#app { width: 100%; height: 100%; overflow: hidden; }
</style>
