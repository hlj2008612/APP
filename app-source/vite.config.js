import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';

// ================================================================
//  照片墙构建配置
//  ---------------------------------------------------------------
//  目标：
//   1. vue + vue-router 合并成主包，产物按 js / css / img 分目录。
//   2. 所有产物带内容哈希，按 js / css / img 分目录，可长期强缓存。
//   3. 构建结束时用 Node 内置 zlib 打印 raw / gzip / brotli 体积表，
//      并写出 dist/.build-report.json —— 这是性能结论的证据，
//      不引入任何新的 npm 依赖。
// ================================================================

/**
 * 构建体积报告插件。
 * 在 writeBundle 阶段读取每个已落盘产物，用 zlib 计算 gzip / brotli，
 * 打印表格并写出 dist/.build-report.json。
 */
/**
 * 清空 dist/ 顶层的陈旧产物（保留 .git，由调用方决定是否删除）。
 *
 * ⚠️ 为什么不能只靠 build.emptyOutDir（本机已实测，别再想当然）：
 * Vite 的 emptyDir() 用的是【同步】fs.rmSync(path, { recursive: true, force: true })
 * （node_modules/vite/dist/node/chunks/node.js:2375）。
 * 而在本机 Node v24.12.0 上 rmSync 会【静默返回且不删除任何东西】——不抛错、不警告：
 *   rmSync(非空目录, {recursive:true, force:true}) -> 目录仍在
 *   rmSync(普通文件, {force:true})                 -> 文件仍在
 *   rmdirSync(目录, {recursive:true})              -> 目录仍在
 * 而 unlinkSync / fs.promises.rm / fs.promises.unlink 均正常。
 *
 * 后果：dist/assets/ 永远清不掉，每次构建只在里面【新增】带新哈希的产物，
 * 旧产物无限累积。实测 dist/ 涨到 55 个文件，多出的 4 个全是历史版本的
 * index-*.css / index-*.js 等历史版本的产物，
 * 它们会被一并上传到服务器，体积随每次迭代线性增长。
 *
 * 为什么放在 buildStart：早于 Vite 写产物也早于 copyPublicDir 的拷贝。
 * public/ 里的 _headers、favicon.svg 等是在 emptyDir 之后才拷进 dist 的，
 * 所以此刻整体清空不会误删它们。
 */
async function removeStaleOutput() {
  const outDir = new URL('./dist/', import.meta.url);
  if (!existsSync(outDir)) return;

  for (const entry of readdirSync(outDir)) {
    // .git 交给调用方的守卫单独处理，避免和它的"是否删成功"判断打架
    if (entry === '.git') continue;
    // 用 join + fileURLToPath 之外的写法会踩 Windows 盘符，这里直接从 URL 还原
    await rm(new URL(entry, outDir), { recursive: true, force: true });
  }
}

function bundleSizeReport({ fileName = '.build-report.json' } = {}) {
  const outDirUrl = new URL('./dist/', import.meta.url);

  return {
    name: 'photo-wall:bundle-size-report',
    apply: 'build',
    enforce: 'post',

    /**
     * 发布前护栏：dist/ 是要被【手工上传】到服务器的站点根目录。
     * 历史上 dist/ 里混进过一个 105.93 MB 的 gh-pages worktree（dist/.git），
     * 而 dist/ 本身在 .gitignore 里，git status 永远看不到它 —— 于是每次部署
     * 都会把这 106 MB 一起传上去。
     *
     * ⚠️ 关键事实（已实测，别再假设 emptyOutDir 能兜住）：Vite 8 的 emptyOutDir
     * 【不会】删除 dist/.git —— 它反而把 ".git" 当成了要保留的例外。
     * 证据在 node_modules/vite/dist/node/chunks/node.js：
     *   :33642  if (emptyOutDir !== false && fs.existsSync(outDir)) emptyDir(outDir, [...].filter(Boolean), ".git");
     *   :2359   if (skip?.length) for (const file of skip) if (path.dirname(file) !== ".") { ... } else skipInDir.push(file);
     *   :2373   if (skipInDir.includes(file)) continue;
     * ".git" 不含路径分隔符，path.dirname(".git") === "."，于是它被塞进 skipInDir，
     * 在 :2373 被显式跳过。若 .git 里还有内容，emptyDir 还会递归进去（:2374）
     * 继续跳过同名前缀，所以一个完整的 .git 仓库能整块活过 emptyOutDir。
     *
     * 因此这里不能只 warning，必须真的删。buildStart 时 .git 还在，删掉它既清除了
     * 本次构建的发布污染，也让 Vite 后续的 emptyDir 无事可做。
     */
    async buildStart() {
      // 【第一步】无论 .git 守卫走哪个分支，都要先清掉上一次构建的陈旧产物。
      // 为什么必须自己做，见 removeStaleOutput 的说明。
      if (process.env.PHOTO_WALL_ALLOW_DIST_GIT !== '1') {
        await removeStaleOutput();
      }

      if (process.env.PHOTO_WALL_ALLOW_DIST_GIT === '1') return;

      const stale = new URL('.git', outDirUrl);
      if (!existsSync(stale)) return;

      // 注意：这里必须用【异步】的 fs.promises.rm，不能用 rmSync。
      // 本机运行时的同步递归删除是不可靠的：rmSync(path, {recursive:true, force:true})
      // 会静默返回而不删除任何东西（实测 unlinkSync / rmdirSync 正常，只有 rmSync 失效），
      // 而 fs.promises.rm 工作正常。构建前删不掉 .git，就等于把 106 MB 传上服务器。
      try {
        await rm(stale, { recursive: true, force: true });
      } catch (err) {
        this.error(
          'dist/.git exists and could not be removed (' +
            err.code +
            ': ' +
            err.message +
            '). dist/ is uploaded to the server BY HAND, so remove it before deploying.'
        );
        return;
      }

      if (existsSync(stale)) {
        this.error(
          'dist/.git still exists after removal — refusing to build a deployable dist/ ' +
            'that contains version-control data. Remove it manually, or re-run with ' +
            'PHOTO_WALL_ALLOW_DIST_GIT=1 to override.'
        );
        return;
      }

      this.warn(
        'dist/.git existed and has been REMOVED before building. Vite\'s emptyOutDir does ' +
          'NOT delete dist/.git (it is passed as a skip entry to emptyDir), and dist/ is ' +
          'uploaded to the server BY HAND, so this leftover version-control data would ' +
          'otherwise have been uploaded with every deploy.'
      );
    },

    // rolldown / rollup 通用钩子
    writeBundle(_options, bundle) {
      const rows = [];

      for (const [name, output] of Object.entries(bundle)) {
        if (!output || output.type === 'asset' && output.source == null) continue;

        let buf;
        try {
          // bundle 里的内容可能仍是内存态，统一按落盘文件读取，
          // 保证报告与最终发布产物完全一致。
          buf = readFileSync(new URL(name, outDirUrl));
        } catch {
          try {
            buf = Buffer.isBuffer(output.source)
              ? output.source
              : typeof output.source === 'string'
                ? Buffer.from(output.source)
                : Buffer.from(output.code ?? '', 'utf8');
          } catch {
            continue;
          }
        }

        const raw = buf.length;
        const gzip = gzipSync(buf, { level: 9 }).length;
        const brotli = brotliCompressSync(buf, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
        }).length;

        rows.push({
          file: name,
          type: output.type,
          rawBytes: raw,
          gzipBytes: gzip,
          brotliBytes: brotli,
        });
      }

      rows.sort((a, b) => b.rawBytes - a.rawBytes);

      const kb = (n) => (n / 1024).toFixed(2);
      const ratio = (n, r) => `${((n / r) * 100).toFixed(1)}%`;

      const totals = rows.reduce(
        (acc, r) => {
          acc.rawBytes += r.rawBytes;
          acc.gzipBytes += r.gzipBytes;
          acc.brotliBytes += r.brotliBytes;
          return acc;
        },
        { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }
      );

      const pad = (s, n) => String(s).padEnd(n);
      const padL = (s, n) => String(s).padStart(n);

      const lines = [];
      lines.push('');
      lines.push('  Photo-wall bundle size report (zlib gzip -9 / brotli -q11)');
      lines.push('  ' + '-'.repeat(74));
      lines.push(
        '  ' +
          pad('file', 34) +
          padL('raw', 11) +
          padL('gzip', 11) +
          padL('brotli', 11) +
          padL('br/raw', 9)
      );
      lines.push('  ' + '-'.repeat(74));
      for (const r of rows) {
        lines.push(
          '  ' +
            pad(r.file, 34) +
            padL(`${kb(r.rawBytes)} kB`, 11) +
            padL(`${kb(r.gzipBytes)} kB`, 11) +
            padL(`${kb(r.brotliBytes)} kB`, 11) +
            padL(ratio(r.brotliBytes, r.rawBytes), 9)
        );
      }
      lines.push('  ' + '-'.repeat(74));
      lines.push(
        '  ' +
          pad(`TOTAL (${rows.length} files)`, 34) +
          padL(`${kb(totals.rawBytes)} kB`, 11) +
          padL(`${kb(totals.gzipBytes)} kB`, 11) +
          padL(`${kb(totals.brotliBytes)} kB`, 11) +
          padL(ratio(totals.brotliBytes, totals.rawBytes), 9)
      );
      lines.push('');

      this.info(lines.join('\n'));

      const report = {
        generatedAt: new Date().toISOString(),
        base: process.env.VITE_BASE || '/',
        total: totals,
        files: rows,
      };

      // writeBundle 是同步钩子，用 emitFile 保证报告进入 dist/
      this.emitFile({
        type: 'asset',
        fileName,
        source: JSON.stringify(report, null, 2) + '\n',
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), bundleSizeReport()],

  // 子路径部署：VITE_BASE=/repo-name/ npm run build
  base: process.env.VITE_BASE || '/',

  build: {
    target: 'es2018',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,

    // 显式声明：dist/ 是【手工上传】的站点根目录。必须为 true，
    // 否则上一次构建的陈旧产物（以及历史遗留的 dist/.git）会残留在发布目录里。
    // 注意：该值只在 outDir 位于 root 内时默认为 true —— 这里显式写出，不依赖默认值。
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 600,
    modulePreload: { polyfill: true },

    rolldownOptions: {
      output: {
        // 产物带内容哈希 + 分目录，配合 public/_headers 的 immutable 缓存
        entryFileNames: 'assets/js/[name]-[hash].js',
        chunkFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const source = String(
            assetInfo.names?.[0] ?? assetInfo.originalFileNames?.[0] ?? assetInfo.name ?? ''
          );
          const ext = source.slice(source.lastIndexOf('.')).toLowerCase();

          if (ext === '.css') return 'assets/css/[name]-[hash][extname]';
          if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico'].includes(ext)) {
            return 'assets/img/[name]-[hash][extname]';
          }
          if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) {
            return 'assets/fonts/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },

        // 手写分包：vue 全家桶合并成一个 vendor 主包。
        // （转场已改为纯 CSS 的 ptr 覆盖层，不再依赖 gsap，故无额外分包。）
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return null;
          if (/node_modules\/(vue|vue-router|@vue)\//.test(id.replace(/\\/g, '/'))) return 'vendor';
          return 'vendor';
        },
      },
    },

    // 照片墙的静态图片全部由 public/ 原样拷贝，不参与打包；
    // 这里的拷贝量很大（public/ 体积即为发布体积），构建会偏慢，属正常。
    copyPublicDir: true,
  },

  server: { host: true },
  preview: { host: true },
});
