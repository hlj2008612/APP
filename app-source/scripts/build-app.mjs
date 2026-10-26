#!/usr/bin/env node
// ================================================================
//  APK 构建：以「相对路径 + 绝对 API 基址」产出 dist
//  ----------------------------------------------------------------
//  为什么要单独一个脚本：
//   1. VITE_BASE 必须是 './'。APK 里页面源是 https://localhost（Capacitor），
//      gh-pages 那套 '/' 绝对路径会把 assets 指到域名根，直接白屏。
//   2. VITE_API_BASE 必须是后端的绝对地址。APK 里的页面源和目标 API
//      不同源，不走 window.__PW_API_BASE__ 就必须靠这个变量注入。
//   3. Windows 下无法用 `FOO=bar vite build` 这种 shell 语法，
//      又不能为这一个变量引入 cross-env，于是用 Node 起子进程。
//
//  可用环境变量覆盖：
//    PW_API_BASE  后端地址，默认读 .env.app，再退回内置默认值
// ================================================================
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    readFileSync,
    renameSync,
    rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 后端地址：优先环境变量，其次 .env.app 文件（换服务器时只改一处），
// 最后才是内置默认值 —— 保证任何机器上直接跑都有个能用的地址。
function resolveApiBase() {
    if (process.env.PW_API_BASE) return process.env.PW_API_BASE;
    const envFile = resolve(ROOT, '.env.app');
    if (existsSync(envFile)) {
        const m = readFileSync(envFile, 'utf8').match(/^\s*PW_API_BASE\s*=\s*(.+?)\s*$/m);
        if (m) return m[1].replace(/^["']|["']$/g, '');
    }
    return 'http://192.168.5.129:18000';
}

// ================================================================
//  把 public/images 临时移开再构建
//  ----------------------------------------------------------------
//  public/images 里是原项目自带的 23 张照片本地副本（full + thumbnails，
//  实测 46 个文件 3.71MB）。现在照片全部走 VM 后端的签名 URL 加载，
//  这些静态副本已无任何代码引用，留在包里只有两个后果：
//    1. APK 白白胖 3.7MB；
//    2. 更严重 —— 任何人把 APK 当 zip 解开就能看到全部照片，
//       这与「照片存在虚拟机里受保护」的目标正好相反。
//  vite.config.js 是 copyPublicDir:true，所以只能在这里动手；
//  构建结束无论成败都移回去，保证工作区不被弄脏。
// ================================================================
const PUBLIC_IMAGES = resolve(ROOT, 'public', 'images');
const STASH_DIR = resolve(ROOT, '.public-images-stash');

function stashPublicImages() {
    if (!existsSync(PUBLIC_IMAGES)) return false;
    if (existsSync(STASH_DIR)) {
        rmSync(STASH_DIR, { recursive: true, force: true });
    }
    renameSync(PUBLIC_IMAGES, STASH_DIR);
    return true;
}

function restorePublicImages(stashed) {
    if (!stashed) return;
    if (existsSync(STASH_DIR) && !existsSync(PUBLIC_IMAGES)) {
        renameSync(STASH_DIR, PUBLIC_IMAGES);
    }
}

// ================================================================
//  APK 产物里不该出现「只对 Web 托管有意义」的文件
//  ----------------------------------------------------------------
//  public/_headers 是给 Cloudflare Pages / Netlify 这类平台用的响应头配置，
//  GitHub Pages 与 APK 都不认它。它被打进 APK 的实际后果：
//    1. 白白增加体积；
//    2. 更糟 —— 它让「我们配了 CSP / X-Frame-Options」看起来成立，
//       实际在 APK 与 gh-pages 上都不生效，安全评审时极易被误判为已加固。
//  CNAME 同理（只会误导自定义域名配置）。
//  产物里删掉即可；下次 vite build 会从 public/ 重新复制，源头不会丢。
// ================================================================
const WEB_ONLY_FILES = ['_headers', 'CNAME'];

function stripWebOnlyFiles() {
    const removed = [];
    for (const name of WEB_ONLY_FILES) {
        const p = resolve(ROOT, 'dist', name);
        if (existsSync(p)) {
            rmSync(p, { force: true });
            removed.push(name);
        }
    }
    return removed;
}

const apiBase = resolveApiBase();
console.log(`[build-app] 后端地址 = ${apiBase}`);
console.log('[build-app] 资源基址 = ./  (APK 内相对路径)');

const stashed = stashPublicImages();
console.log(`[build-app] public/images ${stashed ? '已临时移开（照片走后端）' : '不存在，跳过'}`);

let exitCode = 1;
try {
    const env = {
        ...process.env,
        VITE_BASE: './',
        VITE_API_BASE: apiBase,
    };
    // 用当前 node 直接调 vite 的 bin，避免依赖 npx 的 shell 转义
    const viteBin = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const r = spawnSync(process.execPath, [viteBin, 'build'], {
        cwd: ROOT,
        env,
        stdio: 'inherit',
    });
    exitCode = r.status ?? 1;
} finally {
    restorePublicImages(stashed);
    console.log('[build-app] public/images 已还原');
}

if (exitCode !== 0) {
    console.error('[build-app] 构建失败');
    process.exit(exitCode);
}

const stripped = stripWebOnlyFiles();
console.log(`[build-app] 已剔除 Web 专用文件：${stripped.length ? stripped.join(', ') : '（无）'}`);
console.log('[build-app] 完成，产物在 dist/');
