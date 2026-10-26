<template>
  <!--
    影院模式（/cinema）
    ----------------------------------------------------------------
    结构、尺寸、时长逐条对照 CINEMA_SPEC.md（主理人用真实 Chrome 实测
    forum.hanakos.cc 的 cinemaMode 后记录）。三段式纵向布局：

      [霓虹跑马灯 h=72] [斜向照片流舞台 flex:1] [霓虹跑马灯 h=72]

    外层 padding-top: 96px 是给 NavBar 让位 —— NavBar 是 position:fixed，
    top:20px + height:60px，底边落在 80px，这里留 16px 呼吸。
  -->
  <div class="cinema-page" :class="{ 'cinema-paused': isPaused }">
    <!--
      读屏用标题。屏上不放大标题：参考站整个画面就是标题本身，
      再叠一行 H1 会破坏构图。但页面没有标题会让读屏用户失去定位，
      所以用 sr-only 提供，视觉上不可见。
    -->
    <h1 class="cinema-sr-only">影院模式 · 照片墙</h1>

    <div class="cinema-shell">
      <!-- ============ 顶部霓虹跑马灯 ============ -->
      <div class="neon-marquee" aria-hidden="true">
        <div class="neon-marquee-leds"></div>
        <div class="neon-marquee-track to-left">
          <!-- 两段内容必须逐字相同：translateX(-50%) 靠它做到无缝 -->
          <span class="neon-marquee-text">{{ MARQUEE_TEXT }}</span>
          <span class="neon-marquee-text">{{ MARQUEE_TEXT }}</span>
        </div>
        <div class="neon-marquee-highlight-top"></div>
        <div class="neon-marquee-highlight-bottom"></div>
      </div>

      <!-- ============ 照片流舞台 ============ -->
      <div class="cinema-stage">
        <div class="cinema-tilted">
          <!--
            :key 绑定列数：列数变化时必须【强制重建】而不是原地 patch。
            原因是 .cinema-col-track 的动画是 translateY(-50%) 百分比位移，
            列宽一变、卡高跟着变，百分比会按新高度立即重算 —— 若沿用同一个
            元素，画面会瞬间平移一两张卡。重建后动画从 0 开始，而 -50% 恰好
            等于第二份内容的起点，所以「从头开始」与当前画面视觉等价，不会跳。
          -->
          <div class="cinema-cols" :key="columnCount">
            <div v-for="col in columns" :key="col.id" class="cinema-col">
              <!--
                时长走 CSS 变量而不是直接写 animation-duration：
                prefers-reduced-motion 的放行规则里需要用 !important 把
                main.css 压下去的时长还原，而 !important 的样式表规则
                压不过【内联】样式。把时长放进自定义属性后，内联样式只声明
                变量，时长本身由样式表里的 var() 决定，放行规则才生效。
              -->
              <div
                class="cinema-col-track"
                :class="col.direction === 'down' ? 'cinema-track-down' : 'cinema-track-up'"
                :style="{ '--cinema-duration': col.duration + 's' }"
              >
                <article
                  v-for="card in col.track"
                  :key="card.key"
                  class="cinema-card"
                  :aria-hidden="card.duplicate ? 'true' : undefined"
                >
                  <img
                    :src="card.src"
                    :alt="card.alt"
                    :width="card.w"
                    :height="card.h"
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                  />
                </article>
              </div>
            </div>
          </div>
        </div>

        <!--
          暂停 / 继续。
          WCAG 2.1 成功准则 2.2.2（Level A）：自动开始、持续超过 5 秒的
          移动内容必须提供暂停机制。参考站没有这个按钮，但照片流是无限滚动，
          不给开关就不合规。做成舞台右上角 34px 的低对比度玻璃按钮，
          默认 opacity .55，尽量不抢画面。
        -->
        <button
          class="cinema-toggle"
          type="button"
          :aria-label="isPaused ? '继续滚动照片流' : '暂停滚动照片流'"
          @click="isPaused = !isPaused"
        >
          <svg v-if="!isPaused" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M8 5.2v13.6L19 12z" fill="currentColor" />
          </svg>
        </button>
      </div>

      <!-- ============ 底部霓虹跑马灯（与顶部完全一致） ============ -->
      <div class="neon-marquee" aria-hidden="true">
        <div class="neon-marquee-leds"></div>
        <div class="neon-marquee-track to-left">
          <span class="neon-marquee-text">{{ MARQUEE_TEXT }}</span>
          <span class="neon-marquee-text">{{ MARQUEE_TEXT }}</span>
        </div>
        <div class="neon-marquee-highlight-top"></div>
        <div class="neon-marquee-highlight-bottom"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
// 【必须】从 config.js 取 IMAGE_POOL，而不是直接从 imageManifest.js 拿原始清单：
// config.js 的 validatePool() 会校验张数与字段，无效时返回空数组。
// 绕过它直接取模，等于把这道防线拆掉 —— 空池时 entry 是 undefined，
// 读 entry.thumb 会抛 TypeError，整页白屏（实测已复现）。
import { IMAGE_POOL } from '../core/config.js';
import { assetUrl } from '../core/imageManifest.js';

/**
 * 每列滚动时长（秒）—— 参考站实测值，按列序号取用（第 1 列 55s …）。
 * 数值故意互不相等，各列才会呈现「错落」的观感；改成同一个数会像一整块在动。
 */
const COLUMN_DURATIONS = [55, 62, 50, 68, 58, 64, 52];

/** 跑马灯文案：两段 span 内容必须逐字相同，否则 translateX(-50%) 会露出接缝。 */
const MARQUEE_TEXT =
  '影院模式  •  CINEMA MODE  •  要说漂亮哟~  •  PHOTO WALL  •  NOW PLAYING  •  上映中  ·  ';

/** 序号补零，alt 文案用（照片 07 而不是 照片 7，等宽视觉更整齐）。 */
const pad2 = (n) => String(n).padStart(2, '0');

const POOL_SIZE = IMAGE_POOL.length;

/**
 * 候选列数，从多到少。选列的算法会从 MAX 往下试，取第一个几何上成立的。
 * 上限 6 而不是 7：20 张照片分 7 列会得到 3,3,3,3,3,3,2，末列只有 2 张，
 * 而桌面单屏可见 3 张，那一列必然循环到副本 —— 「7 列」与「零重复」不可兼得。
 */
const COLUMN_MAX = 6;
const COLUMN_MIN = 2;

/** 视口宽度 → 初始候选列数（仅用于首帧，挂载后会被几何实测覆盖）。 */
const pickInitialColumnCount = (width) => {
  if (width >= 1024) return 6;
  if (width >= 640) return 5;
  return 4;
};

/**
 * 把 20 张照片轮流分到 count 列，并构建每列的循环轨道。
 *
 * 【取图方式：轮转】第 i 张照片放进第 (i % count) 列。
 * 这样每张照片【恰好出现一次】，天然零重复，也不需要「步长与池大小互质」
 * 这类数论约束（旧实现的 gcd 检查就是为此存在的，现已不需要）。
 * 顺带一个好处：相邻列永远不会共享同一张照片，不可能出现「阶梯状重复」。
 *
 * 【无缝循环】每列内容必须复制一份拼在轨道末尾：轨道总高 = 2 × 内容高，
 * translateY(-50%) 才恰好落在与起点完全相同的画面上。少了这一步，-50% 会
 * 跳到内容中部，肉眼可见一次「跳帧」。复制份打 duplicate 标记：alt 置空 +
 * aria-hidden，避免读屏把同样的照片念两遍。
 *
 * 【为什么要复制一份，却仍算「不重复」】副本是同一张照片的第二个 DOM 实例，
 * 但它只会在「单份内容已完全滚出屏幕」之后才进入视口 —— 这由列数选择保证，
 * 见 pickFitColumnCount()。所以屏幕上任何时刻看到的照片两两不同。
 *
 * @param {number} count 列数
 * @returns {Array<object>} 每列的卡片轨道
 */
const buildColumns = (count) => {
  // 空池（清单缺失或校验失败）时不构建任何列：舞台渲染成空的，
  // 跑马灯与骨架照常显示 —— 这是降级，不是崩溃。
  if (POOL_SIZE === 0 || count <= 0) return [];

  // 列数不能超过照片数，否则会出现没有任何卡片的空列（高度 0，动画跑在空气上）。
  const effective = Math.min(count, POOL_SIZE);

  const buckets = Array.from({ length: effective }, () => []);
  IMAGE_POOL.forEach((entry, index) => {
    buckets[index % effective].push(entry);
  });

  return buckets.map((entries, columnIndex) => {
    const cards = entries.map((entry, index) => ({
      key: 'c' + columnIndex + '-' + index,
      // 【必须】用 assetUrl 拼地址：清单里的 thumb 是不带前导斜杠的相对路径，
      // 前缀由 import.meta.env.BASE_URL 提供，子路径部署才不会 404。
      // 这里绝不能写死 /images/thumbnails/x.webp。
      src: assetUrl(entry.thumb),
      alt: '照片 ' + pad2(entry.id),
      w: entry.w,
      h: entry.h,
      duplicate: false,
    }));

    const track = cards.concat(
      cards.map((card) => ({
        ...card,
        key: card.key + '-dup',
        alt: '',
        duplicate: true,
      }))
    );

    return {
      id: columnIndex,
      duration: COLUMN_DURATIONS[columnIndex % COLUMN_DURATIONS.length],
      // 方向交替：第 1/3/5 列向下，第 2/4/6 列向上（参考站实测规律）
      direction: columnIndex % 2 === 0 ? 'down' : 'up',
      track,
    };
  });
};

const columns = shallowRef([]);
const columnCount = ref(0);

/**
 * 判断当前 DOM 里「每列最少张数 >= 单屏可见张数」是否成立。
 *
 * 【为什么必须实测而不是算】可见张数 = ceil(列高 / 单卡步长)，而：
 *   - 列高来自窗口高度；
 *   - 单卡步长 = 列宽 × 4/3 + gap，列宽又来自窗口宽度 / 列数；
 *   - 舞台整体还有 rotate(-10deg) scale(1.1)，旋转后外侧列的斜向可视弦长
 *     比列高更长（1440 宽时边缘列约 +210px）。
 * 也就是说「列数 → 列宽 → 卡高 → 可见张数」是循环依赖，只按宽度分档必然
 * 在「高窗口」上翻车（实测 1440x1200：6 列时每列 3 张，屏幕却能放 4 张）。
 * 所以这里直接读真实布局，把注释里的推导变成运行时的不变量。
 *
 * @returns {boolean} true = 当前列数安全
 */
const isColumnCountSafe = () => {
  const firstCol = document.querySelector('.cinema-col');
  if (!firstCol) return true;
  const cards = firstCol.querySelectorAll('.cinema-card');
  const colCount = document.querySelectorAll('.cinema-col').length;
  if (!colCount || cards.length < 2) return true;

  const colH = firstCol.offsetHeight;
  const step = cards[1].offsetTop - cards[0].offsetTop;
  if (!(step > 0) || !(colH > 0)) return true;

  // 单份内容 = 轨道的一半；屏幕上同时可见的卡片数 = ceil(列高 / 步长)
  const visible = Math.ceil(colH / step);
  const minCards = Math.floor(POOL_SIZE / colCount);
  return minCards >= visible;
};

/**
 * 选出几何上成立的最大列数。
 *
 * 做法是「先按初始候选渲染 → 实测 → 不安全就减一列 → 再实测」，
 * 而不是纯公式推导：列数变少会让列变宽、卡片变高、可见张数下降，
 * 所以这是个单调收敛的过程，最多试 COLUMN_MAX - COLUMN_MIN 次。
 */
const applyColumnCount = async (count) => {
  let next = Math.min(Math.max(count, COLUMN_MIN), COLUMN_MAX);
  columnCount.value = next;
  columns.value = buildColumns(next);
  await nextTick();

  while (next > COLUMN_MIN && !isColumnCountSafe()) {
    next -= 1;
    columnCount.value = next;
    columns.value = buildColumns(next);
    await nextTick();
  }
};

// 首帧先用宽度给个候选，挂载后再用实测收敛（见 onMounted）。
const initialWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
columnCount.value = pickInitialColumnCount(initialWidth);
columns.value = buildColumns(columnCount.value);

onMounted(() => {
  applyColumnCount(pickInitialColumnCount(window.innerWidth));
});

// 跨断点 / 改窗口高度时重算。rAF 合并连续 resize 事件；
// 宽度与高度都要参与判断 —— 只按宽度会在「高窗口」上漏判。
let resizeRaf = 0;
let lastW = typeof window === 'undefined' ? 0 : window.innerWidth;
let lastH = typeof window === 'undefined' ? 0 : window.innerHeight;
const onResize = () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    applyColumnCount(pickInitialColumnCount(w));
  });
};

if (typeof window !== 'undefined') {
  window.addEventListener('resize', onResize);
}

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = 0;
  }
});

/** 暂停开关（对应 WCAG 2.2.2 的暂停机制，见模板里的按钮注释）。 */
const isPaused = ref(false);
</script>

<style scoped>
/* ================================================================
   影院页样式
   ----------------------------------------------------------------
   ⚠️ @keyframes 名是全局命名空间，scoped 不会隔离它。
   Vue 的 scoped 编译只会给 @keyframes 加 -<hash> 后缀去重，
   但为了与 src/assets/main.css 里已有的 ptr-* 系列明确区分，
   这里所有关键帧统一加 cinema- 前缀（cinemaScrollDown / cinemaScrollUp /
   cinemaNeonScrollLeft / cinemaNeonFlicker），不做重名赌运气。
   ================================================================ */

/* ---------------- 页面骨架 ---------------- */
.cinema-page {
  position: relative;
  z-index: 10;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  /* 给固定导航留位：NavBar top:20 + height:60 = 80，这里留 16px 呼吸 */
  padding-top: 96px;
  background: #0d0d0d;
  overflow: hidden;

  /*
    跑马灯走完一整段（= 轨道宽的一半）所需的秒数。
    规格里没给这个时长（第 7 节的 .neon-marquee-track 只给了
    timing-function / iteration-count），这里按"约 66px/s 的匀速"估：
    单段文字实测约 1850px 宽，1850 / 28s ≈ 66px/s，与参考站观感接近。
    写成变量是为了让 prefers-reduced-motion 的放行规则能引用同一个值。
  */
  --cinema-marquee-duration: 28s;
}

.cinema-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

/* 只给读屏用的文本 */
.cinema-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ---------------- 照片流舞台 ---------------- */
.cinema-stage {
  position: relative;
  flex: 1;
  /* 纵向 flex 里 flex:1 的元素默认 min-height:auto，会被内容撑破，
     导致舞台顶出视口。显式压成 0 才能正确收缩。 */
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(rgba(30, 20, 40, 0.3), transparent 70%);
}

.cinema-tilted {
  position: absolute;
  inset: 0;
  /* rotate 后四个角会露出舞台底，靠 scale(1.1) 把四周补满（实测取值） */
  transform: rotate(-10deg) scale(1.1);
  transform-origin: center center;
}

.cinema-cols {
  display: flex;
  /* 列间距走变量：.cinema-col-track 的 padding-bottom 必须用同一个值，
     否则 -50% 会差半个 gap（见 .cinema-col-track 的注释） */
  --cinema-gap: 8px;
  gap: var(--cinema-gap);
  height: 100%;
  width: 100%;
}

.cinema-col {
  position: relative;
  overflow: hidden;
  /* 不写 min-width:0 的话，列内的长内容会把列撑宽，列数一多宽度就不均了 */
  min-width: 0;
  flex: 1;
}

.cinema-col-track {
  display: flex;
  flex-direction: column;
  gap: var(--cinema-gap, 8px);
  /*
    ⚠️ 这一行是【无缝循环的必要条件】，不是装饰：
    轨道子项是 2N 张卡片，flex 只产生 2N-1 个 gap，
    于是轨道高 = 2N·h + (2N-1)·g，一半是 N·h + (N-0.5)·g，
    而第二份内容真正开始的位置是 N·h + N·g —— 差半个 gap（8px/2 = 4px）。
    每轮循环到 -50% 时会跳 4px，在 4 列并排时肉眼能看出一次抽搐。
    补上 padding-bottom = 一个 gap 后，轨道高变成 2N·(h+g)，一半正好等于
    N·(h+g)，与第二份内容的起点分毫不差。
  */
  padding-bottom: var(--cinema-gap, 8px);
  will-change: transform;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-duration: var(--cinema-duration, 55s);
}

.cinema-track-down {
  animation-name: cinemaScrollDown;
}

.cinema-track-up {
  animation-name: cinemaScrollUp;
}

@keyframes cinemaScrollDown {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-50%);
  }
}

@keyframes cinemaScrollUp {
  0% {
    transform: translateY(-50%);
  }
  100% {
    transform: translateY(0);
  }
}

/* ---------------- 卡片 ---------------- */
.cinema-card {
  position: relative;
  /* border-box：卡片有 1px 边框，用 content-box 会让实际宽度比列宽多 2px，
     被列的 overflow:hidden 切掉一条边，且 aspect-ratio 算高时也带上偏差 */
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 3 / 4;
  /* 轨道是 flex column，禁止卡片被压缩，否则 aspect-ratio 会被 flex 覆盖 */
  flex: 0 0 auto;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #14101a;
  transition:
    transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.35s,
    filter 0.35s;
  filter: brightness(1) saturate(1);
}

.cinema-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.7s;
}

/* 角标（NO.xx）与底部压暗信息条已按需求移除：
   照片本身就是主体，序号会分散注意力。
   数据里的 no 字段也一并删掉了，避免留下没人读的死字段；
   读屏文案仍由 alt 提供（'照片 07' 这种），无障碍信息不受影响。 */

/* ---------------- 悬停 ----------------
   整段包在 (hover: hover) and (pointer: fine) 里：触屏没有真悬停，
   移动端点击后会残留"粘住的 hover"，表现为整列永久暂停 + 一张卡片永久高亮。
   桌面端观感与参考站一致，只是移动端不再出现粘滞状态。 */
@media (hover: hover) and (pointer: fine) {
  .cinema-card:hover {
    transform: translateY(-4px) scale(1.04);
    box-shadow:
      0 0 40px rgba(244, 114, 182, 0.55),
      0 12px 40px rgba(0, 0, 0, 0.5);
    z-index: 5;
    filter: brightness(1.08) saturate(1.1);
  }

  .cinema-card:hover img {
    transform: scale(1.05);
  }

  /* 指针进入整列即暂停该列，鼠标可以稳稳地停在一张照片上 */
  .cinema-col:hover .cinema-col-track {
    animation-play-state: paused;
  }

  /* 聚焦式打光：有卡片被悬停时，其余卡片压暗（参考站原效果）。
     依赖 :has()（Chrome 105+/Safari 15.4+/Firefox 121+）。
     老浏览器整条规则被丢弃，退化为"只有高亮没有压暗"，不影响功能。 */
  .cinema-stage:has(.cinema-card:hover) .cinema-card:not(:hover) {
    filter: brightness(0.45) saturate(0.75);
  }
}

/* ---------------- 暂停按钮 ---------------- */
.cinema-toggle {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  /* 与跑马灯同一套主题色：金边 + 暗暖金底，融入画面而不突兀 */
  border: 1px solid rgba(228, 187, 56, 0.28);
  background: rgba(26, 16, 8, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: rgba(255, 242, 232, 0.9);
  opacity: 0.55;
  cursor: pointer;
  transition:
    opacity 0.25s ease,
    background 0.25s ease,
    border-color 0.25s ease;
}

.cinema-toggle:hover,
.cinema-toggle:focus-visible {
  opacity: 1;
  background: rgba(60, 42, 12, 0.8);
  border-color: rgba(228, 187, 56, 0.6);
}

/* 暂停态：照片流与跑马灯一起停（含霓虹闪烁），
   避免暂停期间仍有元素在动，让人以为按钮没生效。 */
.cinema-paused .cinema-col-track,
.cinema-paused .neon-marquee-track,
.cinema-paused .neon-marquee-text {
  animation-play-state: paused;
}

/* ---------------- 霓虹跑马灯 ---------------- */
.neon-marquee {
  /*
    配色走 CSS 变量，不写死具体色值。
    【为什么】影院页现在是金色主题（呼应导航栏「影院」的 #e4bb38），
    但画报页是青柠 #a3e635、首页是紫色 #8b6ce8。若把颜色写死在组件里，
    复制到其它页面就会变成三份各自维护的硬编码。
    改为只声明两个变量后，其它页面覆盖 --neon-accent / --neon-accent-rgb
    即可整体换色，其余派生色（边框、辉光、文字阴影、高光条）自动跟随。

    当前为方案 C「金粉双色」：主体走金色，边框与底部高光掺一点参考站的粉，
    既有影院的金调，又保留原设计的霓虹层次。
  */
  --neon-accent: #e4bb38;
  --neon-accent-rgb: 228, 187, 56;
  --neon-pink-rgb: 236, 72, 153;

  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 72px;
  flex: 0 0 72px;
  overflow: hidden;
  /* 背景由主色派生：极暗的暖金，中间压得更黑以托住文字 */
  background: linear-gradient(#1a1008, #0f0804 50%, #1a1008);
  border-top: 1px solid rgba(var(--neon-accent-rgb), 0.24);
  border-bottom: 1px solid rgba(var(--neon-accent-rgb), 0.24);
  box-shadow:
    inset 0 0 30px rgba(var(--neon-accent-rgb), 0.2),
    0 0 20px rgba(var(--neon-pink-rgb), 0.12);
}

.neon-marquee-leds {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(255, 200, 120, 0.16) 1.2px, transparent 1.5px);
  background-size: 8px 8px;
  opacity: 0.8;
  mix-blend-mode: screen;
  pointer-events: none;
}

.neon-marquee-track {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  white-space: nowrap;
  /*
    ⚠️ 这一行是对规格的一处【刻意补正】，理由：
    规格给的 position:absolute; inset:0 会让轨道盒宽 = 跑马灯宽（例如 1440px），
    而内容（两段文字）实际宽约 3700px，是溢出在盒子外的。
    transform 百分比解析的是【元素自身 border box】，即 -50% 只有 -720px，
    不等于"一段文字的宽度"，循环处会看到明显跳变。
    改成 width:max-content 后，轨道盒宽 = 内容宽，
    -50% 才精确等于一段的宽度，无缝成立。
  */
  width: max-content;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-duration: var(--cinema-marquee-duration, 28s);
  will-change: transform;
}

.neon-marquee-track.to-left {
  animation-name: cinemaNeonScrollLeft;
}

@keyframes cinemaNeonScrollLeft {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-50%);
  }
}

.neon-marquee-text {
  display: inline-block;
  /* flex 子项默认 flex-shrink:1，会被压扁；文字必须保持自身宽度 */
  flex: 0 0 auto;
  padding: 0 1.5rem;
  font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  font-weight: 800;
  font-size: clamp(22px, 3.2vh, 36px);
  letter-spacing: 0.18em;
  color: #fff2e8;
  /*
    五层文字阴影 = 霓虹灯的"灯芯 → 内晕 → 中晕 → 外晕 → 环境光"。
    前三层用暖白/橙保持灯管的实心感，第四层用板块主色，
    第五层掺粉色作环境光 —— 这是方案 C 的粉金层次。
  */
  text-shadow:
    0 0 2px #fff,
    0 0 6px rgba(255, 225, 180, 0.95),
    0 0 14px rgba(255, 170, 110, 0.85),
    0 0 28px rgba(var(--neon-accent-rgb), 0.65),
    0 0 48px rgba(var(--neon-pink-rgb), 0.35);
  animation: cinemaNeonFlicker 4.5s ease-in-out infinite;
}

@keyframes cinemaNeonFlicker {
  0%,
  100% {
    opacity: 1;
  }
  47% {
    opacity: 1;
  }
  48% {
    opacity: 0.75;
  }
  49% {
    opacity: 1;
  }
  72% {
    opacity: 1;
  }
  73% {
    opacity: 0.85;
  }
  74% {
    opacity: 1;
  }
}

/* 顶部高光条走主色（金）：中段最亮、两端淡出，模拟灯管正对镜头的那一段 */
.neon-marquee-highlight-top {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  top: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 215, 150, 0.5),
    rgba(255, 215, 150, 0.8),
    rgba(255, 215, 150, 0.5),
    transparent
  );
}

/* 底部高光条走粉：与顶部的金形成上下分层，这是方案 C「金粉双色」的点睛处 */
.neon-marquee-highlight-bottom {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  bottom: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(var(--neon-pink-rgb), 0.5),
    transparent
  );
}

/* ================================================================
   无障碍：prefers-reduced-motion 放行
   ----------------------------------------------------------------
   src/assets/main.css 里有一条全局规则，在 reduce 环境下把
   animation-duration 压到 0.01ms、animation-iteration-count 压到 1
   （两条都是 !important）。那会把照片流与跑马灯在 1 帧内跑完并停在终点，
   页面变成两排静止的残帧。

   影院页的【主体内容】就是这两组循环，不是装饰，所以这里按规格要求放行：
   用更高优先级的选择器 + !important 把时长与循环次数还原。
   （优先级：main.css 的 * 是 (0,0,0)，这里 .cinema-col-track 是 (0,1,0)，
   同为 !important 时高优先级胜出，与源码顺序无关。）

   刻意【不】放行的部分：
   - 卡片 hover 的位移/缩放（main.css 的 transition-duration 仍是 0.01ms，
     悬停反馈变成瞬时生效，信息量不丢）；
   - 跑马灯的霓虹闪烁 cinemaNeonFlicker（纯装饰的忽明忽暗，
     reduce 环境下就该关掉，这里保持关闭）。

   放行的前提是把时长存进 CSS 变量 —— 见模板里 :style 的注释：
   内联的 animation-duration 会压过任何非 !important 的样式表规则。
   ================================================================ */
@media (prefers-reduced-motion: reduce) {
  .cinema-col-track {
    animation-duration: var(--cinema-duration, 55s) !important;
    animation-iteration-count: infinite !important;
  }

  .neon-marquee-track {
    animation-duration: var(--cinema-marquee-duration, 28s) !important;
    animation-iteration-count: infinite !important;
  }
}

/* ================================================================
   窄屏适配
   ----------------------------------------------------------------
   列数一多，375px 宽的屏幕上每列只剩几十像素，卡片被压成竖条，
   完全看不出是照片。

   方案：列数由数据侧（pickInitialColumnCount + applyColumnCount）决定，
   不再用 CSS 隐藏末尾的列 —— 隐藏会把该列照片的唯一实例一起藏掉，
   与「卡片数 = 照片数」直接冲突（这是记忆/04 里踩过的坑）。
   这里只负责把倾斜角度调小、缩放调大，保证旋转后四角不露底。
   ================================================================ */
/*
  gap 三档必须与列数断点一一对应，否则会互相覆盖：
  原先这里写 min-width:768px 给 10px，而下面 max-width:1023px 又给 8px，
  两者特异性相同且后者靠后 —— 768~1023 区间实际一直是 8px，10px 从未生效。
  现在按「>=1024 / 640~1023 / <640」三段切开，与 pickInitialColumnCount 对齐。
*/
@media (min-width: 1024px) {
  .cinema-cols {
    --cinema-gap: 10px;
  }
}

@media (max-width: 1023px) {
  /* 列数由 COLUMN_BREAKPOINTS 在数据侧决定（此处 5 列），
     不再用 nth-child 隐藏列 —— 隐藏会把该列照片的唯一实例一起藏掉。 */
  .cinema-cols {
    --cinema-gap: 8px;
  }

  .cinema-tilted {
    transform: rotate(-8deg) scale(1.14);
  }
}

@media (max-width: 639px) {
  /* 列数由数据侧决定（此处 4 列），同样不用 nth-child 隐藏。 */
  .cinema-page {
    /* 小屏导航同样是 60px 高，但总高度紧张，收一点留白 */
    padding-top: 88px;
  }

  .cinema-cols {
    --cinema-gap: 6px;
  }

  .cinema-tilted {
    transform: rotate(-6deg) scale(1.2);
  }

  .neon-marquee {
    height: 64px;
    flex-basis: 64px;
  }

  .cinema-toggle {
    width: 30px;
    height: 30px;
    top: 10px;
    right: 10px;
  }
}

/* 横屏手机：可视高度极低，跑马灯占比过大时舞台会被挤没 */
@media (max-height: 480px) {
  .neon-marquee {
    height: 52px;
    flex-basis: 52px;
  }

  .cinema-page {
    padding-top: 84px;
  }
}
</style>
