// ================================================================
//  全局配置 - 照片墙基础参数
//
//  ⚠️ 与原始版本的差异（APP 改造）：
//  原始版本的照片清单是打包进前端的静态数组（imageManifest.js），
//  现在照片存在后端服务器上，清单改为运行时从 API 拉取。
//  对外的数据结构【完全不变】，所以 Pictorial / Cinema / renderer
//  三个消费方一行都不需要改。
//
//  IMAGE_POOL 为什么仍然是一个「同步可读的数组」而不是 Promise：
//  渲染引擎在模块加载时就建了定长数组（BASE_W/BASE_H）并做槽位计算，
//  改成全局异步会让整个引擎的时序风险失控。这里的做法是：
//  导出一个【始终同一个引用】的数组，数据到达后就地填充，
//  消费方拿到的引用永远有效，读到空数组只发生在首帧之前。
// ================================================================

import { fetchPhotoManifest } from './api.js';

// ----------------------------------------------------------------
//  世界网格参数
//
//  TOTAL_IMAGES 是【世界网格的循环基数】，决定 300 个槽位里
//  图片索引如何循环复用（renderer.js 的 imageIndexAt）。
//  它不是「当前实际有多少张照片」—— 照片数量变化时，
//  槽位算法依然用它做取模，这样世界坐标的几何是稳定的。
//  实际照片张数由 PHOTO_COUNT 表示。
// ----------------------------------------------------------------
export const TOTAL_IMAGES = 23;
export const WORLD_COLS = 20;     // 横向网格数
export const WORLD_ROWS = 15;     // 纵向网格数
export const STEP = 340;          // 卡片间距
export const WORLD_W = WORLD_COLS * STEP;
export const WORLD_H = WORLD_ROWS * STEP;

export const FRAME_MS = 1000 / 60;  // 60fps 基准帧时长（惯性衰减按真实时间换算）

// 清单字段名是 w / h（见 api.js normalizeEntry 与 ImageEntry 定义）
function isValidEntry(e) {
    return !!e && typeof e === 'object' && e.w > 0 && e.h > 0;
}

/**
 * 校验一份清单是否可用。
 *
 * 与原始版本的差异：原来要求 pool.length >= TOTAL_IMAGES（硬性 23 张），
 * 照片改由服务器提供后，张数是可变的 —— 上传一张新照片不应该让
 * 整个相册退回兜底比例表。所以这里只要求「至少有 1 条合法记录」。
 *
 * 注意：entry 的 w/h 必须是缩略图的真实像素，否则画报页
 * 无法按真实比例排瀑布流（会退回 CSS 的 3/4 兜底）。
 */
export function isUsablePool(pool) {
    if (!Array.isArray(pool) || pool.length === 0) return false;
    return pool.some(isValidEntry);
}

// 【关键】始终导出同一个数组引用。数据到达后 push 进去，不重新赋值。
// 任何提前 import 了 IMAGE_POOL 的模块，拿到的引用都持续有效。
export const IMAGE_POOL = [];

// 当前实际可用的照片张数（清单填充后才有意义）。
export let PHOTO_COUNT = 0;

// 最近一次加载是否成功（false 表示网络失败或服务器没有照片）。
export let IMAGE_MANIFEST_READY = false;

// 最近一次加载失败的原因，供登录页/错误页展示。
export let IMAGE_LOAD_ERROR = '';

let loadPromise = null;

// 上一次加载是不是「因为没登录而失败」。
//
// 【为什么需要这个标记】main.js 在应用挂载前就发起了加载，那时用户
// 还没登录，/api/photos 必然 401。如果把这次失败的结果缓存成
// loadPromise，登录成功后再调 loadImageManifest() 会直接拿回那个失败
// 的 Promise，相册永远是空的 —— 用户会以为「服务器上没有照片」。
// 所以：「未登录」导致的失败不进缓存，登录后自动重来。
let lastFailedBecauseUnauthorized = false;

/**
 * 确保清单已加载（幂等，并发调用共享同一个 Promise）。
 *
 * @param {boolean} [force] 传 true 可强制重新拉取
 * @returns {Promise<Array>} 填充好的 IMAGE_POOL
 */
export function loadImageManifest(force = false) {
    // 之前因为没登录失败过 —— 这次调用很可能发生在登录成功之后，
    // 直接重新请求，不要复用那个失败的 Promise。
    if (lastFailedBecauseUnauthorized) force = true;

    if (loadPromise && !force) return loadPromise;

    if (force) {
        IMAGE_POOL.length = 0;
        PHOTO_COUNT = 0;
        IMAGE_MANIFEST_READY = false;
        IMAGE_LOAD_ERROR = '';
    }

    loadPromise = fetchPhotoManifest()
        .then((list) => {
            lastFailedBecauseUnauthorized = false;
            // 按 id 升序：api.js 已把服务端 seq 映射成 id（1..N）。
            // 原项目是 1..23 顺序，瀑布流和影院页的轮转分配
            // 都假设了这个顺序的稳定性。
            list.sort((a, b) => a.id - b.id);

            // 就地替换内容，保持数组引用不变。
            IMAGE_POOL.length = 0;
            for (const e of list) { IMAGE_POOL.push(e); }

            PHOTO_COUNT = IMAGE_POOL.length;
            IMAGE_MANIFEST_READY = isUsablePool(IMAGE_POOL);
            if (!IMAGE_MANIFEST_READY) {
                IMAGE_LOAD_ERROR = IMAGE_POOL.length === 0
                    ? '服务器上还没有照片'
                    : '照片数据不完整（缺少宽高信息）';
            }

            // 清单到齐后重算照片墙的基准尺寸表。
            //
            // 为什么用动态 import：renderer.js 已经 import 了本模块，
            // 在这里顶层 import renderer 会构成循环依赖，让 renderer 的
            // 导出在初始化阶段变成 undefined。动态 import 在模块图完全
            // 就绪之后才执行，绕开这个坑；而且清单没到之前根本不需要它。
            //
            // 尺寸表用错了的后果很直观：卡片会按 FALLBACK_RATIOS 的近似比例
            // 排布，16:9 的横图被当成 3:4 竖图渲染，照片被拉变形。
            import('./renderer.js')
                .then((m) => { if (m && typeof m.rebuildSizeTable === 'function') m.rebuildSizeTable(); })
                .catch(() => { /* 尺寸表重建失败不影响取图，静默降级 */ });

            return IMAGE_POOL;
        })
        .catch((err) => {
            IMAGE_LOAD_ERROR = err && err.message ? err.message : '照片加载失败';
            // 「没登录」是可恢复状态：清掉缓存的 Promise，等登录后重来。
            // 其它错误（网络断、服务器 500）也清掉 —— 重试一次比永久卡死好。
            lastFailedBecauseUnauthorized = !!(err && (err.unauthorized || err.status === 401));
            loadPromise = null;
            // 不 reject：调用方拿到空池，由渲染层退回内置比例表，
            // 与原始版本「清单缺失时降级」的行为保持一致。
            return IMAGE_POOL;
        });

    return loadPromise;
}

/** 保留原有契约：等待清单就绪。 */
export const whenImagesReady = () => loadImageManifest();
