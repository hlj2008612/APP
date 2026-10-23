#!/usr/bin/env node
/**
 * scripts/report-deploy-exclusions.mjs
 * ---------------------------------------------------------------------------
 * READ-ONLY. Reports which files under public/images/ are never referenced by
 * any source file or built asset, i.e. dead weight the web server still has to
 * serve. It NEVER deletes or moves anything - it prints a recommendation.
 *
 * Why this exists: public/images/zmq/*.jpg is 97 MB across 20 files and NOTHING
 * references it. Vite copies all of public/ into dist/ verbatim, so those bytes
 * ship to GitHub Pages and sit on disk, but no browser ever requests them.
 *
 * Usage:
 *   node scripts/report-deploy-exclusions.mjs
 *   node scripts/report-deploy-exclusions.mjs --json
 * ---------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_IMAGES = path.join(ROOT, 'public', 'images');

const AS_JSON = process.argv.slice(2).includes('--json');

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 ** 2).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** Collect the text of every file that could plausibly reference an image. */
function referenceCorpus() {
  const roots = [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'vite.config.js'),
    path.join(ROOT, 'public', '_headers'),
  ];
  const blobs = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const stat = fs.statSync(r);
    if (stat.isDirectory()) {
      for (const f of walk(r)) {
        if (/\.(js|mjs|ts|vue|css|html|json|md|txt)$/i.test(f)) blobs.push(fs.readFileSync(f, 'utf8'));
      }
    } else {
      blobs.push(fs.readFileSync(r, 'utf8'));
    }
  }
  return blobs.join('\n');
}

function main() {
  if (!fs.existsSync(PUBLIC_IMAGES)) {
    console.error('public/images/ not found at ' + PUBLIC_IMAGES);
    process.exit(1);
  }
  const corpus = referenceCorpus();
  const files = walk(PUBLIC_IMAGES).filter((f) => !/\.(py|map)$/i.test(f));

  const groups = new Map();
  let deadBytes = 0;
  let liveBytes = 0;

  for (const f of files) {
    const rel = path.relative(path.join(ROOT, 'public'), f).split(path.sep).join('/');
    const dirGroup = rel.split('/').slice(0, 2).join('/');
    const base = path.basename(f);
    // A file is referenced if its full relative path OR its bare filename appears.
    const referenced = corpus.includes(rel) || corpus.includes(base);
    const g = groups.get(dirGroup) || { dir: dirGroup, count: 0, bytes: 0, referenced: 0, unreferenced: 0, sample: [] };
    const size = fs.statSync(f).size;
    g.count += 1;
    g.bytes += size;
    if (referenced) {
      g.referenced += 1;
      liveBytes += size;
    } else {
      g.unreferenced += 1;
      deadBytes += size;
      if (g.sample.length < 3) g.sample.push(base + ' (' + fmtBytes(size) + ')');
    }
    groups.set(dirGroup, g);
  }

  const rows = [...groups.values()].sort((a, b) => b.bytes - a.bytes);

  if (AS_JSON) {
    console.log(JSON.stringify({ rows, deadBytes, liveBytes }, null, 2));
    return;
  }

  const rule = '-'.repeat(88);
  console.log('public/images/ deploy-exclusion report   (READ-ONLY - nothing is modified)');
  console.log(rule);
  console.log('  ' + 'dir'.padEnd(22) + 'files'.padStart(6) + 'ref'.padStart(6) + 'unref'.padStart(7) + 'size'.padStart(12) + '  status');
  console.log(rule);
  for (const g of rows) {
    const status = g.unreferenced === 0 ? 'all referenced' : g.referenced === 0 ? 'FULLY UNREFERENCED' : 'partially referenced';
    console.log('  ' + g.dir.padEnd(22) + String(g.count).padStart(6) + String(g.referenced).padStart(6) + String(g.unreferenced).padStart(7) + fmtBytes(g.bytes).padStart(12) + '  ' + status);
  }
  console.log(rule);
  console.log('  referenced  ' + fmtBytes(liveBytes));
  console.log('  unreferenced ' + fmtBytes(deadBytes) + '   <-- ships to the server, never requested');
  console.log('');

  const dead = rows.filter((g) => g.referenced === 0 && g.unreferenced > 0);
  if (dead.length) {
    console.log('RECOMMENDATION (not applied automatically):');
    for (const g of dead) {
      console.log('  * public/' + g.dir + '/  ' + g.unreferenced + ' files, ' + fmtBytes(g.bytes) + ' - no source file references these.');
      console.log('    e.g. ' + g.sample.join(', '));
    }
    console.log('');
    console.log('  They are user data, so this script will NOT delete them. To keep them');
    console.log('  out of the deployed site, add them to .gitignore AND ensure they are not');
    console.log('  copied into dist/ (Vite copies public/ verbatim). Keep the originals in a');
    console.log('  location outside public/ if you still want them in the repo.');
    console.log('');
    console.log('  Smallest reversible step: move public/images/zmq/ -> assets-src/images/zmq/');
    console.log('  That removes ' + fmtBytes(deadBytes) + ' from dist/ while keeping every byte in git.');
  } else {
    console.log('No fully-unreferenced image directories. Nothing to exclude.');
  }
}

main();
