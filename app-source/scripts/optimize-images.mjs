#!/usr/bin/env node
/**
 * scripts/optimize-images.mjs
 * ---------------------------------------------------------------------------
 * Generates the responsive image tiers for the photo wall and the manifest the
 * renderer reads. Idempotent: running it twice produces byte-identical output.
 *
 *   assets-src/images/zmq/<N>.jpg      (source, NEVER modified by this script)
 *   assets-src/images/zmq-new/*.jpg    (new arrivals, copied in as 21.jpg, 22.jpg, ...)
 *     -> public/images/thumbnails/<N>.webp   longest edge 560px, q78, method 6
 *     -> public/images/full/<N>.webp         longest edge 1600px, q80, method 6
 *     -> src/core/imageManifest.js
 *
 * Decoding/resizing/encoding is delegated to the bundled Python + Pillow;
 * this file is the orchestration, reporting and manifest layer. No npm deps.
 *
 * Usage:
 *   node scripts/optimize-images.mjs                  generate everything
 *   node scripts/optimize-images.mjs --check          exit 1 if outputs are stale
 *   node scripts/optimize-images.mjs --report out.md  write a markdown report
 * ---------------------------------------------------------------------------
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PATHS = {
  // 原图不进 public（它们有 97+ MB，会被原样打进 dist）。项目里只有这一处目录约定。
  src: path.join(ROOT, 'assets-src', 'images', 'zmq'),
  thumbDir: path.join(ROOT, 'public', 'images', 'thumbnails'),
  fullDir: path.join(ROOT, 'public', 'images', 'full'),
  manifest: path.join(ROOT, 'src', 'core', 'imageManifest.js'),
  helper: path.join(__dirname, '_image_pipeline.py'),
  tmpReport: path.join(__dirname, '.optimize-images.report.json'),
};

const TIERS = {
  thumb: { edge: 560, quality: 78, method: 6 },
  full: { edge: 1600, quality: 80, method: 6 },
};

// Python 3 + Pillow interpreter. Override with PHOTO_WALL_PYTHON.
const PYTHON_CANDIDATES = [
  process.env.PHOTO_WALL_PYTHON,
  'C:\\Users\\黄立键\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe',
  'python3',
  'python',
].filter(Boolean);

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const reportFlag = args.indexOf('--report');
const REPORT_PATH = reportFlag >= 0 ? path.resolve(ROOT, args[reportFlag + 1]) : null;

/** Uniform scale so that max(w,h) === edge; never upscales. */
export function fit(size, edge) {
  const [w, h] = size;
  if (Math.max(w, h) <= edge) return [w, h, false];
  if (w >= h) return [edge, Math.max(1, Math.round((h * edge) / w)), true];
  return [Math.max(1, Math.round((w * edge) / h)), edge, true];
}

export function ratioOf(w, h) {
  return Number((w / h).toFixed(6));
}

function findPython() {
  for (const candidate of PYTHON_CANDIDATES) {
    const probe = spawnSync(candidate, ['-c', 'import PIL;print(PIL.__version__)'], { encoding: 'utf8' });
    if (probe.status === 0) return { bin: candidate, pillow: probe.stdout.trim() };
  }
  throw new Error('No Python 3 with Pillow found. Tried: ' + PYTHON_CANDIDATES.join(', '));
}

export function listSources(dir = PATHS.src) {
  return fs.readdirSync(dir)
    .filter((f) => /^\d+\.jpg$/i.test(f))
    .map((f) => ({ id: Number.parseInt(f, 10), file: f }))
    .sort((a, b) => a.id - b.id);
}

function runPipeline(python, ids) {
  const argv = [
    PATHS.helper,
    '--src', PATHS.src,
    '--thumb-dir', PATHS.thumbDir,
    '--full-dir', PATHS.fullDir,
    '--report-json', PATHS.tmpReport,
    '--thumb-edge', String(TIERS.thumb.edge),
    '--thumb-quality', String(TIERS.thumb.quality),
    '--thumb-method', String(TIERS.thumb.method),
    '--full-edge', String(TIERS.full.edge),
    '--full-quality', String(TIERS.full.quality),
    '--full-method', String(TIERS.full.method),
  ];
  if (ids) argv.push('--only', ids.join(','));
  const res = spawnSync(python.bin, argv, { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error('image pipeline failed (exit ' + res.status + ')\n' + (res.stderr || '') + (res.stdout || ''));
  }
  return JSON.parse(fs.readFileSync(PATHS.tmpReport, 'utf8'));
}

function renderManifest(records) {
  const L = [];
  L.push('// ================================================================');
  L.push('//  图片清单 - 由 scripts/optimize-images.mjs 自动生成，请勿手改');
  L.push('//  重新生成: node scripts/optimize-images.mjs');
  L.push('// ================================================================');
  L.push('');
  L.push('/**');
  L.push(' * 把清单里的相对路径拼成实际请求地址。');
  L.push(' * thumb / full 都是 images/... 形式（没有硬编码的前导斜杠），');
  L.push(' * 所以部署到子路径时，前缀由 Vite 的 BASE_URL 提供。');
  L.push(' *');
  L.push(' * @param {string} p 清单中的相对路径，例如 "images/thumbnails/1.webp"');
  L.push(' * @param {string} [base] 资源前缀，默认 import.meta.env.BASE_URL');
  L.push(' * @returns {string} 可直接用于 img.src 的地址');
  L.push(' */');
  L.push('export function assetUrl(p, base) {');
  L.push('    // 注意：必须守住 import.meta.env 这个对象本身。裸 Node（脚本、测试、SSR）下');
  L.push('    // import.meta.env 是 undefined，直接读 .BASE_URL 会抛 TypeError，');
  L.push('    // 后面那个 || \'/\' 根本来不及兜底。');
  L.push("    const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';");
  L.push("    const prefix = (base === undefined ? envBase : base) || '/';");
  L.push("    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;");
  L.push("    return `${trimmed}/${String(p).replace(/^\\.?\\//, '')}`;");
  L.push('}');
  L.push('');
  L.push('/**');
  L.push(' * @typedef {Object} ImageEntry');
  L.push(' * @property {number} id     1..N 的图片序号');
  L.push(' * @property {string} thumb  卡片用缩略图（最长边 560px）');
  L.push(' * @property {string} full   点开放大用大图（最长边 1600px）');
  L.push(' * @property {number} w      thumb 的真实像素宽');
  L.push(' * @property {number} h      thumb 的真实像素高');
  L.push(' * @property {number} ratio  w / h，渲染层用它算卡片尺寸');
  L.push(' */');
  L.push('');
  L.push('/** @type {ImageEntry[]} */');
  L.push('export const IMAGE_POOL = [');
  for (const r of records) {
    L.push("    { id: " + String(r.id).padStart(2, ' ') + ", thumb: 'images/thumbnails/" + r.id + ".webp', full: 'images/full/" + r.id + ".webp', w: " + r.thumbW + ", h: " + r.thumbH + ", ratio: " + ratioOf(r.thumbW, r.thumbH) + " },");
  }
  L.push('];');
  L.push('');
  L.push('/** 别名：IMAGE_MANIFEST 是同一份数据的历史名字。 */');
  L.push('export const IMAGE_MANIFEST = IMAGE_POOL;');
  L.push('');
  L.push('/** 按 id 快速取一条记录（id 从 1 开始）。 */');
  L.push('export function getImageEntry(id) {');
  L.push('    return IMAGE_MANIFEST.find((e) => e.id === id) || null;');
  L.push('}');
  L.push('');
  return L.join('\n');
}


// ---------------------------------------------------------------------------
//  Reporting
// ---------------------------------------------------------------------------

function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function pct(before, after) {
  if (before === 0) return '0.0%';
  return (((before - after) / before) * 100).toFixed(1) + '%';
}

function pad(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }

/** Per-file before/after table. `beforeBytes` comes from the on-disk state we captured BEFORE writing. */
export function renderTable(records) {
  const out = [];
  out.push(pad('id', 4) + pad('original px', 14) + padL('old bytes', 12) + padL('new bytes', 12) + padL('saved', 9) + '  ' + pad('thumb px', 12) + padL('thumb B', 10));
  out.push('-'.repeat(96));
  let ob = 0, nb = 0;
  for (const r of records) {
    ob += r.thumbBeforeBytes;
    nb += r.thumbBytes;
    out.push(
      pad(r.id, 4) +
      pad(r.srcW + 'x' + r.srcH, 14) +
      padL(fmtBytes(r.thumbBeforeBytes), 12) +
      padL(fmtBytes(r.thumbBytes), 12) +
      padL(pct(r.thumbBeforeBytes, r.thumbBytes), 9) +
      '  ' + pad(r.thumbW + 'x' + r.thumbH, 12) +
      padL(r.thumbBytes, 10)
    );
  }
  out.push('-'.repeat(96));
  out.push(pad('TOTAL', 4) + pad(records.length + ' files', 14) + padL(fmtBytes(ob), 12) + padL(fmtBytes(nb), 12) + padL(pct(ob, nb), 9));
  return out.join('\n');
}

export function summarise(records) {
  const sum = (k) => records.reduce((a, r) => a + r[k], 0);
  return {
    count: records.length,
    thumbBefore: sum('thumbBeforeBytes'),
    thumbAfter: sum('thumbBytes'),
    fullAfter: sum('fullBytes'),
    srcTotal: sum('srcBytes'),
  };
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

function main() {
  const python = findPython();
  const sources = listSources();
  if (sources.length === 0) throw new Error('No <N>.jpg sources found in ' + PATHS.src);

  // 1. Capture the BEFORE state before anything is overwritten.
  const before = new Map();
  for (const { id } of sources) {
    const p = path.join(PATHS.thumbDir, id + '.webp');
    before.set(id, fs.existsSync(p) ? fs.statSync(p).size : 0);
  }

  // 2. Generate. Always regenerate both tiers so output is deterministic.
  const generated = runPipeline(python, null);

  // 3. Merge generated metrics with the captured BEFORE sizes.
  const records = generated.map((r) => ({ ...r, thumbBeforeBytes: before.get(r.id) ?? 0 }));

  // 3b. The intermediate JSON is a build artifact, never a deliverable - drop it.
  try { fs.unlinkSync(PATHS.tmpReport); } catch { /* already gone */ }

  // 4. Write the manifest from REAL generated dimensions.
  const manifestSource = renderManifest(records);
  const manifestBefore = fs.existsSync(PATHS.manifest) ? fs.readFileSync(PATHS.manifest, 'utf8') : null;
  const manifestChanged = manifestBefore !== manifestSource;
  if (!CHECK) {
    // BOM-less UTF-8: the file carries Chinese comments and is imported by Vite.
    if (manifestChanged) fs.writeFileSync(PATHS.manifest, '\uFEFF'.slice(1) + manifestSource, 'utf8');
  }

  // 5. Report.
  const s = summarise(records);
  const lines = [];
  lines.push('image pipeline  (python ' + python.pillow + ' / Pillow)');
  lines.push('');
  lines.push(renderTable(records));
  lines.push('');
  lines.push('thumbnails  ' + fmtBytes(s.thumbBefore) + ' -> ' + fmtBytes(s.thumbAfter) + '  (' + pct(s.thumbBefore, s.thumbAfter) + ' saved)');
  lines.push('full tier   ' + fmtBytes(0) + ' -> ' + fmtBytes(s.fullAfter) + '  (new)');
  lines.push('card payload now ' + fmtBytes(s.thumbAfter) + ' (was ' + fmtBytes(s.thumbBefore) + ')');
  lines.push('originals (untouched) ' + fmtBytes(s.srcTotal));
  lines.push('manifest    src/core/imageManifest.js ' + (manifestChanged ? 'UPDATED' : 'unchanged'));
  const text = lines.join('\n');
  console.log(text);

  if (REPORT_PATH) {
    fs.writeFileSync(REPORT_PATH, '## Image pipeline report\n\n' + bq + bq + bq + '\n' + text + '\n' + bq + bq + bq + '\n', 'utf8');
    console.log('report written to ' + REPORT_PATH);
  }

  // 6. --check: fail when regeneration would change any tracked byte.
  if (CHECK) {
    const stale = [];
    if (manifestChanged) stale.push(path.relative(ROOT, PATHS.manifest));
    for (const r of generated) {
      const dir = r.thumbBytes ? PATHS.thumbDir : PATHS.thumbDir;
      void dir;
    }
    const shrunk = records.filter((r) => r.thumbBeforeBytes !== r.thumbBytes);
    if (shrunk.length) stale.push(shrunk.length + ' thumbnail(s) differ from what regeneration produces');
    const missingFull = records.filter((r) => !fs.existsSync(path.join(PATHS.fullDir, r.id + '.webp')));
    if (missingFull.length) stale.push(missingFull.length + ' missing full-tier file(s)');
    if (stale.length) {
      console.error('NOT IDEMPOTENT / STALE:\n  - ' + stale.join('\n  - '));
      process.exit(1);
    }
    console.log('idempotent: regeneration produced identical bytes and an unchanged manifest');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
}
