// ================================================================
//  后端 API 客户端
//  ---------------------------------------------------------------
//  这一层是「照片墙」和「APP 服务器」之间唯一的接缝。
//  设计原则：页面组件不直接碰 fetch，一律经过这里，
//  这样换服务器地址、换鉴权方式都不用改视图代码。
//
//  服务器地址的三种来源，优先级从高到低：
//    1. window.__PW_API_BASE__   —— Capacitor 原生层注入（见 native 配置）
//    2. localStorage 里的用户设置 —— APK 内「服务器设置」页可改
//    3. import.meta.env.VITE_API_BASE —— 构建期注入，Web 版走同源时留空
// ================================================================

const LS_SERVER = 'pw.server';
const LS_TOKEN = 'pw.token';
const SESSION_TOKEN = 'pw.token.session';

/** 判断是否运行在 Capacitor 原生壳里。 */
export function isNative() {
    try {
        return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
            && window.Capacitor.isNativePlatform());
    } catch (e) {
        return false;
    }
}

/**
 * 令牌存储策略：
 *  - Web 版沿用原项目的 sessionStorage（关掉标签页即失效，行为不变）
 *  - APK 里必须持久化，否则系统回收进程后每次都要重登
 * 存储本身可能抛异常（隐私模式 / 禁用 Cookie），所以全部包 try。
 */
const tokenStore = {
    read() {
        try {
            return (isNative() ? localStorage.getItem(LS_TOKEN) : sessionStorage.getItem(SESSION_TOKEN)) || '';
        } catch (e) {
            return '';
        }
    },
    write(token) {
        try {
            if (isNative()) localStorage.setItem(LS_TOKEN, token);
            else sessionStorage.setItem(SESSION_TOKEN, token);
        } catch (e) { /* 存储不可用时退化为仅内存态 */ }
        memoryToken = token || '';
    },
    clear() {
        try {
            localStorage.removeItem(LS_TOKEN);
            sessionStorage.removeItem(SESSION_TOKEN);
        } catch (e) { /* 同上 */ }
        memoryToken = '';
    },
};

// 存储不可用时的兜底：至少本次会话内还能用。
let memoryToken = '';

export function getToken() {
    return memoryToken || tokenStore.read();
}

export function setToken(t) {
    tokenStore.write(t);
}

export function clearToken() {
    tokenStore.clear();
}

/** 服务器基地址（不带结尾斜杠）。空字符串表示与页面同源。 */
export function getApiBase() {
    if (typeof window !== 'undefined' && window.__PW_API_BASE__) {
        return String(window.__PW_API_BASE__).replace(/\/+$/, '');
    }
    try {
        const saved = localStorage.getItem(LS_SERVER);
        if (saved) return String(saved).replace(/\/+$/, '');
    } catch (e) { /* 忽略 */ }
    const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '';
    return String(envBase).replace(/\/+$/, '');
}

export function setApiBase(url) {
    try {
        if (url) localStorage.setItem(LS_SERVER, String(url).replace(/\/+$/, ''));
        else localStorage.removeItem(LS_SERVER);
    } catch (e) { /* 忽略 */ }
}

/** 把 API 里返回的相对地址拼成完整 URL。 */
export function apiUrl(path) {
    const base = getApiBase();
    const p = String(path || '');
    if (/^https?:\/\//i.test(p)) return p;
    return base + '/' + p.replace(/^\/+/, '');
}

/* ================================================================
   APP 专属标记头（「域名只给 APP 用」的判定依据）
   ----------------------------------------------------------------
   公网入口 https://mqz.ccwu.cc 挂在 Cloudflare 上。为了不让任何人
   在浏览器里直接打开这个域名，Cloudflare 边缘有一条 WAF 规则：

     取 http.request.headers["x-photowall-app"][0] ne "1"
     → Block

   也就是说：只有带下面这个头的请求才被放行。

   为什么不能只靠 UA 判断：UA 可以随口伪造成浏览器；
   而浏览器【无法】给跨源 fetch 随便加自定义头 —— 一旦加了，
   浏览器会先发 CORS 预检，而我们的后端不可能给任意浏览器放行。
   所以「带这个头」本身就是 APP 具备、普通网页不具备的能力。

   ⚠️ 这是「提高门槛」，不是密码学认证：知道这个头名的人用 curl
   仍能带。要真正防住需要客户端证书（Cloudflare Access 服务令牌），
   属于后续选项。
   ================================================================ */
export const APP_GATE_HEADERS = Object.freeze({ 'X-PhotoWall-App': '1' });

/**
 * 统一的请求封装。
 * @param {string} path  相对路径，如 '/api/photos'
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.body]   JSON 体
 * @param {FormData} [opts.form] 表单体（上传用）
 * @param {number} [opts.timeout] 超时毫秒，默认 20s
 * @param {boolean} [opts.auth]  是否携带令牌，默认 true
 */
export async function request(path, opts = {}) {
    const { method = 'GET', body, form, timeout = 20000, auth = true, signal } = opts;

    const headers = { ...APP_GATE_HEADERS };
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    if (auth) {
        const t = getToken();
        if (t) headers.Authorization = 'Bearer ' + t;
    }

    // AbortController 做超时；外部传了 signal 就两个一起生效。
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    let res;
    try {
        res = await fetch(apiUrl(path), {
            method,
            headers,
            body: form || (body !== undefined ? JSON.stringify(body) : undefined),
            signal: ctrl.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        // fetch 失败在浏览器里只有笼统的 TypeError，这里给出可行动的提示。
        const isAbort = err && err.name === 'AbortError';
        const e = new Error(isAbort ? '请求超时，请检查网络或服务器地址' : '无法连接服务器，请检查网络或服务器地址');
        e.cause = err;
        e.network = true;
        throw e;
    }
    clearTimeout(timer);

    if (res.status === 401) {
        clearToken();
        const e = new Error('登录已失效，请重新登录');
        e.unauthorized = true;
        throw e;
    }

    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        try { data = await res.json(); } catch (e) { data = null; }
    }

    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || ('服务器错误 ' + res.status);
        const e = new Error(msg);
        e.status = res.status;
        e.data = data;
        throw e;
    }
    return data;
}

// ---------------- 业务接口 ----------------

/** 登录，成功后令牌已写入存储。返回 { username, role, expires_in } */
export async function login(username, password) {
    const data = await request('/api/login', {
        method: 'POST',
        auth: false,
        body: { username, password },
    });
    if (data && data.token) setToken(data.token);
    return data;
}

/** 注销。服务端失败也要清本地令牌，否则会卡在假登录态。 */
export async function logout() {
    try {
        await request('/api/logout', { method: 'POST', timeout: 8000 });
    } catch (e) { /* 忽略 */ }
    clearToken();
}

/**
 * 健康检查（不需要令牌），用于「服务器设置」验证地址是否可达。
 * @param {string} [base] 要检测的地址；不给就用当前生效的
 * @param {number} [timeout] 超时毫秒，默认 5s
 *
 * 【必须有超时】之前这里用裸 fetch，用户填一个不可路由的地址（比如
 * 192.0.2.99 这种保留测试网段）时，请求会一直挂着不返回，界面就永远
 * 停在「正在检测…」，用户以为点了没反应。加 AbortController 兜住。
 */
export async function health(base, timeout = 5000) {
    const url = (base ? String(base).replace(/\/+$/, '') : getApiBase()) + '/api/health';
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
    let res;
    try {
        // 探活也要带 APP 标记头，否则在「域名只给 APP 用」的门禁下会被 Cloudflare 拦掉
        res = await fetch(url, {
            method: 'GET',
            headers: { ...APP_GATE_HEADERS },
            signal: ctrl ? ctrl.signal : undefined,
        });
    } catch (e) {
        // fetch 的原始错误是 "Failed to fetch" 这种英文，直接抛给用户看不懂，
        // 这里统一换成中文，跟 request() 的措辞保持一致。
        const err = new Error(e && e.name === 'AbortError'
            ? '连接超时，请检查地址与网络'
            : '连不上服务器，请检查地址与网络');
        err.network = true;
        err.cause = e;
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error('服务器返回 HTTP ' + res.status);
    return res.json();
}

/**
 * 拉取照片清单。
 * 返回结构与原 imageManifest.js 的 ImageEntry 完全一致：
 *   { id, thumb, full, w, h, ratio }
 * 这样上层（config.js / Pictorial / Cinema / renderer）无需改动结构。
 */
export async function fetchPhotoManifest() {
    const data = await request('/api/photos');
    // 服务端可能返回 { photos: [...] } 或直接数组，两种都兼容。
    const list = Array.isArray(data) ? data : (data && (data.photos || data.items)) || [];
    return list.map(normalizeEntry).filter(Boolean);
}

/**
 * 单条记录归一化。
 *
 * 【id 为什么必须是数字】原项目 ImageEntry 的 id 是 1..N 的序号：
 *   - Pictorial.vue 用它做 :key 和 data-uid；
 *   - config.js / Cinema.vue 用 (a, b) => a.id - b.id 排序。
 * 服务端的 id 是 32 位十六进制哈希，直接 Number() 会得到 NaN，
 * 原本这里写成「非正数就丢弃」，结果会是整张相册空掉。
 * 所以一律用服务端给的 seq（1..N）当 id，哈希只作为 photoKey 保留。
 *
 * 【w / h 为什么必须是缩略图尺寸】画报页的 aspect-ratio 直接用它，
 * 渲染引擎也用它算卡片比例。服务端已按缩略图真实像素返回，
 * 拿不到就留 0，让上层走 3:4 兜底（与 Pictorial.vue 的 CSS 一致）。
 */
function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // id 优先取 seq；老服务端没有 seq 时退回数字型 id。
    const seqRaw = raw.seq != null ? Number(raw.seq) : Number(raw.id);
    if (!Number.isFinite(seqRaw) || seqRaw <= 0) return null;
    const id = Math.floor(seqRaw);

    const thumb = raw.thumb || raw.thumbUrl || raw.thumbnail || '';
    const full = raw.full || raw.fullUrl || raw.url || '';
    if (!thumb && !full) return null;

    let w = Number(raw.w || raw.thumb_w || raw.thumbW || 0);
    let h = Number(raw.h || raw.thumb_h || raw.thumbH || 0);
    // 老服务端把原图尺寸放在 w/h 里（原图长边约 1600，缩略图 560），
    // 靠 ow/oh 能判断出来。比例一致，但为了与 CSS 兜底口径统一，这里不换算。
    if (!(w > 0) || !(h > 0)) {
        w = 0; h = 0;
    }

    const ratio = Number(raw.ratio) > 0 ? Number(raw.ratio) : (w > 0 && h > 0 ? w / h : 0);

    return {
        id,
        photoKey: String(raw.id || ''),   // 服务端哈希，增删改时定位用
        thumb: thumb || full,
        full: full || thumb,
        w: w || 0,
        h: h || 0,
        ratio: ratio || 0,
        title: raw.title != null ? String(raw.title) : '',
    };
}

/** 上传一张照片（author 角色）。成功后应重新拉一次清单。 */
export async function uploadPhoto(file, title) {
    const form = new FormData();
    form.append('file', file, file.name || 'photo.jpg');
    if (title) form.append('title', title);
    return request('/api/photos', { method: 'POST', form, timeout: 60000 });
}

/** 删除一张照片（author 角色）。photoKey 是服务端哈希 id。 */
export async function deletePhoto(photoKey) {
    return request('/api/photos/' + encodeURIComponent(photoKey), { method: 'DELETE' });
}
