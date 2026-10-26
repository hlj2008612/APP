// ================================================================
//  资源地址拼接
//  ---------------------------------------------------------------
//  ⚠️ APP 改造说明：
//  原始版本的清单是构建脚本生成并入库的静态文件，thumb/full 是
//  "images/thumbnails/1.webp" 这样的【站内相对路径】，由 Vite 的
//  BASE_URL 拼成完整地址。
//
//  现在照片存在后端服务器上，清单由 /api/photos 返回，地址形如
//  "/api/photos/1/thumb"。所以 assetUrl() 需要三条分支：
//    1. 绝对 URL（http/https/data/blob/capacitor）—— 原样返回
//    2. 后端路径（/api/...）—— 拼服务器基地址
//    3. 站内相对路径（images/...）—— 保持原逻辑，走 BASE_URL
//  第 3 条是为了兼容「还没迁移到服务器的老数据」以及未来的本地预览。
//
//  函数的签名和返回值约定没有变，Pictorial.vue / Cinema.vue /
//  renderer.js 的调用处一行都不用改。
// ================================================================

import { apiUrl } from './api.js';
import { IMAGE_POOL } from './config.js';

/**
 * 把清单里的路径拼成可直接用于 img.src 的地址。
 *
 * @param {string} p 清单中的路径。可以是绝对 URL、"/api/..." 或 "images/..."。
 * @param {string} [base] 站内资源前缀，默认 import.meta.env.BASE_URL。
 * @returns {string} 可直接用于 img.src 的地址
 */
export function assetUrl(p, base) {
    const src = String(p == null ? '' : p);
    if (!src) return '';

    // 1. 已经是完整 URL（含 blob:、data:、capacitor:、file:），不要再拼前缀。
    //    Capacitor 的 WebView 用 https://localhost 起页面，
    //    拼错前缀会变成 https://localhost/https://... 这种必然 404 的地址。
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) || /^(blob|data|file):/i.test(src)) {
        return src;
    }

    // 2. 后端 API 路径：交给服务器基地址处理。
    if (src.startsWith('/api/') || src.startsWith('api/')) {
        return apiUrl(src);
    }

    // 3. 站内静态资源：保持原始逻辑。
    //    注意：必须守住 import.meta.env 这个对象本身。裸 Node（脚本、测试、SSR）下
    //    import.meta.env 是 undefined，直接读 .BASE_URL 会抛 TypeError，
    //    后面那个 || '/' 根本来不及兜底。
    const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
    const prefix = (base === undefined ? envBase : base) || '/';
    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return `${trimmed}/${src.replace(/^\.?\//, '')}`;
}

/**
 * @typedef {Object} ImageEntry
 * @property {number} id     1..N 的图片序号
 * @property {string} thumb  卡片用缩略图（最长边 560px）
 * @property {string} full   点开放大用大图（最长边 1600px）
 * @property {number} w      thumb 的真实像素宽
 * @property {number} h      thumb 的真实像素高
 * @property {number} ratio  w / h，渲染层用它算卡片尺寸
 */

/**
 * 按 id 取一条记录（id 从 1 开始）。
 *
 * ⚠️ 与原始版本的差异：原来遍历的是静态 IMAGE_MANIFEST 常量，
 * 现在清单在 config.js 里异步加载。这里直接读共享数组引用 ——
 * config.js 用的是「就地填充」策略，引用始终有效，
 * 未加载完时读到空数组，返回 null，与原始版本「找不到就 null」一致。
 */
export function getImageEntry(id) {
    return IMAGE_POOL.find((e) => e.id === id) || null;
}
