import { state, setCanvas } from './state.js';
import { WORLD_COLS, WORLD_ROWS, TOTAL_IMAGES, STEP, IMAGE_POOL } from './config.js';
import { assetUrl } from './imageManifest.js';
import { mod } from './utils.js';

// ================================================================
//  卡片渲染引擎
//  ----------------------------------------------------------------
//  设计约束（性能）：
//   1. 每帧只做整数/浮点算术，绝不读取布局（无 offsetWidth / getBoundingClientRect）。
//   2. 可见性筛选与「无缝无限滚动」的贴片位置出自【同一次计算】，
//      因此不存在「先判定可见、再放到屏幕外、最后二次剔除」的白工。
//   3. 所有 style 写入都先和「上一次写入的值」比较，没变就不写。
// ================================================================

// 尺寸兜底：imageManifest.js 缺失或数据非法时使用。
// 数值取自 public/images/thumbnails/*.webp 的真实长宽比（1199x1794 等）。
// 生成脚本重压缩略图时只降采样、不改长宽比，所以这份表与清单同源同值。
const FALLBACK_RATIOS = [
    1199 / 1794, 1080 / 1920, 720 / 1280, 3021 / 3700, 3072 / 4096,
    1080 / 1920, 4000 / 2256, 1080 / 1920, 1080 / 1920, 1080 / 1920,
    4000 / 2256, 4000 / 2256, 3472 / 4624, 3472 / 4624, 3472 / 4624,
    3472 / 4624, 3472 / 4624, 3472 / 4624, 3472 / 4624, 3472 / 4624,
];

// 基准尺寸（dynamicScale = 1 时的卡片外框）
export const BASE_W = new Int16Array(TOTAL_IMAGES);
export const BASE_H = new Int16Array(TOTAL_IMAGES);


function buildSizeTable() {
    for (let i = 0; i < TOTAL_IMAGES; i++) {
        let ratio = FALLBACK_RATIOS[i] || 1;

        // 清单字段名是 w / h（不是 width / height），生成脚本定义的。
        // ⚠️ APP 改造：清单现在是异步从后端拉的，模块加载时本函数只跑一次，
        // 那一刻 IMAGE_POOL 大概率还是空的，所以这里只是打底。
        // 真正准确的尺寸由 config.js 在清单到达后调 rebuildSizeTable() 重算。
        const entry = IMAGE_POOL[i];
        if (entry && entry.w > 0 && entry.h > 0) {
            ratio = entry.w / entry.h;
        }

        // 与旧实现逐位一致的拟合公式（180*180 不要写成 180 ** 2）
        // 由 w/h 相除而不是读 entry.ratio：清单里的 ratio 只保留 6 位小数，
        // 用它会让卡片尺寸出现 1px 级别的偏差。
        const baseArea = 180 * 180;
        let w = Math.sqrt(baseArea * ratio);
        let h = Math.sqrt(baseArea / ratio);

        const min = 140; const max = 210;
        if (w > max) { w = max; h = w / ratio; }
        if (h > max) { h = max; w = h * ratio; }
        if (w < min) { w = min; h = w / ratio; }
        if (h < min) { h = min; w = h * ratio; }

        BASE_W[i] = Math.round(w);
        BASE_H[i] = Math.round(h);
    }
}

buildSizeTable();

/**
 * 清单从后端到达后重算基准尺寸表。
 *
 * ⚠️ APP 改造新增：buildSizeTable() 在模块加载时只跑一次，那时后端清单
 * 还没到（fetch 是异步的），所以用的是 FALLBACK_RATIOS 里的近似比例。
 * 真正的比例要和照片一致，否则卡片会被拉变形（尤其是 16:9 横图按 3:4 渲染）。
 *
 * 由 config.js 在 IMAGE_POOL 填充完成后调用。原地改写 BASE_W / BASE_H，
 * 导出引用不变，renderer / PhotoWall 里已经拿到数组的代码自动生效。
 */
export function rebuildSizeTable() {
    buildSizeTable();
}

// ----------------------------------------------------------------
//  图片地址：相对路径必须拼上 import.meta.env.BASE_URL，
//  否则部署在子路径（GitHub Pages 项目站点）时会 404。
// ----------------------------------------------------------------
// import.meta.env 由 Vite 注入；直接跑 Node（测试 / SSR）时不存在，故做防御性取值。
const BASE_URL = (import.meta.env && import.meta.env.BASE_URL) || '/';

// ----------------------------------------------------------------
//  ⚠️ APP 改造：照片已不在包内
//  ----------------------------------------------------------------
//  原实现直接拼 'images/thumbnails/N.webp'，那是构建期随包发布的静态文件。
//  现在清单来自 /api/photos，每条记录自带 thumb / full 两个【后端签名 URL】
//  （形如 http://<host>:18000/api/photos/<id>/thumb?exp=...&sig=...）。
//
//  所以必须先查清单里的真实地址；只有在清单里找不到该序号时，
//  才退回原来的站内相对路径 —— 这样即使后端异常，页面也不会整片崩掉，
//  而且保留了未来「本地预览 / 离线包」的可能性。
//
//  match 用 find 而不是下标取值：IMAGE_POOL 已按 id 升序排好，
//  但删照片后 id 会不连续（例如 1,2,4,7...），下标与 id 不再一一对应，
//  用 IMAGE_POOL[i - 1] 会拿到错位的图。
// ----------------------------------------------------------------
function entryById(i) {
    return IMAGE_POOL.find((e) => e && e.id === i) || null;
}

export function thumbUrl(i) {
    const e = entryById(i);
    const remote = e && (e.thumb || e.full);
    return remote
        ? assetUrl(remote, BASE_URL)
        : assetUrl('images/thumbnails/' + i + '.webp', BASE_URL);
}

export function fullUrl(i) {
    const e = entryById(i);
    const remote = e && (e.full || e.thumb);
    return remote
        ? assetUrl(remote, BASE_URL)
        : assetUrl('images/full/' + i + '.webp', BASE_URL);
}

// 由 (col,row) 反解图片序号（与旧实现完全相同的散列）
export function imageIndexAt(col, row) {
    return ((col * 47 + row * 31) % TOTAL_IMAGES + TOTAL_IMAGES) % TOTAL_IMAGES + 1;
}

// 清单里每张图只有一个缩略图档位，且它已经是能提供的最大尺寸
// （560px 长边），所以【绝不能】再写 srcset 'NNx'：
// 浏览器会为了 1x 请求一张比现有缩略图更小的图，把卡片糊掉。
// 这里只做原生 width/height 提示，避免解码前布局跳动。
function applyImageSource(img, imgIdx) {
    const e = entryById(imgIdx);
    img.src = thumbUrl(imgIdx);
    if (e && e.w > 0 && e.h > 0) {
        img.width = e.w;
        img.height = e.h;
    }
}

// 大图只在真正悬停时才取（首屏不再下载 20 张原图）。
// 这里刻意不用 onload 换 src：万一请求失败就永远停在缩略图上看不出区别，
// 且提前解码会白白占用内存；赋值给 img.src 由浏览器自己处理解码时机。
// 【前提】清单里的 full 必须是渲染安全的派生文件（asset-optimizer 重新编码过的
// 1600px 版本），不能是相机原图 —— 原图绕过了构建期朝向修正，会转 90 度。
// 【旧 bug 修复】原实现给 .item 绑 mouseenter，但 .item 的 CSS 是 pointer-events:none
// （见 src/views/PhotoWall.vue），元素根本收不到任何鼠标事件 —— 这段监听永远不触发，
// fullUrl() 从未被请求，public/images/full/ 因此是死资源（占 dist 的 ~80%）。
// 现在改为复用【已经在工作】的悬停机制：input.js 在 canvas 上做命中测试并调用
// setHover()，updateRender() 每帧据此放大卡片 1.25 倍。这里就挂在同一条链路上，
// 只对真正被悬停的那一张懒加载大图。
function applyFullImage(card, hovered) {
    const img = card.img;
    if (hovered) {
        if (!img.dataset.fullLoaded) {
            img.dataset.fullLoaded = '1';
            img.src = fullUrl(card.imgIdx);
        }
    } else if (img.dataset.fullLoaded) {
        // 离开后换回缩略图，避免在多张卡片间移动时把 20 张大图全部驻留内存
        delete img.dataset.fullLoaded;
        img.src = thumbUrl(card.imgIdx);
    }
}

// 固定槽位数组：索引 = wrappedRow * WORLD_COLS + wrappedCol，值 = 卡片对象或 undefined。
// 每帧只按格子索引，不做任何 Map / Set / 字符串拼接查找。
export const col = new Array(WORLD_COLS * WORLD_ROWS);

// ----------------------------------------------------------------
//  卡片创建 / 回收
// ----------------------------------------------------------------
const cards = new Map();       // "col,row" -> card

function createCard(col, row) {
    const imgIdx = imageIndexAt(col, row);
    const el = document.createElement('div');
    el.className = 'item';
    el.style.display = 'none';

    const img = document.createElement('img');
    img.decoding = 'async';
    img.loading = 'lazy';
    img.draggable = false;
    img.alt = '';
    applyImageSource(img, imgIdx);
    el.appendChild(img);

    const card = {
        el,
        img,
        col,
        row,
        imgIdx,
        baseW: BASE_W[imgIdx - 1],
        baseH: BASE_H[imgIdx - 1],
        hit: false,
        w: 0, h: 0, x: 0, y: 0, s: 0, z: -1,
        shown: false,
        attached: false,
        hovered: false,
        detachTimer: 0,
    };

    return card;
}

export function getCard(col, row) {
    const key = col + ',' + row;
    let card = cards.get(key);
    if (!card) {
        card = createCard(col, row);
        cards.set(key, card);
    }
    return card;
}

// 【关键】空槽必须在这一帧就补上，否则格子会被跳过、卡片永远不会出现。
// 300 项一次性建满，节点也只有在真正可见时才 insert —— 见 attach()。
export function ensureSlots() {
    for (let r = 0; r < WORLD_ROWS; r++) {
        for (let c = 0; c < WORLD_COLS; c++) {
            const slot = r * WORLD_COLS + c;
            if (!col[slot]) col[slot] = getCard(c, r);
        }
    }
}

// 卡片只有在「首次可见」时才插入 DOM（不再一次性创建 300 个节点）
function attach(card, canvasEl) {
    if (card.attached) return;
    card.attached = true;
    canvasEl.appendChild(card.el);
}

const DETACH_DELAY = 4000; // ms：离开覆盖范围这么久才回收，避免来回拖动时反复重建

function scheduleDetach(card) {
    if (card.detachTimer) return;
    card.detachTimer = setTimeout(() => {
        card.detachTimer = 0;
        if (card.hit || !card.attached) return;
        card.attached = false;
        card.el.remove();
    }, DETACH_DELAY);
}

function cancelDetach(card) {
    if (card.detachTimer) {
        clearTimeout(card.detachTimer);
        card.detachTimer = 0;
    }
}

// ----------------------------------------------------------------
//  核心渲染
// ----------------------------------------------------------------
export function updateRender() {
    const canvasEl = state.canvas;
    const slots = state.worldCol;
    if (!canvasEl || !slots) return;

    const viewW = state.viewW;
    const viewH = state.viewH;
    const scrollX = state.scrollX;
    const scrollY = state.scrollY;

    const dynamicScale = Math.min(1.4, Math.max(0.5, Math.min(viewW / 1400, viewH / 900)));
    const currentStep = STEP * dynamicScale;
    const centerX = viewW / 2;
    const centerY = viewH / 2;
    const maxDist = Math.hypot(centerX, centerY);
    const margin = 250;

    // 视口需要覆盖的格数（多算的由下面的精确剔除处理）
    const colsNeeded = Math.ceil((viewW + margin * 2) / currentStep) + 1;
    const rowsNeeded = Math.ceil((viewH + margin * 2) / currentStep) + 1;

    // 【关键】枚举窗口必须锚在摄像机所在的那一份世界上。
    // 摄像机左边界的世界坐标是 scrollX，所以第一个可见列号就是
    // floor(scrollX / currentStep)。若按 -scrollX/currentStep 取，
    // 枚举的是另一个世界副本（相差整数个周期），除极少数格之外全部会
    // 落在屏幕外，画面几乎是空的 —— 这正是首版重写踩过的坑。
    const startCol = Math.floor(scrollX / currentStep);
    const startRow = Math.floor(scrollY / currentStep);

    const hoverIdx = state.hoverIndex;

    for (const card of cards.values()) card.hit = false;

    for (let i = 0; i < colsNeeded; i++) {
        const stateCol = startCol + i;
        const wrappedCol = mod(stateCol, WORLD_COLS);
        // (wrappedCol + WORLD_COLS * m) 与 stateCol 只差整数个世界周期；
        // 取 m = round((stateCol - wrappedCol) / WORLD_COLS)，
        // cellX 就是离 scrollX 最近的那一份（|cellX| 恒小于一个周期）。
        const m = Math.round((stateCol - wrappedCol) / WORLD_COLS);
        for (let j = 0; j < rowsNeeded; j++) {
            const stateRow = startRow + j;
            const wrappedRow = mod(stateRow, WORLD_ROWS);
            const n = Math.round((stateRow - wrappedRow) / WORLD_ROWS);
            // 屏幕坐标 = 世界坐标 - 摄像机左边界（scrollX 就是摄像机左边界）。
            // 这里不能再加 scrollX % periodX：世界坐标的定义已经包含了它，
            // 加了会让整个网格被平移一个周期。
            const cellX = (wrappedCol + WORLD_COLS * m) * currentStep - scrollX;
            const cellY = (wrappedRow + WORLD_ROWS * n) * currentStep - scrollY;

            // 【注意】局部变量必须叫 card，不能叫 col —— 会遮蔽模块级的槽位数组
            const card = slots[wrappedRow * WORLD_COLS + wrappedCol];
            if (!card) continue;

            // state.prf 在 prefers-reduced-motion 时为 0：此时不做悬停放大
            // （main.css 只能关掉 CSS 过渡，JS 驱动的缩放得在这里关）。
            const isHovered = hoverIdx === card.imgIdx - 1;
            const scale = dynamicScale * (isHovered && state.prf ? 1.25 : 1);
            const scaledW = Math.round(card.baseW * scale);
            const scaledH = Math.round(card.baseH * scale);
            const x = Math.round(cellX + (currentStep - scaledW) / 2);
            const y = Math.round(cellY + (currentStep - scaledH) / 2);

            // 精确剔除：位置就是在这里算出来的，不会再出现
            // 「判定可见 -> 放到屏幕外 -> 二次剔除」的空转。
            if (x + scaledW < -margin || x > viewW + margin ||
                y + scaledH < -margin || y > viewH + margin) {
                card.hit = true; // 属于本帧覆盖范围、只是暂时在屏幕外，不回收
                continue;
            }

            card.hit = true;

            if (!card.attached) {
                attach(card, canvasEl);
                applyImageSource(card.img, card.imgIdx);
                card.shown = true;
                card.el.style.display = '';
            } else {
                cancelDetach(card);
                if (!card.shown) { card.shown = true; card.el.style.display = ''; }
            }

            // 悬停时才取大图；离开时退回缩略图（见 applyFullImage 注释）
            // reduced-motion 下不预取大图：用户此时看不到放大反馈，
            // 白白下载一张 1600px 的图没有意义。
            const wantFull = isHovered && !!state.prf;
            if (card.hovered !== wantFull) {
                card.hovered = wantFull;
                applyFullImage(card, wantFull);
            }

            // 增量写入：只有真的变了才落 DOM
            if (card.w !== scaledW) { card.w = scaledW; card.el.style.width = scaledW + 'px'; }
            if (card.h !== scaledH) { card.h = scaledH; card.el.style.height = scaledH + 'px'; }
            if (card.x !== x) { card.x = x; card.el.style.left = x + 'px'; }
            if (card.y !== y) { card.y = y; card.el.style.top = y + 'px'; }

            const centerDist = Math.hypot(x + scaledW / 2 - centerX, y + scaledH / 2 - centerY);
            const magnify = 0.6 + ((maxDist - centerDist) / maxDist) * 1.2;
            const z = Math.round(10000 - centerDist * 10);
            if (card.s !== magnify) {
                card.s = magnify;
                card.el.style.transform = 'scale(' + magnify.toFixed(3) + ')';
            }
            if (card.z !== z) { card.z = z; card.el.style.zIndex = z; }

        }
    }

    // 回收：离开覆盖范围一段时间后移出 DOM，把节点数控制在视口规模
    for (const card of cards.values()) {
        if (card.hit || !card.attached) continue;
        if (card.shown) { card.el.style.display = 'none'; card.shown = false; }
        scheduleDetach(card);
    }
}

// ----------------------------------------------------------------
//  构建 / 销毁
// ----------------------------------------------------------------
export function buildCards(canvasEl) {
    setCanvas(canvasEl);
    ensureSlots();
    // 把槽位数组交给状态对象，渲染主循环只依赖 state
    state.worldCol = col;
    return Promise.resolve();
}

export function setHover(index) {
    state.hoverIndex = (index === null || index === undefined) ? -1 : (index | 0);
}

export function destroyCards() {
    for (const card of cards.values()) {
        if (card.detachTimer) clearTimeout(card.detachTimer);
        card.el.remove();
    }
    cards.clear();
    state.worldCol = null;
    for (let i = 0; i < col.length; i++) col[i] = undefined;
}

export function getCardCount() {
    return cards.size;
}

export function getAttachedCount() {
    let n = 0;
    for (const card of cards.values()) if (card.attached) n++;
    return n;
}