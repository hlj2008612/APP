// ================================================================
//  全局配置 - 照片墙基础参数
// ================================================================

export const TOTAL_IMAGES = 23;   // 照片总数，必须和 public/images/thumbnails 里的实际张数一致
export const WORLD_COLS = 20;     // 横向网格数
export const WORLD_ROWS = 15;     // 纵向网格数
export const STEP = 340;          // 卡片间距
export const WORLD_W = WORLD_COLS * STEP;
export const WORLD_H = WORLD_ROWS * STEP;

export const FRAME_MS = 1000 / 60;  // 60fps 基准帧时长（惯性衰减按真实时间换算）

// ----------------------------------------------------------------
//  图片清单（src/core/imageManifest.js 由构建脚本生成并入库）
//
//  这里刻意使用【静态】import：
//    1. import() 的字面量说明符会被 Rollup 静态分析，文件缺失时构建直接失败，
//       catch 根本轮不到执行 —— 那种「优雅降级」是假的；
//    2. 动态 import 会切出异步 chunk，IMAGE_POOL 变成"以后才有"，
//       给渲染引擎引入无谓的时序风险。
//  真正的降级放在运行时：下面 validatePool() 校验数据，不可用就退回
//  renderer.js 里的 FALLBACK_RATIOS（真实长宽比），行为与旧实现一致。
// ----------------------------------------------------------------
import { IMAGE_POOL as GENERATED_POOL } from './imageManifest.js';

// 清单字段名是 w / h（见 src/core/imageManifest.js 的 ImageEntry 定义）
function isValidEntry(e) {
    return !!e && typeof e === 'object' && e.w > 0 && e.h > 0;
}

function validatePool(pool) {
    if (!Array.isArray(pool) || pool.length < TOTAL_IMAGES) return false;
    for (let i = 0; i < TOTAL_IMAGES; i++) {
        if (!isValidEntry(pool[i])) return false;
    }
    return true;
}

// 已校验可用的图片清单（无效时为空数组，由渲染层退回内置长宽比表）
export const IMAGE_POOL = validatePool(GENERATED_POOL) ? GENERATED_POOL : [];

export const IMAGE_MANIFEST_READY = IMAGE_POOL.length > 0;

// 保留原有契约：仍然导出 whenImagesReady()，但现在是同步的（立即 resolve）。
export const whenImagesReady = () => Promise.resolve(IMAGE_POOL);