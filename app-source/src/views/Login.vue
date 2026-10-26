<template>
  <div class="login-container">
    <div class="login-box">
      <h1>浮光馆</h1>
      <form @submit.prevent="handleLogin">
        <div class="input-group">
          <label for="username">账号</label>
          <input type="text" id="username" v-model="username" placeholder="请输入账号" required autofocus>
        </div>
        <div class="input-group">
          <label for="password">密码</label>
          <input type="password" id="password" v-model="password" placeholder="请输入密码" required>
        </div>
        <button type="submit">登 录</button>
        <div class="error-msg">{{ errorMsg }}</div>
      </form>

      <!-- ============================================================
           APP 改造：服务器地址设置
           ------------------------------------------------------------
           手机可能换 WiFi（家里 / 学校 / 流量），而后端地址
           是构建时写死的，必须允许运行期改，否则换网就废了。
           入口做成小小的齿轮，不打扰原有登录界面的观感；
           展开后的表单也用同一套配色，不引入新的视觉语言。
           ============================================================ -->
      <button type="button" class="server-toggle" @click="toggleServerPanel">
        <span class="server-gear">⚙</span>
        <span>{{ showServer ? '收起服务器设置' : '服务器设置' }}</span>
      </button>

      <div v-if="showServer" class="server-panel">
        <label for="serverUrl">服务器地址</label>
        <input
          id="serverUrl"
          v-model="serverUrl"
          type="url"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="http://192.168.3.26:18000"
        >
        <div class="server-actions">
          <button type="button" class="btn-ghost" @click="resetServer">用默认</button>
          <button type="button" class="btn-save" @click="saveServer">保存</button>
        </div>
        <div class="server-hint">{{ serverHint }}</div>
      </div>

      <!-- 诊断入口：照片加载不出来时，用户没有别的渠道看到真实错误。
           放在这里不打扰原有布局，样式沿用服务器设置那一条。 -->
      <button type="button" class="server-toggle diag-toggle" @click="goDiag">
        <span class="server-gear">?</span>
        <span>运行诊断</span>
      </button>
    </div>
  </div>
</template>

<script setup>
// ⚠️ APP 改造说明：
// 原始版本把账号密码硬编码在前端，任何人都能在打包产物里搜到，
// 等于没有鉴权。现在改为调用后端 /api/login 拿令牌（PBKDF2 校验、只在
// 服务端比对），密码只在传输中出现、不落在前端代码里。
// 2026-10-24 起，诊断页 Diag.vue 里那份「静默登录用」的账号口令也一并删掉了。
//
// 模板与样式【零改动】——「账号或密码错误」的提示、失败后清空密码、
// 登录成功跳首页，这些行为全部保留。
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { login, getApiBase, setApiBase, health } from '../core/api.js';
import { loadImageManifest } from '../core/config.js';

// 登录态标记：沿用原项目的 session key，守卫逻辑不用改。
const LOGIN_FLAG = 'photoWallLoggedIn';

const username = ref('');
const password = ref('');
const errorMsg = ref('');
const submitting = ref(false);
const router = useRouter();

// ---- 服务器地址设置 ----
// 默认值（构建时注入的 VITE_API_BASE）单独存一份，用于「用默认」按钮还原。
const DEFAULT_SERVER = (typeof import.meta !== 'undefined'
  && import.meta.env && import.meta.env.VITE_API_BASE) || '';

const showServer = ref(false);
const serverUrl = ref(getApiBase() || DEFAULT_SERVER);
const serverHint = ref('');
// 用序号防止「慢请求覆盖快操作」：用户点了保存（要等 5 秒超时）之后
// 又立刻点「用默认」，旧请求回来时不能把新提示冲掉。每次产生新提示
// 都 +1，异步回调里比对序号，不是最新的一次就丢弃。
let hintSeq = 0;

const setHint = (text) => {
  hintSeq += 1;
  serverHint.value = text;
  return hintSeq;
};

const toggleServerPanel = () => {
  showServer.value = !showServer.value;
  if (showServer.value) {
    serverUrl.value = getApiBase() || DEFAULT_SERVER;
    setHint('');
  }
};

const saveServer = async () => {
  const url = serverUrl.value.trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    setHint('地址要以 http:// 或 https:// 开头');
    return;
  }
  setApiBase(url);
  const mySeq = setHint('已保存，正在检测…');
  const clean = url.replace(/\/+$/, '');
  try {
    // 存完立刻探一次，避免用户带着错误地址去登录、还以为密码错了
    await health(clean);
    if (mySeq !== hintSeq) return;   // 期间用户又点了别的，别插嘴
    serverHint.value = '连接正常 ✓';
  } catch (e) {
    if (mySeq !== hintSeq) return;
    serverHint.value = '已保存，但' + (e.message || '网络异常');
  }
};

const resetServer = () => {
  setApiBase('');
  serverUrl.value = DEFAULT_SERVER;
  setHint(DEFAULT_SERVER ? '已恢复默认地址' : '已清除自定义地址');
};

// 诊断页不要求登录，连不上服务器时也能进去看具体是哪个环节失败。
const goDiag = () => { router.push('/diag'); };

const handleLogin = async () => {
  if (submitting.value) return;
  errorMsg.value = '';
  submitting.value = true;

  try {
    await login(username.value.trim(), password.value);
    try {
      sessionStorage.setItem(LOGIN_FLAG, 'true');
    } catch (e) {
      // 隐私模式 / 禁用存储时这里会抛异常；原始版本没有包 try 会直接白屏。
    }

    // 拿到令牌后立刻重新拉一次照片清单：
    // main.js 在挂载前发起的那次请求必然会 401（那时还没登录），
    // config.js 对「未登录」的失败不做缓存，这里补上真正的第一次加载。
    loadImageManifest();

    router.push('/');
  } catch (err) {
    // 网络类错误要跟「密码错」区分开，否则用户会以为是密码问题反复尝试。
    errorMsg.value = err && err.network
      ? (err.message || '无法连接服务器')
      : '账号或密码错误';
    password.value = '';
  } finally {
    submitting.value = false;
  }
};
</script>

<style scoped>
.login-container {
  background: #0d0d0d; display: flex; justify-content: center; align-items: center;
  height: 100vh; width: 100vw;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #e0e0e0; overflow: hidden;
}
.login-box {
  background: #1a1a1a; padding: 40px; border-radius: 16px; width: 320px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.6); box-sizing: border-box;
}
h1 { text-align: center; font-weight: 300; margin-bottom: 30px; letter-spacing: 2px; color: #e0e0e0; }
.input-group { margin-bottom: 20px; }
.input-group label { display: block; margin-bottom: 6px; font-size: 14px; opacity: 0.8; }
.input-group input {
  width: 100%; padding: 12px; border: 1px solid #333; border-radius: 8px;
  background: #0d0d0d; color: white; font-size: 16px; outline: none;
  transition: border 0.2s; box-sizing: border-box;
}
.input-group input:focus { border-color: #4a9eff; }
button {
  width: 100%; padding: 12px; background: #4a9eff; border: none; border-radius: 8px;
  color: white; font-size: 16px; cursor: pointer; transition: background 0.2s; margin-top: 10px;
}
button:hover { background: #3a7edf; }
.error-msg { color: #ff5e5e; font-size: 14px; text-align: center; margin-top: 16px; min-height: 20px; }

/* ---- 服务器设置（APP 新增，沿用原登录盒的配色与圆角） ---- */
.server-toggle {
  width: 100%; margin-top: 4px; padding: 8px; background: transparent;
  border: none; color: #8a8a8a; font-size: 13px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: color 0.2s;
}
.server-toggle:hover { background: transparent; color: #b0b0b0; }
.server-gear { font-size: 14px; line-height: 1; }

/* 诊断入口：比服务器设置更次要，字更小、颜色更淡 */
.diag-toggle { margin-top: -2px; font-size: 12px; color: #6a6a6a; }
.diag-toggle .server-gear {
  font-size: 11px; width: 15px; height: 15px; border: 1px solid #4a4a4a;
  border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
}

.server-panel { margin-top: 6px; padding-top: 14px; border-top: 1px solid #2a2a2a; }
.server-panel label { display: block; margin-bottom: 6px; font-size: 13px; opacity: 0.7; }
.server-panel input {
  width: 100%; padding: 10px; border: 1px solid #333; border-radius: 8px;
  background: #0d0d0d; color: white; font-size: 13px; outline: none;
  transition: border 0.2s; box-sizing: border-box;
}
.server-panel input:focus { border-color: #4a9eff; }
.server-actions { display: flex; gap: 8px; margin-top: 10px; }
.server-actions button {
  flex: 1; padding: 9px; border: none; border-radius: 8px; font-size: 13px;
  cursor: pointer; margin-top: 0; transition: background 0.2s;
}
.btn-save { background: #4a9eff; color: #fff; }
.btn-save:hover { background: #3a7edf; }
.btn-ghost { background: #2a2a2a; color: #c0c0c0; }
.btn-ghost:hover { background: #333; }
.server-hint {
  margin-top: 8px; font-size: 12px; color: #8a8a8a;
  text-align: center; min-height: 16px; word-break: break-all;
}
</style>