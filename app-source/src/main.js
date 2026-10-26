import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import './assets/main.css';
import { loadImageManifest } from './core/config.js';

// 照片清单改为从后端拉取后，必须显式触发一次加载。
//
// 为什么在挂载【之前】发起、但不等它完成：
//   - 不等：登录页不需要照片，等它只会拖慢首屏；网络不通时更会白屏。
//   - 但要早发起：登录成功后进首页时，清单大概率已经就绪，
//     画报页/影院页不会出现「先空一帧再出现」的跳动。
// 各页面通过 config.js 的 whenImagesReady() 自行等待，互不阻塞。
loadImageManifest();

createApp(App).use(router).mount('#app');
