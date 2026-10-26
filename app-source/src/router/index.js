import { createRouter, createWebHashHistory } from 'vue-router';
import Login from '../views/Login.vue';
import Home from '../views/Home.vue';
import PhotoWall from '../views/PhotoWall.vue';
import Cinema from '../views/Cinema.vue';
import Pictorial from '../views/Pictorial.vue';
import Diag from '../views/Diag.vue';

const routes = [
  // 登录页：独立页面，不显示导航栏
  { path: '/login', name: 'Login', component: Login, meta: { hideNav: true } },

  // 诊断页：不要求登录，登录失败时也能进 —— 它本来就是用来查
  // 「为什么连不上 / 为什么照片加载不出来」的，拦住它没有意义。
  { path: '/diag', name: 'Diag', component: Diag, meta: { hideNav: true } },

  // 照片墙：独立页面，不显示导航栏（沉浸式画布）
  { path: '/wall', name: 'PhotoWall', component: PhotoWall, meta: { requiresAuth: true, hideNav: true } },
  
  // 其他页面：正常显示导航栏
  { path: '/', name: 'Home', component: Home, meta: { requiresAuth: true } },
  { path: '/cinema', name: 'Cinema', component: Cinema, meta: { requiresAuth: true } },
  { path: '/pictorial', name: 'Pictorial', component: Pictorial, meta: { requiresAuth: true } }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

// 登录态判定。
//
// ⚠️ 与原始版本的差异：原来只看 sessionStorage 里的一个布尔标记，
// 但那个标记是前端自己写的，伪造一下就进去了 —— 真正起作用的
// 是登录页那次硬编码比对。现在密码校验移到了服务器，本地标记只负责
// 「要不要跳登录页」的体验问题，真正的权限由服务端按令牌把关。
//
// 同时兼容两种来源：
//   - 令牌存在（APP 里存 localStorage，Web 里存 sessionStorage）
//   - 旧标记存在（避免升级后老用户被踢一次）
import { getToken } from '../core/api.js';

function isLoggedIn() {
  try {
    if (getToken()) return true;
    return sessionStorage.getItem('photoWallLoggedIn') === 'true';
  } catch (e) {
    // sessionStorage 在隐私模式 / 禁用 Cookie 时会直接抛异常，
    // 旧写法会让整个导航守卫挂掉、页面白屏。
    return false;
  }
}

router.beforeEach((to) => {
  // 返回式写法（vue-router 4 官方推荐）：避免同一个导航里 next() 被调用多次。
  if (to.meta.requiresAuth && !isLoggedIn()) return '/login';

  // 【2026-10-24 修复：退出登录会被这条守卫自己弹回去】
  // 原写法 `to.path === '/login' && isLoggedIn() → '/'`。
  // 退出时只清了 sessionStorage 的标记，而 isLoggedIn() 是「有 token 就算登录」，
  // token 还在 → 导航到 /login 立刻被弹回 '/'，表现就是【点退出没反应】。
  // 现在 /login 带 logout=1 时无条件放行（退出按钮自己会先清 token）。
  if (to.path === '/login' && isLoggedIn()) {
    if (!(to.query && to.query.logout)) return '/';
  }
  return true;
});

export default router;