<script>
/**
 * PtrTransition —— 参考站 forum.hanakos.cc 的站点级转场覆盖层（代号 ptr）的 Vue 3 复刻。
 *
 * 权威来源：参考站 layout chunk 内的组件本体 + webpack module 19812（helper）。
 * DOM 结构 / 类名 / CSS 变量 / 文本模板 / 状态机时序全部逐字对齐。装饰 CSS 在
 * src/assets/main.css 的 .ptr-* 段（99 条规则 + 15 个 @keyframes，由 Lead 维护），
 * 因此本组件【不得】使用 <style scoped>：scoped 会加属性限定符，让那些全局规则匹配不上。
 *
 * 时序（与参考站一致，也是本组件最容易做错的地方）：
 *   play() -> phase='cover'（三段 wipe 擦入：a 0s / b .06s / main .12s，各 .28s）
 *          -> .ptr-wipe-main 的 ptr-wipe-in animationend 触发 toReveal()
 *          -> toReveal() 里【立刻】router.push（此刻画面已被不透明 .ptr-panel 完全盖住），
 *             并与 (就绪信号 1500ms | 最短盖住 440ms) 的 Promise.all 并行
 *          -> 双层 rAF -> phase='reveal'
 *          -> 三段 wipe 反向擦出（main 0s / b .06s / a .12s）
 *          -> .ptr-wipe-a 的 ptr-wipe-out animationend 触发 finish() -> phase='idle'
 *          -> 180ms 后 state=null（回到空的 ptr-root.ptr-idle），IDLE_MS 后释放 busy
 * 绝不能「先 push 再播动画」：那样旧页面会在被盖住之前消失，露出底色（闪黑）。
 */
import { ref, computed, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';

/* ------------------------------------------------------------------ 常量 */

// 参考站：let I = _.Bh ? 480 : 260。安卓下 idle 驻留更久。
const IDLE_MS_ANDROID = 480;
const IDLE_MS_DEFAULT = 260;

// 参考站：L = ['pink','purple','green','yellow']。CSS 里【没有】.ptr-theme-pink，
// 'pink' 靠 .ptr-root 上的默认变量生效；类名照常输出，不要为 pink 特判。
const ALL_THEMES = ['pink', 'purple', 'green', 'yellow'];

// 参考站：G = 安卓?6:14、D = 安卓?5:12、band 重复 = 安卓?5:10
const REPEAT_BIG_ANDROID = 6;
const REPEAT_BIG_DEFAULT = 14;
const REPEAT_SMALL_ANDROID = 5;
const REPEAT_SMALL_DEFAULT = 12;
const REPEAT_BAND_ANDROID = 5;
const REPEAT_BAND_DEFAULT = 10;

const READY_SIGNAL_MS = 1500;    // 参考站 toReveal() 的就绪信号超时
const MIN_COVER_MS = 440;        // 参考站 toReveal() 的最短遮盖时长
const START_FALLBACK_MS = 900;   // 参考站 start(): 900ms 兜底 -> toReveal
const REVEAL_FALLBACK_MS = 900;  // 参考站 toReveal(): 900ms 兜底 -> finish
const IDLE_CLEAR_MS = 180;       // 参考站 finish(): 180ms 后 state=null

/**
 * 补播轮数上限。
 * 语义：一轮转场 + 最多联动 CHAIN_MAX 轮补播。用户连点 20 次，最多看到 2 次转场。
 * 为什么是 2：一轮完整转场约 1.1~1.35s，两轮已覆盖「第一轮还没结束就换主意」的全部真实场景；
 * 再多纯粹是把用户的误触放大成动画队列。
 */
const CHAIN_MAX = 2;

/**
 * 路由元数据表（参考站 M 表）。
 * 逐字对照参考站，剔除它专有的 /live、/profile、/home（我方没有这些页面），
 * 并新增 '/wall' —— 这是我方特有页面，参考站无对应项，文案沿用其 GALLERY 语义。
 * 表外的路径（例如 '/login'）走 DEFAULT_META，与参考站 `M[path] ?? A` 一致。
 * 改文案只需要动这张表，组件其余部分不感知具体路由。
 */
const META = Object.freeze({
  '/': { word: 'HOME', jp: 'ホーム', cn: '首页', no: '01', mark: '◇' },
  '/wall': { word: 'GALLERY', jp: 'ギャラリー', cn: '照片墙', no: '02', mark: '▣' },
  '/cinema': { word: 'CINEMA', jp: 'シアター', cn: '影院模式', no: '03', mark: '▶' },
  '/pictorial': { word: 'PICTORIAL', jp: 'ピクトリアル', cn: '画报', no: '04', mark: '◈' },
  // 退出登录的覆盖层大字。参考站没有这个页面（表外走 DEFAULT_META），这里显式补一条。
  // 【为什么是中文而不是 LOGOUT】这是中文界面，用户明确要求显示「退出登录」；
  // 中文不会做逐字母 slam（.ptr-letter 的 animation-delay 按 --ptr-i 递增，对中文同样生效，
  // 只是观感上是一字一字弹出），排版约束见下方 .ptr-title-word--cjk。
  '/login': { word: '退出登录', jp: 'ログアウト', cn: '退出登录', no: '✕', mark: '⏻' },
});

// 参考站 A 表，逐字
const DEFAULT_META = Object.freeze({
  word: 'HANA', jp: 'ホタル', cn: '萤火虫', no: '??', mark: '✦',
});

const isAndroid = typeof navigator !== 'undefined' && /android|harmony/i.test(navigator.userAgent);

/**
 * ★ 刻意取舍：不做安卓「分阶段揭示」（参考站的 T / R / F 门控）。
 *
 * 参考站是 T = 安卓 ? stage : 2; R = T >= 1; F = T >= 2 —— 桌面恒为 2（R/F 恒真），
 * 安卓则由覆盖期的两层 rAF + 110ms 定时器把 stage 从 0 推到 1、再推到 2，用来
 * 逐梯队揭示面板装饰（halftone+band1-3 / rows / mark / title+corner+edge）。
 *
 * 我方选择 (a) 全部渲染、不分阶段，理由：
 *   1. 参考站引入分阶段是为了配合它自己的安卓性能降级（.ptr-android 的 17 条规则
 *      关掉渐变背景、改用单次动画、去掉 text-stroke）。我方已通过同一套 .ptr-android
 *      CSS 拿到降级收益，分阶段揭示在上面只是锦上添花，收益极小。
 *   2. 桌面（R=F=真）两条路径完全等价，所以这个取舍【不影响桌面观感】，
 *      也就不影响本任务「复刻参考站观感」的目标。
 *   3. 分阶段需要额外的 stageCounter + rAF/定时器状态机，会引入一类新的
 *      「阶段推进没跑完就被下一轮转场覆盖」的竞态。用复杂度换一个只在
 *      安卓 UA 上可见的细枝末节，不划算。
 * 若日后确实要还原安卓分阶段，改动点只在这里：加 stage ref，在覆盖期推进，
 * 并按 R/F 给 <template> 里的 panel 装饰分组加 v-if 即可。
 */

/* --------------------------------------------------- 就绪信号 / 竞态守卫 */

/**
 * 参考站 helper 的 `(0,_.lf)(ms)` —— 注意：它【不是】字体等待，
 * 所以这里刻意【不叫】waitForFonts，避免以后有人按那个名字去“修”它。
 * 参考站真实实现是一个【全局单槽 + 定时就绪信号】的竞态守卫：
 *
 *   let l = null;
 *   function s(e) {
 *     return new Promise((t) => {
 *       let n = false;
 *       const r = () => { if (n) return; n = true; if (l === r) l = null; t(); };
 *       l = r;
 *       setTimeout(r, e);
 *     });
 *   }
 *
 * 后登记的回调会顶掉前一个；被顶掉的那个 promise 永不 resolve（靠 l !== r 白等）——
 * 这正是「取消上一轮等待」的表达方式。参考站在两处复用它：toReveal 的 1500ms、
 * 以及立方体分支 startViewTransition 里的 800ms。
 * 注意 r() 自带幂等守卫，超时后即使已 resolve 也不会重复触发，所以无需 clearTimeout。
 */
let readySlot = null;
function registerReadySignal(ms) {
  return new Promise((resolve) => {
    let settled = false;
    const fire = () => {
      if (settled) return;
      settled = true;
      if (readySlot === fire) readySlot = null;
      resolve();
    };
    readySlot = fire;
    setTimeout(fire, ms);
  });
}

/**
 * 参考站 helper 的 St()：丢弃当前挂着的就绪信号（不 resolve，只摘引用）。
 * 参考站在 pathname 变化时调用它，让上一轮 toReveal 的等待作废。
 * 这里与参考站行为一致：不调用被丢弃的回调，让那个 promise 永久悬挂。
 */
function dropReadySignal() {
  readySlot = null;
}

/* ------------------------------------------------------------ 文本模板 */

function buildBigText(card) {
  const g = isAndroid ? REPEAT_BIG_ANDROID : REPEAT_BIG_DEFAULT;
  return `${card.word}  ${card.mark}  ${card.jp}  •  ${card.word}  ${card.mark}  ${card.cn}  •`.repeat(g);
}

function buildSmallText(card) {
  const d = isAndroid ? REPEAT_SMALL_ANDROID : REPEAT_SMALL_DEFAULT;
  return `${card.word}  ${card.mark}  `.repeat(d);
}

function buildBandText(card) {
  const w = isAndroid ? REPEAT_BAND_ANDROID : REPEAT_BAND_DEFAULT;
  return `${card.mark}  ${card.word}  ★  ${card.no}  ◆  ${card.jp}  ✦  `.repeat(w);
}

/* --------------------------------------------------------------- 组件 */

export default {
  name: 'PtrTransition',
  setup(props, { expose }) {
    const router = useRouter();
    const route = useRoute();

    // 受 state 驱动的覆盖层；state=null 时渲染空的 .ptr-root.ptr-idle
    const state = ref(null);

    // 非响应式控制位（对应参考站的 useRef，避免无谓的重新渲染）
    let busy = false;
    let enteredReveal = false;
    let wentIdle = false;
    let gen = 0;
    let lastTheme = null;
    let targetPath = '';
    let timers = [];

    // ---- 「最新意图」槽与补播（对应缺陷 #33）--------------------------------
    // 旧行为：busy 期间 play() 直接 return false，调用方补一次裸 router.push，
    // 于是快速连点时第二次以后【没有任何转场】，并且会出现先后两次 push 互相中止
    // （实测：先 push '#/pictorial' 再 push '#/cinema'，最终停在 /cinema）。
    // 新行为：busy 期间【不 push、不排队】，只把最新目标覆盖进 pending，
    // 当前轮收尾后最多补播 CHAIN_MAX 次。乱点不会变成转场链：同一时刻只有 1 个补播名额。
    let pending = null;        // { path, dir } —— 覆盖式，永远只有最新一个
    let chainCount = 0;        // 补播已达成的次数：播满 CHAIN_MAX 次后不再补播，直接静默汇合
    let hitChainCap = false;       // 一个 busy 周期内是否「pending 命中补播上限」
    let hitChainCapNotified = false; // 同周期内只提示一次，避免连点刷屏
    let currentIsChain = false;      // 当前轮是否为补播轮（见 start 的 isChain 形参）
    // ★ 本轮请求的 push 是否仍在途。比 roundPushPending 更早置位（请求即置位，落地即清除），
    //   覆盖「已请求 push 但 toReveal 还没跑 / 已跑但 promise 还没落地」这一段灰色窗口。
    let pushInflight = false;
    const roundPushWaiters = [];     // 本轮 push 落地后要执行的对账回调
    const settledWaiters = []; // busy 期间到达的 play()，本轮结束后按「最终路径」统一放行

    // 本轮导航的 deferred。★ 必须【每个 generation 一个】：play() 的返回值语义是
    // 「本次调用被接受、且本轮的 router.push 已落地」，而 push 发生在 toReveal()
    // （wipe-in 动画结束后）。如果像早先那样共用一个槽位读上一轮的值，play() 会在
    // 本轮 push 之前就 resolve（首次更是立刻拿到初始 Promise.resolve()），
    // 语义名不副实。由 start() 建新 deferred、toReveal() 在 push 落定后 settle。
    let pushDeferred = null;   // { promise, resolve }

    const idleMs = isAndroid ? IDLE_MS_ANDROID : IDLE_MS_DEFAULT;

    /* ------------------------------------------- 全局层级标记 data-ptr-active */

    /**
     * ★ 缺陷修复（问题 B）：转场覆盖层盖不住导航栏。
     *
     * 实测（真 Chrome 1280x800）：
     *   .glass-nav  position:fixed z-index:99999（同时带 transform: translateX(-50%)，
     *               所以它自成层叠上下文，子元素的 z-index 全部困在里面）
     *   .ptr-root   position:fixed z-index:20000
     *   两者都是 body 的直接子节点（NavBar 在 #app 里由 App.vue 渲染，ptr 经 Teleport 到 body）
     *   => 99999 > 20000，覆盖层在任何阶段都盖不住导航栏。cover 阶段实测
     *      elementFromPoint(导航栏中心) 命中 NAV，而不是 .ptr-*。
     *
     * 【为什么不是把 .ptr-root 调到 100000】
     *   那会与项目里所有高 z-index 元素重新排优先级，且必须逐一论证：
     *     - src/views/PhotoWall.vue:82  .close-btn  z-index:99998（fixed）
     *     - src/views/Pictorial.vue:1492 .card-popover z-index:2000（fixed，Teleport 到 body）
     *   调高之后这些弹层在转场期间都会被埋，而且将来任何人再写一个更大的数字
     *   就会把覆盖层顶破 —— 这是把「永远赢」写进样式数值，脆且难验证。
     *
     * 【采用的方案】转场期间在 <html> 上打一个全局标记 data-ptr-active，
     * 由 main.css 里一条规则把导航栏临时压到覆盖层之下：
     *     html[data-ptr-active] .glass-nav { z-index: 0 !important; }
     * 为什么是 0 而不是 19999：n#4 现在能“赢”靠的只是数值比 .ptr-root 大（99999 vs 20000），
     *   而其余元素全部低于 .ptr-root。把 n#4 降到 0 之后，它比覆盖层与页面内容都低 ——
     *   而转场期间它本来就该被完全遮住，所以“低”正是想要的结果，且不依赖 .ptr-root 的具体数值：
     *   以后 .ptr-root 改成多少都不影响这条规则。
     *   选择器 html[data-ptr-active] .glass-nav 具体度 0-2-1，压过 NavBar.vue 里 scoped 的
     *   .glass-nav[data-v-xxx]（0-2-0），所以不必用 !important；仍带上 !important 是防内联样式。
     *
     * 【生命周期】标记的增删只在这两个地方：
     *   - start() 里 setPtrActive(true)（每轮转场的第一帧就生效，不等 CSS 动画）
     *   - finish() 的 idleMs 定时器里 setPtrActive(false)（与 busy 释放同一个回调，
     *     所以「开始即压、结束即还原」严格成对，不存在漏删的分支）
     * onUnmounted 里再兜一次 false，保证组件被热替换/卸载时 html 上不留脏标记。
     * 空闲态 .ptr-root.ptr-idle 是 visibility:hidden + pointer-events:none，
     * 此时 html 上没有标记，导航栏的 z-index 回到 99999，点击、hover、pill 动画全部照常。
     */
    function setPtrActive(on) {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      if (!root) return;
      // 幂等：setAttribute/removeAttribute 本身就幂等，这里不额外判，保持分支最少。
      if (on) root.setAttribute('data-ptr-active', '');
      else root.removeAttribute('data-ptr-active');
    }

    /* --------------------------------------------------------- 定时器 */

    function later(fn, ms) {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    }
    function clearTimers() {
      for (let i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
    }

    /* -------------------------------------------------- 动画事件处理 */

    // .ptr-wipe-a 的 ptr-wipe-out 结束 => 收尾。
    function onWipeAEnd(e) {
      // ★ 必须判 target === currentTarget：wipe-main 内部有几十个子元素在跑无限动画
      //   （band-drift 3~3.6s、row-slide 5~7.5s、mark-drift、blink…），它们的 animationend
      //   会冒泡上来。参考站只靠 animationName 白名单过滤，这里两道都判，更严谨。
      if (e.target !== e.currentTarget) return;
      if (e.animationName !== 'ptr-wipe-out') return;
      finish();
    }

    // .ptr-wipe-main 的 ptr-wipe-in 结束 => 立刻切路由并准备揭幕。
    function onWipeMainEnd(e) {
      if (e.target !== e.currentTarget) return;
      if (e.animationName !== 'ptr-wipe-in') return;
      toReveal();
    }

    /* ----------------------------------------------------- settlePush() */

    /**
     * 落定【本轮】push 的 deferred（幂等）。
     * play() 的返回值语义是「本次调用被接受，且本轮的 router.push 已落地」，
     * 所以必须有这样一处显式的落定点：toReveal() 里 push 成功/失败都调用它。
     * 幂等很重要 —— toReveal() 可能被 animationend 与 900ms 兜底重复触发、
     * 也可能因 enteredReveal 已置位而早退，任何一种都不允许让 play() 永久悬挂。
     * 同时它也是「上一轮遗留 deferred」的放行点：start() 在建新 deferred 前先调用它，
     * 保证不会有调用方卡在一个永远不会 settle 的 promise 上。
     */
    function settlePush() {
      if (!pushDeferred) return;
      const d = pushDeferred;
      pushDeferred = null;
      d.resolve();
      // ★ 缺陷修复（问题 A）：先 resolve 再对账。
      //   旧顺序是 reconcile() -> resolve()，而 reconcile() 在 pending 指向别处时会
      //   await 一次 router.push 才放行 —— 那段时间里 d 已经不在槽位上了，
      //   任何在 reconcile 的 push 期间新到达的 play() 都会被 start() 的 busy 守卫拒绝、
      //   返回 false，调用方（src/App.vue:85）于是又补一次裸 push，两次 push 互相中止。
      //   现在 d 在这一个栈帧内就 resolve，调用方永远拿不到「无人负责的 false」。
      //   对账仍在同一帧完成（只是不再阻塞 resolve），语义不变：本轮目标已落地。
      // ★ 问题 A 余量：pushInflight 只在这里清 —— settlePush() 是「本轮 push 已落地」的
      //   唯一权威落定点（同路径分支与 push 成功分支都会调它）。清完立刻跑对账回调，
      //   那些回调是本轮 finish() 早于 push 时被 drainPending() 寄存下来的（见 drainPending）。
      pushInflight = false;
      while (roundPushWaiters.length) roundPushWaiters.shift()();
      reconcile();
    }

    /**
     * 寄存「本轮 push 落地后要做的对账」。
     * 已无 push 在途则同步执行 —— 保证调用方永远不会被挂起。
     * @param {() => void} fn
     */
    function waitForRoundPush(fn) {
      if (pushInflight) roundPushWaiters.push(fn);
      else fn();
    }

    /* ----------------------------------------------------- finish() */

    // 参考站 x()：收尾。幂等（wentIdle / busy 双守卫），可被 animationend 与兜底定时器同时调用。
    function finish() {
      if (wentIdle || !busy) return;
      wentIdle = true;
      if (state.value) state.value = { ...state.value, phase: 'idle' };
      later(() => {
        state.value = null;
      }, IDLE_CLEAR_MS);
      later(() => {
        // ★ 问题 A 余量（真实鼠标连点实测踩到）：本轮还没 toReveal，却已经把 busy 放掉。
        //   此时若有一个 pending，drainPending() 会补播一轮 —— 补播轮自己的 toReveal() 先 push
        //   最新目标，而本轮迟到的 push 随后落地，把它中止。实测日志（两连点，间隔 250ms）：
        //     t=3217 push '#/wall'      （本轮，迟到）
        //     t=3227 push '#/pictorial' （补播轮）
        //   画报页的转场在错误的页面上播完，最后停在 /pictorial 纯属侥幸。
        //   本轮的 push 一定发生在 reveal 之前（见 toReveal 的时序注释），所以：
        //   本轮 push 还在途、而手上已有 pending ⇒ 本轮注定要被改写，连 reveal 都不该播，
        //   直接把进程交给 drainPending（它用 waitForRoundPush 等到本轮 push 落地再补播，
        //   全程只有一次 push）。push 已落地时不必插手：这一帧的 route 与命中测试都正确。
        window.__dbg && window.__dbg({ ev: 'finish', pending: pending && pending.path, inflight: pushInflight, entered: enteredReveal, route: route.path, target: targetPath });
        if (pending && pushInflight) toReveal();
        busy = false;
        // ★ 与 busy 释放成对：同一回调里摘掉全局层级标记，导航栏 z-index 立刻回到 99999。
        //   放在这里而不是 state=null 的 180ms 回调里，是因为此时 ptr-root 已经
        //   .ptr-idle（收尾时同步加上），已经不再拦截点击，无需继续压导航栏。
        setPtrActive(false);
        // ★ 本轮到这里才算真的释放了。补播/对账都排在这一刻之后，
        //   保证任何时刻最多只有一轮持有 busy —— 这是「dataset/state 生命周期干净、
        //   不会卡在 cover 或 reveal」的根基：每条 settle 路径最终都会走到这里。
        // busy 期间【没有任何人 push】，所以此刻的 route.path 必然是本轮的目标；
        // pending 有值就意味着「用户中途改了主意」，交给 drainPending 决定补播还是直达。
        if (pending) drainPending();
      }, idleMs);
    }

    /* ------------------------------------------------ 补播（busy 期间换目标） */

    /**
     * 把 pending 里的最新目标与当前实际路径对齐。【每个 busy 周期只调用一次】
     * （由 finish() 的 idleMs 定时器调用 —— 那一刻 busy 已释放、上一轮 push 已落地。）
     *
     * 三种结局，任何一种都不允许「点了既没动画也没跳转」：
     *   a) 有 pending 且与当前实际路径不同：
     *        - 还有补播额度 → 立刻补播一轮（擦入在 1 帧内盖满，观感是「中途改向」）
     *        - 额度用尽     → 静默 push（已经播够次数了，剩下的按误触处理，不再播）
     *   b) 没有 pending，或 pending 与当前路径相同：什么都不做，目标已经到达
     * 无论走哪条，最后都要 releaseSettled() —— 否则 busy 期间 await play() 的调用方会永久悬挂。
     */
    function drainPending() {
      const p = pending;
      pending = null;

      // ★ 缺陷修复（问题 A 余量）：先把「本轮自己的 push 是否落地」这一步做完，再谈补播。
      //   实测踩到（真实鼠标连点，间隔 250ms）：第一轮的 push 由 vue-router 在微任务里
      //   异步落地，本轮 finish() 却可能先到（idle 定时器），于是 drainPending() 立刻
      //   按 pending 补播第二轮 —— 补播的 toReveal() 又 push 最新目标。两次 push 只差 6ms：
      //     t=3195 push '#/wall'（本轮迟到的）
      //     t=3201 push '#/pictorial'（补播轮的）
      //   后者把前者中止，导致第二轮转场在【错误的页面】上播动画：画报页内容被盖住、
      //   揭幕时看到的却是照片墙。旧代码只在 toReveal() 里设 roundPushPending，
      //   而「尚未 toReveal 但 push 还没落地」这一段没有任何标志，于是走漏。
      //   现在用 pushInflight（见 start / settlePush）统一表示「本轮请求的 push 仍在途」。
      if (pushInflight && p) {
        // 本轮目标尚未落地：先把 pending 放回槽位（由 settlePush 的对账接手），
        // 等 push 真正落地后再决定补播。期间不会有任何第二次 push。
        pending = p;
        waitForRoundPush(function () {
          if (pending) drainPending();
          else releaseSettled(true);
        });
        return;
      }
      if (p && p.path !== route.path) {
        // ★ 缺陷修复（问题 A 收尾）：绝不在本轮的 push 尚未落地时补播。
        //   实测踩到：toReveal() 是 router.push(target) 与 minCover(440ms) 竞速，
        //   若 push 被拖慢（导航守卫/懒加载），第一轮的 push 会在本轮 finish 之后才落地。
        //   旧代码此时按 pending 补播一轮，补播的 toReveal() 又 push 一次最新目标 ——
        //   两次 push 互相中止，实测 5 连点时 3 次 push 全部丢失（attr 连成一片、
        //   pushes 只剩 ['#/cinema','#/']，中间 '/wall' '/pictorial' 被吞）。
        //   现在：显式把「本轮 push 未落地」也纳入 pending 判定，先直达本轮目标，
        //   落地后再做一次对账（reconcile 会把 pending 的最新目标送达）。
        if (chainCount < CHAIN_MAX) {
          chainCount++;
          hitChainCap = chainCount === CHAIN_MAX;
          // 此刻 busy 刚被释放，start() 必然可用。仍判返回值：万一被拒，
          // 退回静默 push —— 「绝不无响应」优先于「尽量有动画」。
          // ★ 缺陷修复（问题 A 的最初形态）：这里原先调用 start(p.path, p.dir, true)，
          //   而 start 的签名是 (path, dir) —— 第三个实参被静默丢弃，所以补播轮
          //   与本轮完全同构（同一套 busy/idle 时序）。现在显式传 isChain，
          //   play() 的返回值据此区分「本轮已落地」与「补播已落地」。
          if (!start(p.path, p.dir, true)) {
            Promise.resolve(router.push(p.path))
              .catch(() => {})
              .then(() => reconcile());
          }
          return;
        }
        // 补播额度用尽：静默直达，不再播动画。
        hitChainCap = true;
        // 与 toReveal() 里的 push 同一套写法：vue-router 在重复/被中止导航时会
        // reject（History 层抛 DOMException），必须吞掉，否则是 unhandled rejection。
        Promise.resolve(router.push(p.path))
          .catch(() => {})
          .then(() => reconcile());
        return;
      }

      reconcile();
    }

    /** 放行 busy 期间到达的所有 play()。@param {boolean} reached 目标是否已（或终将）到达 */
    function releaseSettled(reached) {
      while (settledWaiters.length) settledWaiters.shift()(reached);
    }

    /**
     * 兜底对账：busy 期间若有 play() 被挂起，而本轮没走补播（例如 pending 与当前路径相同、
     * 或 toReveal 早退），保证它们不会被永久挂着。
     * 这一条专门兜「网络/路由守卫把 push 重定向到别的路径」这类非常规情况：
     * 当前轮结束后若 route.path 仍不是最后请求的路径，就补一次 push。
     */
    function reconcile() {
      const p = pending;
      pending = null;
      // 当前路径已经是最后一次点击的目标 —— 这是常态（push 落在 toReveal 里，必然到位）。
      if (!p || p.path === route.path) {
        releaseSettled(true);
        return;
      }

      // ★ 缺陷修复（连点第二次被丢弃）：旧实现这里只做 router.push，【从不播转场】。
      //   时序上 settlePush() 末尾就调 reconcile()，而此刻 busy 仍为 true
      //   （finish() 的 idleMs 定时器还没跑）。于是 pending 被本函数取走并清空，
      //   随后 finish() 里 `if (pending) drainPending()` 已经没有内容可播 ——
      //   用户看到的就是「第二次点击凭空消失，最终停在第一个目标」。
      //   实测（真 Chrome 1440x900，点影院后 280ms 点画报）：只播 1 轮，最终 #/cinema。
      //
      //   现在的分工：
      //     - busy 仍被持有 ⇒ 把手上的目标放回 pending，交回 drainPending()
      //       在 busy 释放后统一处理（补播或直达），本函数不 push、不清空。
      //     - busy 已释放   ⇒ 直接 start() 补播一轮，让第二次点击也走转场；
      //       仅当 start() 被拒（极不可能：刚判过 busy）才退回静默 push，保证「绝不无响应」。
      if (busy) {
        if (!pending) pending = p;
        releaseSettled(true);
        return;
      }

      if (!start(p.path, p.dir, true)) {
        Promise.resolve(router.push(p.path))
          .catch(() => {})
          .then(() => releaseSettled(true));
        return;
      }
      releaseSettled(true);
    }

    /* ---------------------------------------------------- toReveal() */

    // 参考站 g()：擦入盖住后切路由，再等一帧把 phase 推到 'reveal'（触发反向擦出）。
    function toReveal() {
      if (enteredReveal || !busy) return;
      enteredReveal = true;

      const target = targetPath;
      // 参考站：目标路径 === 当前路径时跳过 1500ms 就绪等待，只等 440ms。
      const samePath = target === route.path;
      // ★ 必须【无条件登记】就绪信号：它兼任「取消上一轮等待」的竞态守卫
      //   （registerReadySignal 是全局单槽，后登记顶掉前登记）。即使下面用竞速，
      //   也不能因为「push 可能更快」就不登记 —— 否则上一轮的悬挂等待不会被顶掉。
      const readySignal = samePath ? Promise.resolve() : registerReadySignal(READY_SIGNAL_MS);
      const minCover = new Promise((resolve) => later(resolve, MIN_COVER_MS));

      // ★ 移植取舍：参考站 here 还有一层 cinemaMode 业务 —— 它把 /cinema 当作「首页的一个模式」，
      //   目标为 /cinema 时 push 到 '/' 并 setCinemaMode(true)，当前已在 /cinema 时反向。
      //   我方 /cinema 是独立路由（src/router/index.js 里就是普通一条），语义不同，
      //   故【不模拟 cinemaMode】，直接 push 目标路径。这不是漏抄，是刻意取舍。
      //
      // ★ 关键时序：push 发生在 await 之前、在 phase 变成 'reveal' 之前。
      //   此刻画面已被不透明 .ptr-panel 完全盖住，旧页面消失不可见；先 push 再播动画会闪黑。
      // ★ 本轮的 deferred 在这里落定：play() 的 promise 要等它，而不是等一个跨轮共享的槽位。
      //   settlePush() 幂等，所以 animationend 与 900ms 兜底重复触发 toReveal/early-return
      //   都不会让 play() 永久悬挂。
      // ★ 方案 2（竞速）：把「本轮 push 落定」也纳入就绪条件。
      //   参考站的 1500ms 是给它自己 Next.js 异步渲染留的经验值；我方 push 之后
      //   新组件是同步挂载的，1500ms 就变成纯空等（实测 1483ms）。这里让 push 一落定
      //   就推进 reveal，push 慢时仍由 registerReadySignal(1500) 封顶。
      //   ★ 两个必须守住的点：
      //     (a) pushPromise 已经 .catch(()=>{}) 吞掉 reject，纳入竞速是安全的；
      //     (b) 绝不能丢掉 minCover 440ms —— 否则 push 极快时覆盖层还没铺满就开始擦出，
      //         会看到旧页面从擦缝里露出来。
      let pushSettled;
      const pushReady = new Promise((resolve) => { pushSettled = resolve; });
      if (!samePath) {
        // ★ pushInflight 与 push 严格成对：请求前置位，落地后（.then 第一行）清除。
        //   它是 drainPending() 的判据 —— 「本轮 push 还没落地时绝不许补播」。见 drainPending。
        pushInflight = true;
        // vue-router 在重复/被中止导航时会 reject，必须吞掉。
        // （参考站既未 await 也未 catch，那是 Next 的写法；Vue 下会变成 unhandled rejection。）
        Promise.resolve(router.push(target))
          .catch(() => {})
          .then(() => {
            settlePush();      // play() 的语义 = 本轮 push 已落地（内部清 pushInflight 并跑对账）
            pushSettled();     // 竞速的「新页面已就绪」信号
          });
      } else {
        settlePush();
        pushSettled();
      }

      const myGen = gen;
      Promise.all([Promise.race([readySignal, pushReady]), minCover]).then(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (myGen !== gen) return;
            if (state.value) state.value = { ...state.value, phase: 'reveal' };
            // 兜底：万一 ptr-wipe-out 的 animationend 没来（后台标签页被节流等）也能回到 idle。
            later(() => {
              if (myGen === gen) finish();
            }, REVEAL_FALLBACK_MS);
          });
        });
      });
    }

    /* ------------------------------------------------------ start() */

    // 参考站 j()：启动转场。busy 时返回 false，绝不静默吞掉调用方的意图。
    /**
     * @param {string} path
     * @param {'next'|'prev'} dir
     * @param {boolean} [isChain] 本次是 busy 期间为「用户改主意」补播的一轮。
     *   存在意义：补播轮同样要占满 busy，期间到达的 play() 依旧只进 pending；
     *   标记只用于日志/调试与 hitChainCap 的解释，不改变状态机时序。
     */
    function start(path, dir, isChain = false) {
      if (busy) return false;
      currentIsChain = isChain;
      // ★ 第一件事就压层级：下面 state.value 赋值后 Vue 的这轮更新会擦入覆盖层，
      //   标记必须早于它生效，否则前几帧导航栏仍压在覆盖层之上（可见的「穿透」）。
      setPtrActive(true);
      busy = true;
      enteredReveal = false;
      wentIdle = false;
      hitChainCap = false; // 新周期，补播上限标记重新计
      hitChainCapNotified = false;
      pushInflight = false; // 新一轮：本轮自己的 push 尚未发生
      targetPath = path;
      const myGen = ++gen;

      // 本轮专属的 deferred：play() 返回它，toReveal() 在 push 落定后 settle 它。
      // 上一轮若还没 settle（例如被 busy 守卫拒绝后一直没人 settle），这里直接放行，
      // 避免调用方的 await 永久悬挂。
      settlePush();
      let resolvePush;
      pushDeferred = { promise: new Promise((r) => { resolvePush = r; }), resolve: resolvePush };

      // 随机主题，且排除上一个（参考站 L.filter(t => t !== lastTheme)）
      const pool = ALL_THEMES.filter((t) => t !== lastTheme);
      const theme = pool[Math.floor(Math.random() * pool.length)];
      lastTheme = theme;

      state.value = {
        dir,
        phase: 'cover',
        card: META[path] || DEFAULT_META,
        theme,
      };

      // 参考站 start() 里的 900ms 兜底 -> toReveal（防 ptr-wipe-in 的 animationend 丢失）
      later(() => {
        if (myGen === gen) toReveal();
      }, START_FALLBACK_MS);
      return true;
    }

    /* ------------------------------------------------------- play() */

    /**
     * 对外唯一入口。
     * @param {string} path        目标路由
     * @param {'next'|'prev'} dir  方向（决定根元素上的 --ptr-x：next=1 / prev=-1）
     * @returns {Promise<boolean>} true  = 调用被接受（转场已启动，或 reduced 下已完成直接跳转，
     *                             或 busy 期间目标已记入 pending、由覆盖层负责送到）；
     *                             false = 覆盖层【此刻】无法接管这次导航，调用方应自行补一次
     *                                     router.push，绝不能因为拿到 false 就什么都不做。
     *
     * ★ 缺陷修复（问题 A）：busy 期间【永不返回 false】。
     *   旧实现 busy 时直接 return Promise.resolve(false)，调用方 src/App.vue:85 于是补一次
     *   裸 router.push；而此刻本轮 toReveal() 的 push 也可能在途，两次 push 互相中止
     *   （vue-router 后一次会 abort 前一次），实测最终停在错误的路由。
     *   现在：busy 时把目标覆盖进 pending（覆盖式，只保留最新），并把本次调用登记进
     *   settledWaiters，返回的 promise 在本轮收尾、目标真正落地后才 resolve(true)。
     *   调用方拿到的 true 语义依旧成立：「这次导航已经被接管且已完成」。
     *   false 只剩下一条产生路径：start() 拒绝 —— 而 start() 只在 busy 时拒绝，
     *   上方已经拦截，所以它实际不可达；保留它只是防御（例如将来有人在别处造出第 2 个实例）。
     */
    function play(path, dir = 'next') {
      // ★ 最早的守卫：prefers-reduced-motion 【或】 页面不可见。
      //   参考站把这道守卫放在导航入口 b() 里，原文是【两个并列条件】：
      //     if (matchMedia('(prefers-reduced-motion: reduce)').matches
      //         || document.visibilityState === 'hidden') { push(target); return; }
      //   命中时只有一次路由 push，return 之后什么都不做（无 setState / dataset / 转场）。
      //   App.vue 由 Lead 接线，这里【再守一道】，保证「reduce 或后台标签页时直接跳转
      //   不播动画」不依赖调用方实现。
      //   命中时不设 state、不加 class、不写内联 style、不排任何定时器 ——
      //   否则残留的 data-phase / --ptr-x 会被下一轮正常转场继承。
      //
      //   为什么 visibilityState === 'hidden' 这道条件是真的需要（不是学究）：
      //   1. 后台标签页里转场用户根本看不见，却会真的占用两层 rAF 与三条 .28s 动画；
      //   2. 标签页在后台时 rAF 被浏览器节流到几乎不跑，而 toReveal() 推进 reveal 正是
      //      依赖双层 rAF —— 这会让转场卡在 cover 直到 900ms 兜底，用户切回前台时
      //      看到的是一个卡住的覆盖层；
      //   3. 参考站正是为此加了这道守卫，复刻它才算真的复刻。
      //   防御性写法与下面一致：window / document / matchMedia 都可能不存在或不可读。
      if (
        (typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      ) {
        return Promise.resolve(router.push(path))
          .catch(() => {})
          .then(() => true);
      }

      const d2 = dir === 'prev' ? 'prev' : 'next';

      // ---- busy 分支：接管为 pending，绝不交还给调用方去裸 push ---------------
      // 这是问题 A 的正面修复。三点必须同时成立：
      //   (a) 覆盖式记录最新意图（pending 永远只有一个，乱点不会堆成转场队列）；
      //   (b) 不 push、不启动新转场 —— 当前轮还在跑，插进去会让两轮共享 state/gen；
      //   (c) 返回一个【会被放行】的 promise：drainPending() 与 reconcile() 都保证
      //       以 releaseSettled(true) 收尾，所以调用方的 await 不会悬挂。
      //
      // 补播上限命中后的语义：不再补播动画，等本轮收尾时由 drainPending() 静默 push
      // 到最新目标。play() 仍然返回 true —— 因为「已接管」这件事是真的：
      // 该目标确实会被送达，只是不再播第二轮擦除。调用方据此【不】补 push，
      // 也就不会出现「覆盖层的 push 与调用方的 push 互相中止」。
      if (busy) {
        pending = { path, dir: d2 };
        // 补播上限已命中：本轮收尾时只静默 push，不再播第二轮擦除。
        // 返回值仍为 true（接管成立），但绝不能因此让调用方以为「马上会有动画」。
        // 这里不做任何 UI，仅记录，便于日后排查「点了没动画但确实跳了」。
        if (hitChainCap && typeof console !== 'undefined') {
          // 只在命中上限后的第一次改写时提示，不刷屏
          if (!hitChainCapNotified) {
            hitChainCapNotified = true;
            console.info('[ptr] 补播轮数已达上限，本次改为静默跳转：' + path);
          }
        }
        return new Promise((resolve) => { settledWaiters.push(resolve); });
      }

      // 换目标了就把上一轮挂着的就绪信号摘掉（参考站 St()）
      if (path !== targetPath) dropReadySignal();

      if (!start(path, d2)) return Promise.resolve(false);
      // ★ 返回【本轮】的 deferred，而不是跨轮共享的槽位（见 pushDeferred 的说明）。
      const round = pushDeferred;
      return round.promise.then(() => true);
    }

    /* -------------------------------------------------- 生命周期清理 */

    onUnmounted(() => {
      clearTimers();
      dropReadySignal();
      settlePush(); // 组件卸载后不可能再有 push 落定，放行挂着的 play() 调用方
      setPtrActive(false); // 卸载兜底：html 上不留 data-ptr-active
      pending = null;
      releaseSettled(true); // 不等 settlePush 的早退路径：直接放行所有 busy 期间的 await play()
      state.value = null;
      busy = false;
      enteredReveal = false;
      wentIdle = false;
      gen++; // 让所有在途闭包失效
      lastTheme = null;
      targetPath = '';
    });

    expose({ play });

    /* -------------------------------------------------------- 派生值 */

    const card = computed(() => (state.value ? state.value.card : DEFAULT_META));
    const dir = computed(() => (state.value ? state.value.dir : 'next'));
    const phase = computed(() => (state.value ? state.value.phase : null));
    const letters = computed(() => Array.from(card.value.word));
    // 参考站：U = .3 + (H.length - 1) * .04 + .16，注入 --ptr-land 给 echo / ghost 用
    const landDelay = computed(() =>
      state.value ? (0.3 + (letters.value.length - 1) * 0.04 + 0.16).toFixed(4) + 's' : '0s'
    );

    const bigText = computed(() => (state.value ? buildBigText(card.value) : ''));
    const smallText = computed(() => (state.value ? buildSmallText(card.value) : ''));
    const bandText = computed(() => (state.value ? buildBandText(card.value) : ''));

    // 根元素 class：idle 态只有 ptr-root ptr-idle，【没有】ptr-theme-*（与参考站一致）
    const rootClass = computed(() => {
      const s = state.value;
      if (!s) return 'ptr-root ptr-idle' + (isAndroid ? ' ptr-android' : '');
      return (
        'ptr-root ptr-theme-' +
        s.theme +
        (isAndroid ? ' ptr-android' : '') +
        (s.phase === 'idle' ? ' ptr-idle' : '')
      );
    });

    const rows = [1, 2, 3, 4, 5, 6];
    const streakIndexes = [1, 2, 3, 4, 5, 6];

    return {
      state, rootClass, card, dir, phase,
      letters, landDelay, bigText, smallText, bandText,
      rows, streakIndexes, isAndroid,
      play, onWipeAEnd, onWipeMainEnd,
    };
  },
};
</script>

<template>
  <Teleport to="body">
    <div
      :class="rootClass"
      :data-phase="phase || undefined"
      :style="state ? { '--ptr-x': dir === 'next' ? 1 : -1 } : undefined"
      aria-hidden="true"
    >
      <template v-if="state">
        <div class="ptr-wipe ptr-wipe-a" @animationend="onWipeAEnd">
          <div class="ptr-wipe-fill"></div>
        </div>

        <div class="ptr-wipe ptr-wipe-b">
          <div class="ptr-wipe-fill"></div>
        </div>

        <div class="ptr-wipe ptr-wipe-main" @animationend="onWipeMainEnd">
          <div class="ptr-panel">
            <div class="ptr-halftone"></div>
            <div class="ptr-band ptr-band-1"><span class="ptr-band-text">{{ bandText }}</span></div>
            <div class="ptr-band ptr-band-2"><span class="ptr-band-text">{{ bandText }}</span></div>
            <div class="ptr-band ptr-band-3"><span class="ptr-band-text">{{ bandText }}</span></div>
            <div class="ptr-rows">
              <div v-for="n in rows" :key="n" :class="'ptr-row ptr-row-' + n">
                <span>{{ n % 2 === 1 ? smallText : bigText }}</span>
              </div>
            </div>
            <div class="ptr-scanlines"></div>
          </div>

          <div class="ptr-mark">{{ card.mark }}</div>

          <div class="ptr-title" :style="{ '--ptr-land': landDelay }">
            <div class="ptr-title-word">
              <span class="ptr-title-echo">{{ card.word }}</span>
              <span class="ptr-title-ghost ptr-title-ghost-c">{{ card.word }}</span>
              <span class="ptr-title-ghost ptr-title-ghost-m">{{ card.word }}</span>
              <span class="ptr-title-main">
                <span
                  v-for="(ch, i) in letters"
                  :key="i"
                  class="ptr-letter"
                  :style="{ '--ptr-i': i }"
                >{{ ch }}</span>
              </span>
            </div>
            <div class="ptr-title-hazard"></div>
            <div class="ptr-title-chip">
              <span>{{ card.jp }}</span>
              <i></i>
              <span>{{ card.cn }}</span>
            </div>
          </div>

          <div class="ptr-corner-no">
            {{ card.no }}<em v-if="card.no !== 'EX'">/ 04</em>
          </div>
          <div class="ptr-corner-loading">NOW LOADING ▸▸▸</div>
          <div class="ptr-edge ptr-edge-left"></div>
          <div class="ptr-edge ptr-edge-right"></div>
        </div>

        <!-- streaks 是根元素的直接子节点，且仅非安卓渲染（参考站 !_.Bh && ...） -->
        <div v-if="!isAndroid" class="ptr-streaks">
          <span v-for="n in streakIndexes" :key="n" :class="'ptr-streak ptr-streak-' + n"></span>
        </div>

        <div class="ptr-flash"></div>
      </template>
    </div>
  </Teleport>
</template>
