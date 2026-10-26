// ================================================================
//  图片清单 - 由 scripts/optimize-images.mjs 自动生成，请勿手改
//  重新生成: node scripts/optimize-images.mjs
// ================================================================

/**
 * 把清单里的相对路径拼成实际请求地址。
 * thumb / full 都是 images/... 形式（没有硬编码的前导斜杠），
 * 所以部署到子路径时，前缀由 Vite 的 BASE_URL 提供。
 *
 * @param {string} p 清单中的相对路径，例如 "images/thumbnails/1.webp"
 * @param {string} [base] 资源前缀，默认 import.meta.env.BASE_URL
 * @returns {string} 可直接用于 img.src 的地址
 */
export function assetUrl(p, base) {
    // 注意：必须守住 import.meta.env 这个对象本身。裸 Node（脚本、测试、SSR）下
    // import.meta.env 是 undefined，直接读 .BASE_URL 会抛 TypeError，
    // 后面那个 || '/' 根本来不及兜底。
    const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
    const prefix = (base === undefined ? envBase : base) || '/';
    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    return `${trimmed}/${String(p).replace(/^\.?\//, '')}`;
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

/** @type {ImageEntry[]} */
export const IMAGE_POOL = [
    { id:  1, thumb: 'images/thumbnails/1.webp', full: 'images/full/1.webp', w: 374, h: 560, ratio: 0.667857 },
    { id:  2, thumb: 'images/thumbnails/2.webp', full: 'images/full/2.webp', w: 315, h: 560, ratio: 0.5625 },
    { id:  3, thumb: 'images/thumbnails/3.webp', full: 'images/full/3.webp', w: 315, h: 560, ratio: 0.5625 },
    { id:  4, thumb: 'images/thumbnails/4.webp', full: 'images/full/4.webp', w: 457, h: 560, ratio: 0.816071 },
    { id:  5, thumb: 'images/thumbnails/5.webp', full: 'images/full/5.webp', w: 420, h: 560, ratio: 0.75 },
    { id:  6, thumb: 'images/thumbnails/6.webp', full: 'images/full/6.webp', w: 315, h: 560, ratio: 0.5625 },
    { id:  7, thumb: 'images/thumbnails/7.webp', full: 'images/full/7.webp', w: 560, h: 316, ratio: 1.772152 },
    { id:  8, thumb: 'images/thumbnails/8.webp', full: 'images/full/8.webp', w: 315, h: 560, ratio: 0.5625 },
    { id:  9, thumb: 'images/thumbnails/9.webp', full: 'images/full/9.webp', w: 315, h: 560, ratio: 0.5625 },
    { id: 10, thumb: 'images/thumbnails/10.webp', full: 'images/full/10.webp', w: 315, h: 560, ratio: 0.5625 },
    { id: 11, thumb: 'images/thumbnails/11.webp', full: 'images/full/11.webp', w: 560, h: 316, ratio: 1.772152 },
    { id: 12, thumb: 'images/thumbnails/12.webp', full: 'images/full/12.webp', w: 560, h: 316, ratio: 1.772152 },
    { id: 13, thumb: 'images/thumbnails/13.webp', full: 'images/full/13.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 14, thumb: 'images/thumbnails/14.webp', full: 'images/full/14.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 15, thumb: 'images/thumbnails/15.webp', full: 'images/full/15.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 16, thumb: 'images/thumbnails/16.webp', full: 'images/full/16.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 17, thumb: 'images/thumbnails/17.webp', full: 'images/full/17.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 18, thumb: 'images/thumbnails/18.webp', full: 'images/full/18.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 19, thumb: 'images/thumbnails/19.webp', full: 'images/full/19.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 20, thumb: 'images/thumbnails/20.webp', full: 'images/full/20.webp', w: 420, h: 560, ratio: 0.75 },
    { id: 21, thumb: 'images/thumbnails/21.webp', full: 'images/full/21.webp', w: 379, h: 560, ratio: 0.676786 },
    { id: 22, thumb: 'images/thumbnails/22.webp', full: 'images/full/22.webp', w: 442, h: 560, ratio: 0.789286 },
    { id: 23, thumb: 'images/thumbnails/23.webp', full: 'images/full/23.webp', w: 420, h: 560, ratio: 0.75 },
];

/** 别名：IMAGE_MANIFEST 是同一份数据的历史名字。 */
export const IMAGE_MANIFEST = IMAGE_POOL;

/** 按 id 快速取一条记录（id 从 1 开始）。 */
export function getImageEntry(id) {
    return IMAGE_MANIFEST.find((e) => e.id === id) || null;
}
