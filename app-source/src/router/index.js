import { createRouter, createWebHashHistory } from 'vue-router';
import Login from '../views/Login.vue';
import Home from '../views/Home.vue';
import PhotoWall from '../views/PhotoWall.vue';
import Cinema from '../views/Cinema.vue';
import Pictorial from '../views/Pictorial.vue';

const routes = [
  // 登录页：独立页面，不显示导航栏
  { path: '/login', name: 'Login', component: Login, meta: { hideNav: true } },
  
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

// 登录态判定：沿用原来的 sessionStorage 方案（凭证规则完全不变）。
// 这里只做健壮性加固：sessionStorage 在隐私模式 / 禁用 Cookie 时会直接抛异常，
// 旧写法会让整个导航守卫挂掉、页面白屏。
function isLoggedIn() {
  try {
    return sessionStorage.getItem('photoWallLoggedIn') === 'true';
  } catch (e) {
    return false;
  }
}

router.beforeEach((to) => {
  // 返回式写法（vue-router 4 官方推荐）：避免同一个导航里 next() 被调用多次。
  if (to.meta.requiresAuth && !isLoggedIn()) return '/login';
  if (to.path === '/login' && isLoggedIn()) return '/';
  return true;
});

export default router;