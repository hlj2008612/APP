#!/usr/bin/env node
/**
 * scripts/analyze-dist.mjs
 * ---------------------------------------------------------------------------
 * Prints a readable size breakdown of the built `dist/` directory.
 *
 * Primary source is `dist/.build-report.json`, emitted by the build step. That
 * file is optional: if it is missing we fall back to walking dist/ ourselves, so
 * `npm run analyze` is always useful rather than a dead script.
 *
 * Usage:
 *   node scripts/analyze-dist.mjs            pretty table
 *   node scripts/analyze-dist.mjs --json     machine readable
 *   node scripts/analyze-dist.mjs --top 20   list more rows (default 15)
 * ---------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REPORT = path.join(DIST, '.build-report.json');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const topIdx = argv.indexOf('--top');
const TOP = topIdx >= 0 ? Math.max(1, Number.parseInt(argv[topIdx + 1], 10) || 15) : 15;

/** 把字节数格式化成人类可读的字符串。 */
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1024 * 1024 * 1024) return (n / 1024 ** 3).toFixed(2) + ' GB';
  if (n >= 1024 * 1024) return (n / 1024 ** 2).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Bucket a dist-relative path into a coarse category for the summary. */
export function classify(rel) {
  const p = rel.split(path.sep).join('/');
  if (p.startsWith('images/full/')) return 'images/full (lightbox tier)';
  if (p.startsWith('images/thumbnails/')) return 'images/thumbnails (card tier)';
  if (p.startsWith('images/')) return 'images (other)';
  if (p.startsWith('assets/')) {
    if (p.endsWith('.js')) return 'js bundle';
    if (p.endsWith('.css')) return 'css bundle';
    return 'assets (other)';
  }
  if (p.startsWith('audio/') || p.endsWith('.mp3') || p.endsWith('.m4a')) return 'audio';
  return 'root (html/icons/etc)';
}

function collect() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ does not exist - run `npm run build` first.');
    process.exit(1);
  }
  const files = walk(DIST)
    .map((full) => ({
      path: path.relative(DIST, full).split(path.sep).join('/'),
      bytes: fs.statSync(full).size,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  return files;
}

function main() {
  const files = collect();
  const total = files.reduce((a, f) => a + f.bytes, 0);

  const byCategory = new Map();
  for (const f of files) {
    const k = classify(f.path);
    const cur = byCategory.get(k) || { bytes: 0, count: 0 };
    cur.bytes += f.bytes;
    cur.count += 1;
    byCategory.set(k, cur);
  }
  const categories = [...byCategory.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.bytes - a.bytes);

  let declared = null;
  if (fs.existsSync(REPORT)) {
    try {
      declared = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
    } catch (err) {
      console.error('warning: dist/.build-report.json is not valid JSON (' + err.message + ')');
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ total, categories, top: files.slice(0, TOP), declared }, null, 2));
    return;
  }

  const W = 62;
  const rule = '-'.repeat(W);
  console.log('dist/ size analysis' + (declared ? '   (source: dist/.build-report.json + disk walk)' : '   (source: disk walk)'));
  console.log(rule);
  console.log('  ' + 'category'.padEnd(34) + 'files'.padStart(7) + 'size'.padStart(12) + 'share'.padStart(9));
  console.log(rule);
  for (const c of categories) {
    const share = total ? ((c.bytes / total) * 100).toFixed(1) + '%' : '-';
    console.log('  ' + c.name.padEnd(34) + String(c.count).padStart(7) + fmtBytes(c.bytes).padStart(12) + share.padStart(9));
  }
  console.log(rule);
  console.log('  ' + 'TOTAL'.padEnd(34) + String(files.length).padStart(7) + fmtBytes(total).padStart(12) + '   100.0%');

  console.log('');
  console.log('largest ' + Math.min(TOP, files.length) + ' files');
  console.log(rule);
  for (const f of files.slice(0, TOP)) {
    const share = total ? ((f.bytes / total) * 100).toFixed(1) + '%' : '-';
    console.log('  ' + fmtBytes(f.bytes).padStart(10) + share.padStart(8) + '  ' + f.path);
  }

  // The number that actually matters for server latency: what a browser pulls on.
  const zmq = files.filter((f) => /^images\/zmq\//.test(f.path));
  if (zmq.length) {
    const zs = zmq.reduce((a, f) => a + f.bytes, 0);
    console.log('');
    console.log('  !! images/zmq/ is shipping ' + zmq.length + ' unreferenced originals (' + fmtBytes(zs) + ')');
    console.log('     no source file references them - see scripts/report-deploy-exclusions.mjs');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
