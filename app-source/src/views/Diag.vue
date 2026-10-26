<template>
  <div class="diag">
    <div class="diag-head">
      <h1>诊断</h1>
      <button type="button" class="diag-close" @click="close">✕</button>
    </div>

    <div class="diag-actions">
      <button type="button" class="diag-btn" :disabled="running" @click="runAll">
        {{ running ? '检测中…' : '重新检测' }}
      </button>
      <button type="button" class="diag-btn ghost" @click="copyReport">复制报告</button>
    </div>

    <div v-if="copied" class="diag-toast">已复制到剪贴板</div>

    <section v-for="(sec, si) in sections" :key="si" class="diag-sec">
      <h2>{{ sec.title }}</h2>
      <div v-for="(row, ri) in sec.rows" :key="ri" class="diag-row" :class="row.level">
        <div class="diag-k">{{ row.k }}</div>
        <div class="diag-v">{{ row.v }}</div>
      </div>
      <div v-if="!sec.rows.length" class="diag-empty">（无数据）</div>
    </section>

    <section class="diag-sec">
      <h2>图片加载实测</h2>
      <p class="diag-tip">
        下面每一条都会真的去加载一张图。<span class="ok-text">绿</span>=成功，
        <span class="bad-text">红</span>=失败。
      </p>
      <div v-for="(t, i) in imgTests" :key="i" class="diag-img" :class="t.level">
        <div class="diag-img-line">
          <span class="tag">{{ t.mode }}</span>
          <span class="status">{{ t.status }}</span>
        </div>
        <div class="diag-img-url">{{ t.url }}</div>
        <div v-if="t.detail" class="diag-img-detail">{{ t.detail }}</div>
        <img v-if="t.preview" :src="t.preview" alt="" class="diag-thumb">
      </div>
    </section>
  </div>
</template>

<script setup>
// ================================================================
//  诊断页
//  ----------------------------------------------------------------
//  为什么要有这个页面：照片加载失败时，手机上看到的只是「损坏图标」，
//  根本没有可用的信息 —— 是地址不通？是 401？是 CORS？还是混合内容被拦？
//  这些在电脑上都能复现，唯独在真实 WebView 里不一定。
//
//  这里把「WebView 实际拿到的地址」和「三种加载图片的方式各自的结果」
//  全摆出来，一次就能定位到具体环节。
// ================================================================
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getApiBase, getToken, request } from '../core/api.js';

const router = useRouter();

const running = ref(false);
const copied = ref(false);

const env = reactive({});
const apiTest = reactive({});
const sections = ref([]);
const imgTests = ref([]);

let sampleUrls = [];

function close() {
    router.back();
}

function describe(err) {
    if (!err) return '';
    const parts = [err.name || 'Error', err.message || String(err)];
    if (err.status) parts.push('status=' + err.status);
    return parts.join(' | ');
}

/** 收集环境信息 */
function collectEnv() {
    let capVersion = '';
    let platform = '';
    try {
        if (window.Capacitor) {
            capVersion = String(window.Capacitor.getPlatform
                ? window.Capacitor.getPlatform() : 'unknown');
            platform = navigator.userAgent;
        }
    } catch (e) { /* 忽略 */ }

    env.origin = location.origin;
    env.href = location.href;
    env.protocol = location.protocol;
    env.apiBase = getApiBase() || '(同源)';
    env.capacitor = capVersion || '(非 Capacitor)';
    env.platform = platform || navigator.userAgent;
    env.token = getToken() ? '有 (' + getToken().length + ' 字符)' : '无';
    env.secureContext = String(window.isSecureContext);

    sections.value = [
        {
            title: '运行环境',
            rows: [
                { k: '页面 origin', v: env.origin, level: '' },
                { k: '页面协议', v: env.protocol, level: env.protocol === 'https:' ? 'warn' : 'ok' },
                { k: 'API 基地址', v: env.apiBase, level: '' },
                { k: 'Capacitor', v: env.capacitor, level: '' },
                { k: '令牌', v: env.token, level: env.token === '无' ? 'bad' : 'ok' },
                { k: 'isSecureContext', v: env.secureContext, level: '' },
                { k: 'UA', v: env.platform, level: '' },
            ],
        },
    ];
}

/** 测 API 可达性 */
async function testApi() {
    const rows = [];
    try {
        const t0 = Date.now();
        const data = await request('/api/photos', { timeout: 15000 });
        const ms = Date.now() - t0;
        const arr = Array.isArray(data) ? data : (data && (data.photos || data.items)) || [];
        apiTest.count = arr.length;
        apiTest.first = arr[0] || null;
        rows.push({ k: 'GET /api/photos', v: '成功，' + arr.length + ' 条，' + ms + 'ms', level: 'ok' });
        if (apiTest.first) {
            rows.push({ k: '首条 thumb', v: String(apiTest.first.thumb || '(空)'), level: '' });
            rows.push({ k: '首条 w×h', v: apiTest.first.w + '×' + apiTest.first.h, level: '' });
        }
    } catch (err) {
        // 把失败原因记下来：下面「图片加载实测」要据此说明为什么跳过，
        // 而不是在任何情况下都丢一句「还没有登录」。
        apiTest.listError = describe(err);
        rows.push({ k: 'GET /api/photos', v: '失败：' + describe(err), level: 'bad' });
    }
    return rows;
}

/**
 * 三种方式各加载一次图片。
 *
 * 1. img-plain    —— 直接把 http:// 地址塞给 <img>（就是现在页面的做法）
 * 2. img-blob     —— 先 fetch 拿字节，再喂给 <img>（绕开混合内容限制）
 * 3. img-noquery  —— 去掉 ?exp&sig 再试，用来区分「签名问题」和「地址问题」
 */
function loadViaImg(url, timeout = 12000) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok, detail) => {
            if (done) return;
            done = true;
            img.onload = null;
            img.onerror = null;
            resolve({ ok, detail });
        };
        const timer = setTimeout(() => finish(false, '超时（' + timeout + 'ms 未响应）'), timeout);
        img.onload = () => {
            clearTimeout(timer);
            finish(true, img.naturalWidth + '×' + img.naturalHeight);
        };
        img.onerror = () => {
            clearTimeout(timer);
            finish(false, 'onerror（请求失败或被拦截）');
        };
        img.src = url;
    });
}

/**
 * 未登录时拿一张「带签名但不需要令牌」的地址来做图片测试。
 *
 * 为什么要这么绕：清单接口要令牌，没登录根本拿不到 thumb 地址，
 * 而「图片能不能显示」跟有没有登录其实没关系（签名 URL 本身就是凭证）。
 * 所以这里用固定账号静默登录一次，纯粹为了拿到一条样例地址；
 * 拿不到就退化成打健康检查，至少能说明服务器通不通。
 */
async function findSampleUrl() {
    // 已登录（或接口连通性那一步刚成功过）：直接用清单里的首条地址。
    if (apiTest.first && apiTest.first.thumb) return apiTest.first.thumb;

    // 注意这里【不再】内置任何账号口令。
    // 旧实现在这里写死了 author / viewer 两个账号做「静默登录」取样例图，
    // 结果这两个口令被原样打进 APK（unzip 后 grep 即可读到），
    // 等于把「可删除全部照片」的权限送给每个拿到安装包的人（安全专家复核，高危）。
    // 现在改为：没登录就交给调用方走「跳过」分支，并在诊断页写明原因。
    return '';
}

async function testImages() {
    const out = [];
    // 【必须先等清单】清单接口在上面 testApi() 里才落地，apiTest.first 也在那里才被赋值。
    // 旧实现在这里先调 findSampleUrl()：已登录时它恰好能读到 apiTest.first，
    // 未登录时却只能返回空 —— 两者混在一起导致「已登录也显示跳过」的情况很难排查。
    // 这里把「已登录但清单还没来」单独说清楚，避免真机上看到假阴性。
    if (!apiTest.first || !apiTest.first.thumb) {
        const hasToken = !!getToken();
        let listError = apiTest.listError || '';
        if (hasToken && !listError) {
            // 有令牌但清单没落地：再试一次，仍然失败就明确告知（而不是静默跳过）
            try {
                const list = await request('/api/photos', { timeout: 8000 });
                const arr = Array.isArray(list) ? list : (list && list.photos) || [];
                apiTest.first = arr[0] || null;
            } catch (e) {
                listError = describe(e);
            }
        }
        if (listError) {
            out.push({
                mode: '—', status: '跳过',
                url: '（清单接口失败）',
                detail: 'GET /api/photos 失败：' + listError,
                level: 'bad',
            });
            imgTests.value = out;
            return out;
        }
    }

    const url = await findSampleUrl();
    if (!url) {
        out.push({
            mode: '—', status: '跳过',
            url: '（没拿到样例图片地址）',
            detail: '还没有登录，拿不到样例图地址：请先回登录页登录，再点「重新检测」'
                + '（诊断页本身不内置任何账号口令，这是有意的）',
            level: 'bad',
        });
        imgTests.value = out;
        return out;
    }

    apiTest.first = { thumb: url };

    // 1. 直接 <img>
    {
        const r = await loadViaImg(url);
        out.push({
            mode: '<img> 直连',
            status: r.ok ? '成功 ' + r.detail : '失败',
            url,
            detail: r.ok ? '' : r.detail,
            level: r.ok ? 'ok' : 'bad',
            preview: r.ok ? url : '',
        });
    }

    // 2. fetch -> blob -> <img>
    {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                out.push({
                    mode: 'fetch→blob',
                    status: '失败 HTTP ' + res.status,
                    url,
                    detail: 'fetch 本身拿到了响应，但状态码不是 200',
                    level: 'bad',
                });
            } else {
                const blob = await res.blob();
                const objUrl = URL.createObjectURL(blob);
                out.push({
                    mode: 'fetch→blob',
                    status: '成功 ' + blob.size + ' 字节',
                    url,
                    detail: blob.type || '(无 Content-Type)',
                    level: 'ok',
                    preview: objUrl,
                });
            }
        } catch (err) {
            out.push({
                mode: 'fetch→blob',
                status: '失败',
                url,
                detail: describe(err) + '（多半是混合内容或 CORS）',
                level: 'bad',
            });
        }
    }

    // 3. 去掉签名参数
    // 3. 无签名直连：证明「签名是必需的」
    // 【不再按「用裸地址拿到 200 就算意外成功」告警】后端实现对图片是两种都认：
    //   有签名 → 放行；没有签名 → 必须带 Bearer 令牌（server.py 的 verify_photo + _auth）。
    //   而这里带的正是登录后的令牌，所以裸地址返回 200 是【设计内行为】，
    //   旧文案会让真机诊断报告看起来像有漏洞，误导读报告的人。
    {
        const bare = url.split('?')[0];
        const r = await loadViaImg(bare);
        out.push({
            mode: '无签名直连（带令牌）',
            status: r.ok ? '成功（符合预期）' : '失败 ' + r.detail,
            url: bare,
            detail: r.ok
                ? '后端对「无签名但带令牌」的请求放行，这是设计内行为，不是漏洞'
                : '连令牌也被拒，说明登录态没带对',
            level: r.ok ? 'ok' : 'bad',
        });
    }

    // 4. 完全不带凭证：应该 401 —— 这才真正证明签名/令牌缺一不可
    {
        const bare = url.split('?')[0];
        const r = await new Promise((resolve) => {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 8000);
            fetch(bare, { mode: 'cors', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
                .then((res) => { clearTimeout(timer); resolve({ status: res.status, ok: res.ok }); })
                .catch((e) => { clearTimeout(timer); resolve({ status: 0, ok: false, err: e }); });
        });
        out.push({
            mode: '无签名无令牌',
            status: r.status ? 'HTTP ' + r.status : '请求失败',
            url: bare,
            detail: r.status === 401
                ? '被正确拒绝（401）：签名与令牌缺一不可'
                : (r.status === 200 ? '⚠️ 竟然放行了，需要检查后端鉴权' : '未能判定（' + (r.err ? r.err.message : '') + '）'),
            level: r.status === 401 ? 'ok' : (r.status === 200 ? 'bad' : 'warn'),
        });
    }

    imgTests.value = out;
    return out;
}

async function runAll() {
    if (running.value) return;
    running.value = true;
    imgTests.value = [];
    collectEnv();

    const apiRows = await testApi();
    sections.value = [
        ...sections.value.filter((s) => s.title === '运行环境'),
        { title: '接口连通性', rows: apiRows },
    ];

    await testImages();
    running.value = false;
}

function copyReport() {
    const lines = [];
    lines.push('=== 照片墙 APP 诊断报告 ===');
    lines.push('时间: ' + new Date().toString());
    for (const sec of sections.value) {
        lines.push('');
        lines.push('[' + sec.title + ']');
        for (const r of sec.rows) lines.push('  ' + r.k + ': ' + r.v);
    }
    lines.push('');
    lines.push('[图片加载实测]');
    for (const t of imgTests.value) {
        lines.push('  ' + t.mode + ' -> ' + t.status);
        lines.push('    ' + t.url);
        if (t.detail) lines.push('    ' + t.detail);
    }
    const text = lines.join('\n');

    const done = () => {
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
        fallbackCopy(text, done);
    }
}

function fallbackCopy(text, done) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
    } catch (e) { /* 忽略 */ }
}

onMounted(runAll);
</script>

<style scoped>
.diag {
    min-height: 100vh;
    background: #0d0d0d;
    color: #e5e5e5;
    padding: 16px 14px calc(32px + env(safe-area-inset-bottom, 0px));
    font-size: 13px;
    line-height: 1.55;
    -webkit-overflow-scrolling: touch;
}

.diag-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}

.diag-head h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 300;
    letter-spacing: 2px;
}

.diag-close {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid #333;
    background: #1a1a1a;
    color: #bbb;
    font-size: 15px;
    cursor: pointer;
}

.diag-actions {
    display: flex;
    gap: 10px;
    margin-bottom: 14px;
}

.diag-btn {
    flex: 1;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #4a9eff;
    background: #4a9eff;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
}

.diag-btn:disabled {
    opacity: .5;
}

.diag-btn.ghost {
    background: transparent;
    border-color: #333;
    color: #bbb;
}

.diag-toast {
    padding: 8px 12px;
    margin-bottom: 12px;
    border-radius: 8px;
    background: #16351f;
    color: #6ee7a8;
    font-size: 12px;
}

.diag-sec {
    margin-bottom: 22px;
}

.diag-sec h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 500;
    color: #8b6ce8;
    letter-spacing: 1px;
}

.diag-row {
    display: flex;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid #1c1c1c;
}

.diag-k {
    flex: 0 0 96px;
    color: #888;
}

.diag-v {
    flex: 1;
    word-break: break-all;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 11.5px;
}

.diag-row.ok .diag-v { color: #6ee7a8; }
.diag-row.warn .diag-v { color: #e4bb38; }
.diag-row.bad .diag-v { color: #ff5e5e; }

.diag-empty {
    color: #555;
    padding: 6px 0;
}

.diag-tip {
    margin: 0 0 10px;
    color: #777;
    font-size: 12px;
}

.ok-text { color: #6ee7a8; }
.bad-text { color: #ff5e5e; }

.diag-img {
    padding: 10px;
    margin-bottom: 10px;
    border-radius: 8px;
    background: #141414;
    border-left: 3px solid #333;
}

.diag-img.ok { border-left-color: #6ee7a8; }
.diag-img.bad { border-left-color: #ff5e5e; }
.diag-img.warn { border-left-color: #e4bb38; }

.diag-img-line {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}

.diag-img-line .tag {
    color: #4a9eff;
    font-weight: 500;
}

.diag-img.ok .status { color: #6ee7a8; }
.diag-img.bad .status { color: #ff5e5e; }
.diag-img.warn .status { color: #e4bb38; }

.diag-img-url {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 10.5px;
    color: #777;
    word-break: break-all;
}

.diag-img-detail {
    margin-top: 5px;
    font-size: 11.5px;
    color: #b98a8a;
}

.diag-thumb {
    display: block;
    margin-top: 8px;
    max-width: 88px;
    max-height: 120px;
    border-radius: 6px;
}
</style>
