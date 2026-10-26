// ================================================================
//  图片地址中转（HTTP 后端专用）
//  ---------------------------------------------------------------
//  【为什么需要这一层】
//  Capacitor 的 WebView 用 https://localhost 起页面（安全上下文），
//  而照片服务器是 http://192.168.x.x:18000（明文 HTTP）。
//
//  真机上把这种地址直接塞给 <img src>，Chromium 会直接 onerror，
//  连网络请求都不会发出 —— 这是 Private Network Access 拦截：
//  安全的公开上下文不允许发起指向「明文私有网络」的子资源请求。
//
//  但同样的地址用 fetch() 取是【成功】的（诊断页实测：
//  fetch→blob 成功 17262 字节 image/webp）。因为 fetch 走的是
//  显式的跨源请求，后端 CORS 已放行，不需要 PNA 预检；
//  而 <img> 由浏览器内核自己发起，不经过 CORS，会被安全策略拦下。
//
//  模拟器能显示、真机不能，是因为模拟器与宿主机同一网段，
//  被判定为「本机私有网络」；手机走不同网段，成为「跨私有网络」，
//  拦截规则更严。
//
//  【做法】
//  凡是 http:// 的图片地址，一律先 fetch 成 Blob，再转成 blob: URL
//  喂给 <img>。blob: 与页面同源，不受 PNA 约束。
//  https:// 的地址（未来的正式部署）照旧直连，不做多余中转。
//
//  【2026-10-24 修正（专家复核）】
//   1. 缓存按「照片」算，不按「URL」算：后端每次拉清单都会给同一个
//      thumb 生成新的 ?exp&sig，旧的 pending/firstSeen 键永远不会再被命中，
//      结果是浏览越多内存越大（无界）。现在键 = 去掉 exp/sig 的地址。
//   2. 淘汰是 FIFO 不是 LRU（老注释写错了），淘汰时必须【通知】消费方
//      把已 revoke 的 blob URL 从它们自己的缓存里删掉，否则 renderer 会
//      记着一个死地址，卡片永久裂图。
//   3. 失败不再只打 console.warn：向订阅者广播，让页面能提示「照片加载失败」，
//      否则 CORS 一挂就是静默全白，和当初的 PNA 缺陷一模一样。
// ================================================================

/** 已转换成功的地址缓存：标准地址(去签名) -> Promise<blob URL> */
const pending = new Map();

/** 插入顺序（Map 本身保序），超过上限从最旧的开始清 —— 这是 FIFO，不是 LRU */
const MAX_CACHE = 400;

/** 被淘汰时收到的回调：参数是「原地址」与「被 revoke 的 blob URL」 */
const evictListeners = new Set();

/** 失败回调：参数是 (原地址, Error)，页面可据此显示提示 */
const errorListeners = new Set();

/**
 * 把带签名的地址归一成缓存键。
 * 只用于做 key，不参与请求：真实的请求地址永远用传入的原地址
 * （签名有 15 分钟时效，过期后需要拿新清单）。
 */
function cacheKey(url) {
    const s = String(url || '');
    const q = s.indexOf('?');
    if (q < 0) return s;
    const base = s.slice(0, q);
    const qs = s.slice(q + 1);
    // 只处理「签名参数」，其它查询参数（如果有）保留，避免不同资源撞键
    const rest = qs.split('&').filter((kv) => kv && !/^(exp|sig)=/.test(kv));
    return rest.length ? base + '?' + rest.join('&') : base;
}

/** 判断某个图片地址是否必须走中转 */
export function needsBridge(url) {
    const s = String(url || '');
    // 只中转明文 HTTP。https 直连，blob/data 本来就是本地资源。
    if (!/^http:\/\//i.test(s)) return false;
    // 页面自己也是 http 时不存在混合内容问题，不必绕
    if (typeof location !== 'undefined' && location.protocol === 'http:') return false;
    return true;
}

/**
 * https 图片是否也要走 fetch 中转。
 *
 * 【为什么需要】「域名只给 APP 用」的门禁挂在 Cloudflare 上，靠请求头
 * X-PhotoWall-App 判定；而 <img src> 带不了自定义头，会被拦掉。
 * 所以当页面是 https（即 APP 的 WebView）且后端也是 https 时，
 * 图片同样要经 fetch 转成 blob 再喂给 <img>。
 *
 * 本机调试（页面 http）不受影响：那时 needsBridge 已经返回 false，
 * 这里也不会启用，保持原来「直连」的行为。
 */
export function mustBridgeHttps() {
    return typeof location !== 'undefined' && location.protocol === 'https:';
}

/**
 * 统一判定：这个地址要不要走中转。
 *  - http 图片 + https 页面 → 必须（PNA / 混合内容）
 *  - https 图片 + https 页面 → 必须（APP 门禁头）
 *  - 页面本身是 http → 不中转（本地联调，无门禁）
 */
export function shouldBridge(url) {
    const s = String(url || '');
    if (!/^https?:\/\//i.test(s)) return false;
    if (typeof location === 'undefined') return false;
    if (location.protocol !== 'https:') return false;
    return true;
}

/** 订阅「某张图被淘汰」，返回取消订阅函数。 */
export function onEvict(fn) {
    if (typeof fn !== 'function') return () => {};
    evictListeners.add(fn);
    return () => evictListeners.delete(fn);
}

/** 订阅「中转失败」，返回取消订阅函数。 */
export function onBridgeError(fn) {
    if (typeof fn !== 'function') return () => {};
    errorListeners.add(fn);
    return () => errorListeners.delete(fn);
}

function notifyError(src, err) {
    for (const fn of errorListeners) {
        try { fn(src, err); } catch (e) { /* 订阅者自己的异常不能影响中转 */ }
    }
}

/**
 * 把 http 图片地址转成可安全显示的地址。
 * 无需中转的地址原样返回（同步）。需要中转时返回 Promise<string>。
 *
 * 失败时 resolve 成空字符串，调用方据此显示占位，而不是无限等待；
 * 同时会广播一次 error 事件。
 */
export function bridgeUrl(url) {
    const src = String(url || '');
    if (!src) return Promise.resolve('');
    if (!shouldBridge(src)) return Promise.resolve(src);

    const key = cacheKey(src);
    const hit = pending.get(key);
    if (hit) return hit;

    // 带 APP 标记头（见 api.js 的 APP_GATE_HEADERS 说明）。
    // 图片是 <img src> 加载的、带不了头，所以这里必须走 fetch 中转；
    // 而带上这个头之后，Cloudflare 的「只给 APP 用」门禁才会放行。
    const task = fetch(src, {
        mode: 'cors',
        credentials: 'omit',
        headers: { 'X-PhotoWall-App': '1' },
    })
        .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.blob();
        })
        .then((blob) => {
            const objUrl = URL.createObjectURL(blob);
            // FIFO 淘汰：先把最早插入的一条踢掉并 revoke，再通知消费方删除引用
            if (pending.size >= MAX_CACHE) {
                const oldestKey = pending.keys().next().value;
                const oldestTask = pending.get(oldestKey);
                pending.delete(oldestKey);
                if (oldestTask) {
                    oldestTask.then((oldUrl) => {
                        if (!oldUrl) return;
                        URL.revokeObjectURL(oldUrl);
                        for (const fn of evictListeners) {
                            try { fn(oldestKey, oldUrl); } catch (e) { /* 同上 */ }
                        }
                    }).catch(() => { /* 被淘汰的那条本来就失败了，无事可做 */ });
                }
            }
            return objUrl;
        })
        .catch((err) => {
            // 失败不要缓存，否则用户切个网络回来还是坏图
            pending.delete(key);
            notifyError(src, err);
            if (typeof console !== 'undefined') {
                console.warn('[imgBridge] 中转失败', src, err && err.message);
            }
            return '';
        });

    pending.set(key, task);
    return task;
}

/** 释放所有 blob URL（页面隐藏时统一回收） */
export function releaseAll() {
    for (const task of pending.values()) {
        task.then((u) => { if (u) URL.revokeObjectURL(u); }).catch(() => { /* 忽略 */ });
    }
    pending.clear();
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', releaseAll);
}
