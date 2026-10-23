<template>
  <!--
    :class 的 hidden 状态给 CSS 提供 translateY(--nav-hide-y)。
    收起幅度由 CSS 变量 --nav-hide-y 决定（默认 -99px，移动端断点覆盖为 -94px），
    不在 JS 里写死数值，也不再走内联 style —— 避免内联 transform 压掉
    .glass-nav 原本的 translateX(-50%) 居中变换（两者必须写在同一条 transform 里）。
  -->
  <nav class="glass-nav" :class="{ 'is-hidden': navHidden, 'is-menu-open': menuOpen }" @mousedown.stop @wheel.stop>
    <div class="nav-left">
      <span class="logo">✦ 美琴子 ✦</span>
      <div class="nav-items">
        <!-- 半透明高亮胶囊，根据 active 元素动态计算位置 -->
        <div class="active-pill" :style="pillStyle"></div>
        <a v-for="item in navItems" :key="item.path"
           ref="linkRefs"
           href="#"
           class="nav-link"
           :class="{ active: currentPath === item.path }"
           :aria-current="currentPath === item.path ? 'page' : undefined"
           :aria-label="item.name"
           @click.prevent="handleNavigate(item)">
          {{ item.name }}
        </a>
      </div>
    </div>
    <div class="nav-right">
      <a href="#" @click.prevent="logout" class="logout-btn">
        <span class="icon">⏻</span> 退出
      </a>
      <!--
        汉堡按钮：只在手机端（<=767px）显示，桌面端 display:none 不占位。
        aria-expanded / aria-controls 让读屏软件知道这是可展开控件、以及它控制哪个节点。
        aria-controls 用条件绑定：抽屉在 v-if 关闭时节点不存在，写死 id 会成为悬空引用。
      -->
      <button
        ref="burgerRef"
        class="nav-burger"
        type="button"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        :aria-controls="menuOpen ? 'mobile-menu' : undefined"
        :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
        @click.stop="toggleMenu"
      >
        <svg v-if="!menuOpen" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
             fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
        <svg v-else aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
             fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>
    </div>
  </nav>

  <!--
    手机端菜单抽屉。桌面端由 CSS 整体 display:none（.nav-drawer 的基础规则）。
    fixed 定位 + 高 z-index，挂在 NavBar 内部即可，不会被其他层叠上下文截断。
    点空白处关闭：@click.self 只响应落在遮罩本身的点击，卡片内部的点击不会冒泡触发。
    tabindex="-1" + ref：抽屉要能被程序化聚焦（见 focusDrawer），兑现 aria-modal 的承诺。
  -->
  <div
    v-if="menuOpen"
    id="mobile-menu"
    ref="drawerRef"
    tabindex="-1"
    class="nav-drawer"
    role="dialog"
    aria-modal="true"
    aria-label="站点导航"
    @click.self="closeMenu"
  >
    <div class="nav-drawer-grid">
      <button
        v-for="item in navItems"
        :key="item.path"
        type="button"
        class="nav-card"
        :class="{ 'is-current': currentPath === item.path }"
        :style="{ '--card-color': item.color }"
        @click="handleCardNavigate(item)"
      >
        <span class="nav-card-icon" aria-hidden="true" v-html="item.icon"></span>
        <span class="nav-card-name">{{ item.name }}</span>
        <span class="nav-card-en">{{ item.title }}</span>
      </button>
    </div>
    <button type="button" class="nav-drawer-logout" @click="logoutFromMenu">⏻ 退出登录</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';

const emit = defineEmits(['navigate', 'logout']);
const route = useRoute();

const currentPath = ref(route.path);
const pillStyle = ref({});
const navHidden = ref(false);

// 【修复】原来用 document.querySelector('.nav-link.active') 做全局查询：
// 依赖 DOM 里恰好只有一个 .active 元素，任何同名类（比如页面里别处的 .active）
// 都会让胶囊跑到错误的元素上。改为模板 ref + 按索引取值，不再有全局查找。
const linkRefs = ref([]);

// icon 是抽屉卡片里的内联 SVG 字符串（v-html 注入）。
// 【安全性】navItems 是模块级常量、字符串在源码里写死，不来自任何外部输入，
// 因此不存在 XSS 风险。若将来改成从接口/CMS 读取，必须换成组件或白名单过滤。
// 描边颜色由 CSS 的 currentColor 决定，跟随 .nav-card 的 --card-color 主题色。
const navItems = [
  { name: '首页', path: '/', title: 'HOME', color: '#8b6ce8',
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' },
  { name: '照片墙', path: '/wall', title: 'GALLERY', color: '#4a9eff',
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  { name: '影院', path: '/cinema', title: 'CINEMA', color: '#e4bb38',
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/></svg>' },
  { name: '画报', path: '/pictorial', title: 'PICTORIAL', color: '#a3e635',
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>' }
];
/*
 * 手机端抽屉的状态位。
 * 【声明位置很关键】这些 ref 必须定义在 onScroll / updatePill / watch 之前 ——
 * 它们在 onScroll 里被读取做守卫，而 const 有暂时性死区（TDZ），
 * 若 onScroll 在 setup 执行完成前被调用就会抛 ReferenceError。
 * 放到文件靠后虽然平时能跑，但属于随时会炸的隐患。
 */
const menuOpen = ref(false);

// 汉堡按钮与抽屉的模板 ref，用于焦点管理。
const burgerRef = ref(null);
const drawerRef = ref(null);

// 计算胶囊宽度和位置（v-for 里的 ref 数组顺序与 navItems 一致）
const updatePill = () => {
  const idx = navItems.findIndex((item) => item.path === currentPath.value);
  const els = linkRefs.value;
  if (idx < 0 || !els || !els.length) return;

  // 用 getBoundingClientRect 相对 .nav-items 测量，避免依赖 offsetParent 链
  const activeEl = els.find((el) => el && el.classList.contains('active')) || els[idx];
  if (!activeEl) return;

  // 【祖先被 display:none 时直接放弃】抽屉打开时 .nav-items 被隐藏，
  // 此时所有 rect 都是 0，算出来的 pill 会变成 0 宽贴左，等抽屉关掉再跳回来。
  // offsetParent 为 null 是「自身或祖先 display:none」的可靠判据。
  if (activeEl.offsetParent === null) return;

  const parent = activeEl.offsetParent || activeEl.parentElement;
  if (!parent) return;

  const rect = activeEl.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  pillStyle.value = {
    width: `${Math.round(rect.width)}px`,
    transform: `translateX(${Math.round(rect.left - parentRect.left)}px)`
  };
};

// 监听路由变化，校准 active 状态
watch(
  () => route.path,
  async (newPath) => {
    currentPath.value = newPath;
    await nextTick();
    updatePill();
  }
);

/* ==========================================================================
   滚动收起 / 展开（规格见 docs/nav-scroll-and-popover-spec.md 第一节）

   【实测数值（来自规格，主理人用真 Chrome 实测参考站）】
     · 向下累计 100px      → 收起
     · 向下累计 1px / 50px → 不动
     · 收起后向上累计 1/2/5px → 仍收起
     · 收起后向上累计 10px    → 展开
   → 明显的滞后（hysteresis）：向下阈值远大于向上阈值。

   【实现分工】
     · 收起/展开的「视觉」全部交给 CSS：.glass-nav 常驻 transition，
       .glass-nav.is-hidden 时 transform 加一段 translateY(-99px)。
       JS 只负责切换一个布尔量，不写内联 style。
     · 为什么不用内联 style='transform: translateY(...)'：根元素原本就靠
       transform: translateX(-50%) 水平居中，内联 transform 会把它整个覆盖掉，
       导航栏会瞬间跳到视口左侧。两者必须写在同一条 transform 里（CSS 里处理）。

   【阈值选择】取 HIDE_DOWN = 100 / SHOW_UP = 10：两端都落在实测结论的正中间
   （规格给的区间是 80~100 与 8~10，实测点恰好是 100 与 10）。
   ========================================================================== */
const HIDE_DOWN = 100;    // 向下累计多少 px 收起
const SHOW_UP = 10;       // 收起后向上累计多少 px 展开
const EPS = 0.5;          // 亚像素抖动容差（浮点 / 缩放下 deltaY 不一定是整数）

let lastY = 0;            // 上一帧记录的滚动位置
let accDown = 0;          // 尚未触发收起的向下累计位移（展开态持续累加）
let accUp = 0;            // 尚未触发展开的向上累计位移（收起态持续累加）
let ticking = false;      // rAF 节流标志
let rafId = 0;
let pendingY = 0;         // 本帧待处理的最新滚动位置（同帧多次事件只保留最后一次）

/**
 * 读取当前滚动位置。
 *
 * 【不能直接读 window.scrollY】本站在 main.css / App.vue 里把 html / body / #app
 * 全部钉成 overflow:hidden —— 页面滚不动，真正滚动的是各个视图自己的
 * overflow:auto 容器（例如画报页的 .pictorial-page）。这些容器的 scroll 事件
 * 不冒泡到 window，只能用 capture 阶段在 window 上接住。
 * 因此在事件里就近取「实际滚动的那个元素」的 scrollTop 作为权威值。
 *
 * @param {Event} [e] scroll 事件（capture 阶段）
 * @returns {number} 当前滚动位置（px）
 */
const readScrollTop = (e) => {
  const t = e && e.target;
  // document 是 window 自己滚动时的事件目标；Scroll 事件里的 target 是滚动元素。
  if (t && t.nodeType === 1 && typeof t.scrollTop === 'number' && t !== document.documentElement && t !== document.body) {
    return t.scrollTop;
  }
  const de = document.documentElement;
  const bodyTop = document.body ? document.body.scrollTop : 0;
  const winY = window.scrollY || window.pageYOffset || 0;
  // 取三者最大值：document 滚动时 scrollTop 落在 documentElement（标准模式）或 body（怪异模式），
  // 视口滚动（visualViewport）时才只有 window.scrollY 有值。
  return Math.max(de ? de.scrollTop : 0, bodyTop || 0, winY);
};

/** 真正处理一帧：算出方向和累计量，再决定收起/展开。 */
const applyScrollState = (y) => {
  const dy = y - lastY;

  // 顶部边界：scrollY <= 0 时无条件展开（回到页首一定看得见导航）。
  if (y <= 0) {
    lastY = 0;
    accDown = 0;
    accUp = 0;
    navHidden.value = false;
    return;
  }

  lastY = y;

  if (dy > EPS) {
    // 向下：累加向下距离，并清零向上累计（方向反转即重新计数）。
    accUp = 0;
    accDown += dy;
    if (!navHidden.value && accDown >= HIDE_DOWN) {
      navHidden.value = true;
      accDown = 0;
    }
  } else if (dy < -EPS) {
    // 向上：累加向上距离，并清零向下累计。
    accDown = 0;
    accUp += -dy;
    if (navHidden.value && accUp >= SHOW_UP) {
      navHidden.value = false;
      accUp = 0;
    }
  }
  // |dy| <= EPS：没有有效位移，什么都不做（保留当前累计量）。
};

/**
 * 滚动监听入口 —— 只负责 rAF 节流，真正的计算在 applyScrollState。
 * 【为什么用 rAF】一次触摸/滚轮滑动会连续派发几十个 scroll 事件，
 * 逐个处理会反复读写状态；合并到每帧一次即可，且与浏览器的刷新节拍对齐。
 */
const onScroll = (e) => {
  // 转场覆盖层激活期间不参与收起逻辑（规格第一节第 5 条），避免转场中导航栏乱动。
  if (document.documentElement.hasAttribute('data-ptr-active')) return;

  // 抽屉打开时不做收起判断：抽屉是 fixed 全屏遮罩，背后的滚动不该让导航条
  // 从遮罩下面被顶走（.glass-nav 的 z-index 比抽屉高，收起来会露馅）。
  if (menuOpen.value) return;

  const y = readScrollTop(e);

  // 【不能只靠 rAF】后台标签页 / 页面隐藏时 rAF 会被完全暂停，
  // 挂起的回调要等回到前台才执行；此时直接同步补算，保证状态不会滞后一整个隐藏期。
  if (document.hidden) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      ticking = false;
    }
    applyScrollState(y);
    return;
  }

  // 每次事件都刷新待处理值：同帧内多次触发只保留最后一次的位置，仍是权威的。
  pendingY = y;
  if (ticking) return;
  ticking = true;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    ticking = false;
    applyScrollState(pendingY);
  });
};

onMounted(() => {
  updatePill();
  window.addEventListener('resize', updatePill);

  // 初值：刷新后浏览器常会恢复上一次的滚动位置，此时同步算一次，
  // 保证「刷新时已经在页面下方」也能立刻是收起态，而不是先展开再收。
  lastY = readScrollTop();
  applyScrollState(lastY);

  // capture: true 是必须的 —— 滚动容器不在 window 上，事件不会冒泡到 window。
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
});

onUnmounted(() => {
  window.removeEventListener('resize', updatePill);

  // 卸载时必须同时移除【监听】和【挂起的 rAF】：
  // 前者用同一个函数引用（匿名函数移除不掉）；后者若继续跑，会对着已销毁的
  // 组件改一个 ref 值 —— 虽不报错，但属于无意义的泄漏。
  window.removeEventListener('scroll', onScroll, { capture: true });
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
    ticking = false;
  }
});

// 点击瞬间立即移动胶囊，然后才通知父组件导航。
//
// 【为什么先动胶囊再跳】转场要等父组件拿到实例后才开始擦入（约 .28s 的擦入动画
// 加上 440ms 的最小等待），若胶囊等路由变化后再动，用户会先看到胶囊"没反应"。
// 乐观更新让点击立刻有反馈。
//
// 【幂等】同一个路径重复点击直接返回，不触发父组件的导航去重逻辑
// （父组件同样有一道 route.path === target 的短路，两处都不多余：
//  父组件要防的是程序化调用，这里防的是重复点击带来的无意义 emit）。
const handleNavigate = async (item) => {
  if (currentPath.value === item.path) return;
  currentPath.value = item.path;
  await nextTick();
  updatePill();
  emit('navigate', item);
};

// 【为什么退出要委托给父组件】清登录态这件事必须【同步、且早于路由跳转】，
// 但真正发起导航的是 App.vue（它持有 router 并统一处理导航去重与竞态）。
// 所以这里只负责清除登录态，然后把跳转委托给父组件。
//
// 【为什么清除必须留在这里而不是父组件】router/index.js 有守卫
//   if (to.path === '/login' && isLoggedIn()) return '/';
// 如果登录态留到路由跳转那一刻才清，守卫会把 /login 弹回 '/'，退出就失败了。
// 所以必须在触发任何导航之前同步清掉。
//
// 注意：真正的导航由父组件的 handleLogout 发起，它会走 PtrTransition 的
// 擦除转场（擦入盖住 -> 切路由 -> 擦出揭示），见 src/App.vue。
const logout = () => {
  try {
    sessionStorage.removeItem('photoWallLoggedIn');
  } catch (e) {
    // 隐私模式下 sessionStorage 访问会抛异常，不能让退出按钮整个失效
  }
  emit('logout');
};

/* ==========================================================================
   手机端抽屉（<=767px）

   桌面端整块不生效：.nav-burger / .nav-drawer 的基础规则都是 display:none，
   只有 @media (max-width: 767px) 里才把它们显示出来。
   抽屉的 DOM 用 v-if 控制，关闭时完全不渲染，不占内存也不参与合成。
   ========================================================================== */

/** 开合抽屉。按钮用 @click.stop，避免这次点击冒泡到 @click.self 被立刻关掉。 */
const toggleMenu = () => {
  menuOpen.value = !menuOpen.value;
};

/*
 * 关闭抽屉。
 * 【restoreFocus】默认把焦点还给汉堡按钮 —— 但「点了卡片要导航」这条路径不能还，
 * 因为紧接着就会触发 ptr 转场并整页替换，焦点扔回一个即将消失的按钮反而更糟。
 */
const closeMenu = (restoreFocus = true) => {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (restoreFocus) {
    nextTick(() => {
      // focus({ preventScroll }) 避免回焦时页面跳动。
      // 【只在键盘操作时回焦】触屏点遮罩关闭后把焦点塞回汉堡，
      // 移动端会残留一圈 :focus-visible 紫色描边，观感很差。
      if (burgerRef.value && lastInputWasKeyboard) {
        burgerRef.value.focus({ preventScroll: true });
      }
    });
  }
};

// 最近一次输入是否来自键盘。用于决定关闭抽屉后要不要回焦汉堡，见 closeMenu。
let lastInputWasKeyboard = false;
const markKeyboard = () => { lastInputWasKeyboard = true; };
const markPointer = () => { lastInputWasKeyboard = false; };
onMounted(() => {
  window.addEventListener('keydown', markKeyboard, true);
  window.addEventListener('pointerdown', markPointer, true);
});

/** 抽屉里点某张卡片：先关抽屉（不还焦点），再走与桌面端完全相同的导航路径。 */
const handleCardNavigate = (item) => {
  closeMenu(false);
  handleNavigate(item);
};

/** 抽屉里的退出：与顶部退出按钮同一套逻辑。 */
const logoutFromMenu = () => {
  closeMenu(false);
  logout();
};

/*
 * 路由变化时自动收起抽屉。
 * 用户可能通过浏览器后退、ptr 转场或程序化跳转离开，这些都不经过 handleCardNavigate，
 * 若抽屉还开着会盖在新页面上。
 */
watch(
  () => route.path,
  () => {
    closeMenu(false);
  }
);

/*
 * 抽屉打开时锁滚动 + 响应 Escape。
 *
 * 【为什么要锁滚动】抽屉是全屏遮罩，背后内容若还能滚动，触摸滑动会穿透到
 * 下层页面，观感很差（iOS 上尤其明显）。
 *
 * 【为什么用 null 哨兵而不是空字符串】
 *   src/assets/main.css 已经把 html/body 设成 overflow:hidden，所以
 *   document.body.style.overflow（内联样式）初值本来就是空字符串。
 *   若无条件写回空串，会在 <body> 上留下内联空声明；
 *   更严重的是：一旦原值被存成 'hidden'（重复触发打开流程），关闭时
 *   就把 'hidden' 当原值写回去，滚动锁会永久粘死。
 *   改成：只有确实锁过（savedOverflow !== null）才还原，还原后立刻置回 null。
 */
let savedOverflow = null;

/*
 * Esc 关闭抽屉。
 * 【为什么要看 defaultPrevented】画报页（Pictorial.vue）在 document 捕获阶段
 * 也会处理 Esc 并 preventDefault，两处独立处理会在一次按键里同时关掉浮层和抽屉。
 */
function onKeydown(e) {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape' && menuOpen.value) {
    e.preventDefault();
    closeMenu();
  }
}

const lockScroll = () => {
  if (savedOverflow !== null) return;          // 已锁过，幂等
  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onKeydown);
};

const unlockScroll = () => {
  if (savedOverflow === null) return;          // 本来就没锁
  document.body.style.overflow = savedOverflow;
  savedOverflow = null;
  window.removeEventListener('keydown', onKeydown);
};

watch(menuOpen, async (open) => {
  if (open) {
    lockScroll();
    // 打开后把焦点移进抽屉，兑现 aria-modal="true" 的承诺。
    // 等一帧：v-if 刚创建节点，此时才能聚焦。
    await nextTick();
    if (drawerRef.value) drawerRef.value.focus();
  } else {
    unlockScroll();
  }
});

// 组件卸载时（退出到登录页、或整个 NavBar 被 v-if 摘掉）必须还原，
// 否则 body 会一直保持 overflow:hidden。unlockScroll 幂等，未锁过时什么也不写。
onUnmounted(() => {
  unlockScroll();
  window.removeEventListener('keydown', markKeyboard, true);
  window.removeEventListener('pointerdown', markPointer, true);
});
</script>

<style scoped>
/*
 * 【滚动收起：为什么用 translateY 而不是 top】（规格 docs/nav-scroll-and-popover-spec.md 第一节）
 *   · top 会触发 layout（每帧重排 + 重绘整条导航），transform 只走合成层；
 *   · 收起幅度必须【大于整条导航的底边】才能完全移出视口：
 *       桌面端 顶距 20 + 高 60 = 底边 80  →  99px 足够且留 19px 余量（与参考站同值）
 *       移动端断点 顶距 20 + 高 54 = 底边 74 →  用 -94px（留 20px 余量）
 *   · 基准位移 translateX(-50%) 必须和收起位移写进【同一条 transform】，
 *     否则后在声明会把前者覆盖，导航栏会瞬间掉到视口左侧。
 */
.glass-nav {
  position: fixed; top: 20px; left: 50%;
  --nav-hide-y: -99px;
  transform: translateX(-50%) translateY(0);
  /* 实测规格：transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) */
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  /* 提示浏览器把导航栏提升为独立合成层：滚动时只做变换，不参与页面重绘。
     只写 will-change，不写 contain / transform-style，避免改动既有层叠上下文。 */
  will-change: transform;
  width: 90%; max-width: 1200px; height: 60px;
  background: rgba(15, 15, 25, 0.6);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 30px;
  display: flex; justify-content: space-between; align-items: center;
  padding: 0 24px; z-index: 99999;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 10px rgba(74, 158, 255, 0.2);
}
/* 收起态：只换 transform 里的第二段，居中位移保持不变。 */
.glass-nav.is-hidden {
  transform: translateX(-50%) translateY(var(--nav-hide-y));
}
.nav-left { display: flex; align-items: center; gap: 24px; }
.logo {
  font-weight: bold; font-size: 18px; letter-spacing: 1px;
  background: linear-gradient(90deg, #4a9eff, #a855f7);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.nav-items { position: relative; display: flex; gap: 8px; }
.nav-link {
  position: relative; z-index: 2;
  color: #a0a0a0; text-decoration: none; font-size: 15px;
  padding: 8px 16px; border-radius: 20px;
  transition: color 0.18s ease, text-shadow 0.18s ease;
  cursor: pointer;
}
.nav-link.active { color: #fff; text-shadow: 0 0 10px rgba(255, 255, 255, 0.5); }
.active-pill {
  position: absolute; top: 0; left: 0; height: 100%;
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 20px;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), width 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 1; pointer-events: none;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.nav-right { display: flex; align-items: center; }
.logout-btn {
  color: #fff; text-decoration: none; font-size: 14px; padding: 8px 16px; border-radius: 20px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  display: flex; align-items: center; gap: 6px; transition: all 0.3s;
}
.logout-btn:hover { background: rgba(255, 70, 70, 0.2); border-color: rgba(255, 70, 70, 0.5); }

/*
 * 【修复】窄屏适配。
 *
 * 原样式没有任何 @media 断点，实测 375px 视口下：
 *   .glass-nav 实测宽 388px —— 比视口还宽。原因是全局没有 box-sizing: border-box，
 *   而 .glass-nav 是 width: 90% + padding: 0 24px + 1px 边框，
 *   内容盒 337.5px + 内边距 48px + 边框 2px = 388px，横向溢出视口 13px。
 *   内部可用宽度只剩 337px，装不下 logo + 4 个导航项 + 退出按钮，
 *   于是中文被逐字折行：logo「✦ 美琴子 ✦」被压成 34x120（4 行），
 *   导航项被压成 47x76（2~3 行），整个导航条文字变成竖排。
 *
 * 桌面端（>=768px）实测 logo 100x24、导航项高 36px，一切正常，
 * 所以断点取在 768px 以下，桌面样式一个像素都不动。
 *
 * box-sizing: border-box 只写在断点内 —— 写进 .glass-nav 基础规则会让
 * 桌面端宽度从 1202px 变成 1152px（少掉内边距的 50px），那是可见的改动。
 */
@media (max-width: 767px) {
  .glass-nav {
    box-sizing: border-box;
    width: 94%; height: 54px; padding: 0 12px; border-radius: 27px;
    /* 【安全区】刘海屏 / 圆角屏横屏时导航别贴着物理边缘。
       桌面端（>=768px）与竖屏手机（env 全为 0）位置完全不变。
       注意 left 仍然保持 50%：居中靠的是 transform: translateX(-50%)，
       换成 calc 会与收起态那条 transform 规则打架，故只补 top。 */
    top: calc(20px + env(safe-area-inset-top, 0px));
    /* 移动端导航更矮（54px），收起幅度同步收小但仍大于底边 20+54=74px。
       只覆盖变量，不用重写整条 transform —— 收起态的规则自动跟着变。 */
    --nav-hide-y: -94px;
  }
  .nav-left { gap: 10px; min-width: 0; }
  .logo { font-size: 13px; letter-spacing: 0; white-space: nowrap; }
  .nav-items { gap: 3px; flex-shrink: 0; }
  .nav-link { font-size: 12px; padding: 6px 8px; white-space: nowrap; }
  .nav-right { flex-shrink: 0; }
  .logout-btn { font-size: 12px; padding: 6px 8px; gap: 4px; white-space: nowrap; }
}

/* ---------------------------------------------------------------
   触控目标 >= 44px（docs/mobile-spec.md 验收第 2 条）

   【为什么用「隐形扩展区」而不是把导航撑高】
   实测基线（320/375/390/414）：.nav-link 只有 28px 高、.logout-btn 只有 30px，
   都低于 44px 的可触控下限。但导航条本身只有 54px 高，把链接直接撑到 44px
   会连带把整条导航变高、把文字挤成近方形色块 —— 那是可见的视觉变化。

   这里的做法：链接自身的盒子一点不动（文字位置、胶囊尺寸、导航高度全部不变），
   只用一个居中的 ::after 把【可点击区域】沿垂直方向向上下各扩到 44px。
   · 伪元素是链接的子节点，点击仍然落在 <a> 上，键盘/读屏行为完全不变；
   · 扩展区左右各内缩 2px，相邻链接之间留出互不重叠的间隙；
   · 44px 与浏览器 62px(54+上下各 4px 外边距) 的触控去重半径一致，
     不会和页面里其它元素抢同一片触摸区。

   【只作用于移动端】下面整块都包在 @media (max-width: 767px) 里，
   桌面端（>=1024px）与平板宽度不受任何影响。
   --------------------------------------------------------------- */
@media (max-width: 767px) {
  .nav-link,
  .logout-btn {
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  /* .logout-btn 需要 position: relative 才能给伪元素定位；
     桌面端它是 flex 容器、位置由 .nav-right 决定，这里加定位不会移动它 */
  .logout-btn { position: relative; }
  .nav-link::after,
  .logout-btn::after {
    content: '';
    position: absolute;
    /* 链接已左右各留 3~4px 间距，扩展区再各内缩 2px，相邻链接不重叠 */
    left: 2px; right: 2px;
    top: 50%;
    height: 44px;
    transform: translateY(-50%);
  }
}

/* ---------------------------------------------------------------
   prefers-reduced-motion 的兜底说明

   全局 main.css 在 reduce 下把 * 的 transition-duration 压到 0.01ms !important，
   本组件的 transition: transform 同样被压掉。

   【这不是「卡住」】收起/展开的状态只由 JS 切 .is-hidden 决定，CSS 只负责过渡过程；
   过渡被压到 0.01ms 之后，状态切换依然立刻生效 —— 即「瞬间收起 / 瞬间展开」，
   正是减少动态效果想要的结果。请勿在这里用 !important 把时长抢回来：
   那会让系统开了「减少动态效果」的用户仍然看到滑动动画。

   【为什么不补 animation: none !important】这里只有 transition、没有 keyframes，
   全局规则里的 animation-* 压不到任何东西，多写一条是无意义的重复定义。
   --------------------------------------------------------------- */

/* 400px 以下再收紧一档，保证四个导航项 + 退出按钮仍能在一行内放下。
   注意：这一档只收内边距，不改任何触控区尺寸（上面 ::after 的 44px 照旧生效）。 */
@media (max-width: 400px) {
  .glass-nav { width: 96%; padding: 0 8px; }
  .nav-left { gap: 6px; }
  .logo { font-size: 12px; }
  .nav-items { gap: 2px; }
  .nav-link { font-size: 12px; padding: 6px 6px; }
  .logout-btn { padding: 6px 6px; }
}

/* ==========================================================================
   手机端抽屉样式（仅在 <=767px 生效）

   【桌面端隔离】.nav-burger 与 .nav-drawer 的【基础规则】都是 display:none，
   所以桌面端这两个元素根本不参与布局，宽度为 0，不占位、不可见、不可聚焦。
   所有视觉样式都写在下面的 @media (max-width: 767px) 里。
   ========================================================================== */
.nav-burger { display: none; }
.nav-drawer { display: none; }

@media (max-width: 767px) {
  /* 汉堡按钮：40x40 玻璃圆钮。
     ::after 把可点区域撑到 44x44 —— 复用项目里 .nav-link 已有的同款做法，
     这样视觉尺寸不变（与参考站的 40x40 一致），但满足 44px 触控标准。 */
  .nav-burger {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.2s ease, border-color 0.2s ease;
  }
  .nav-burger::after {
    content: '';
    position: absolute;
    inset: -2px;   /* 40 + 2*2 = 44px 触控面积 */
  }
  .nav-burger:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.22);
  }
  .nav-burger:focus-visible {
    outline: 2px solid rgba(139, 108, 232, 0.9);
    outline-offset: 2px;
  }

  /* 抽屉打开时，导航条里的文字链接与退出按钮让位给抽屉里的卡片，
     顶部只保留 logo 与关闭（×）按钮 —— 与参考站的展开形态一致。
     注意：被隐藏的只有 .nav-items 与 .logout-btn，汉堡按钮本身保持可见可聚焦。 */
  .glass-nav.is-menu-open .nav-items,
  .glass-nav.is-menu-open .nav-right .logout-btn { display: none; }

  /* 全屏抽屉遮罩 */
  .nav-drawer {
    position: fixed;
    inset: 0;
    z-index: 99998;          /* 低于 .glass-nav(99999)，保证导航条与关闭按钮浮在上面 */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: calc(96px + env(safe-area-inset-top, 0px)) 20px calc(24px + env(safe-area-inset-bottom, 0px));
    background: rgba(0, 0, 0, 0.55);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    overflow-y: auto;
    animation: navDrawerIn 0.22s ease-out both;
  }
  /* 抽屉自身获焦（tabindex=-1）时不要画焦点圈，视觉上会是个大边框 */
  .nav-drawer:focus { outline: none; }

  @keyframes navDrawerIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* 2x2 卡片网格 */
  .nav-drawer-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    max-width: 420px;
  }

  .nav-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 104px;
    padding: 16px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  }
  .nav-card:active { transform: scale(0.97); }
  .nav-card:focus-visible {
    outline: 2px solid var(--card-color, #8b6ce8);
    outline-offset: 2px;
  }

  /* 当前所在页：用该页自己的主题色描边 + 淡底 */
  .nav-card.is-current {
    border-color: color-mix(in srgb, var(--card-color, #8b6ce8) 50%, transparent);
    background: color-mix(in srgb, var(--card-color, #8b6ce8) 10%, transparent);
  }

  .nav-card-icon {
    display: flex;
    color: var(--card-color, #8b6ce8);
  }
  .nav-card-icon :deep(svg) { width: 24px; height: 24px; }

  .nav-card-name {
    margin-top: auto;      /* 名称与英文一起沉到卡片底部 */
    font-size: 16px;
    font-weight: 600;
    line-height: 1.2;
  }
  .nav-card-en {
    font-size: 9px;
    letter-spacing: 0.22em;
    color: rgba(255, 255, 255, 0.4);
    line-height: 1;
  }

  .nav-drawer-logout {
    width: 100%;
    max-width: 420px;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .nav-drawer-logout:active { background: rgba(255, 255, 255, 0.10); }
  .nav-drawer-logout:focus-visible {
    outline: 2px solid rgba(255, 70, 70, 0.9);
    outline-offset: 2px;
  }
}

/*
 * 减少动效偏好：main.css 有一条全局规则把 animation-duration 压到 0.01ms，
 * 这里给抽屉的入场动画放行成 0.01ms 即可（它只是淡入，没有状态机依赖 animationend），
 * 不需要像 ptr 转场那样保留完整时长 —— 直接让它瞬时出现反而是正确的降级。
 */
@media (prefers-reduced-motion: reduce) {
  .nav-drawer { animation-duration: 0.01ms !important; }
}

</style>