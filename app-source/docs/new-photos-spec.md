# 新照片接入规格（主理人已核实）

> 本轮要往项目里加 3 张新照片，**不改布局**，只增加照片。

## 源文件位置

`D:\桌面\photo-wall-vue\assets-src\images\zmq-new\` 下 3 张 JPG（主理人已从 `新加照片/` 复制过来）：

```
66d32b36cce163ccc2229eb51fad858f.jpg   1279 x 1890   1419 KB
94a2bb6c7edb2b97211dc62cc579fce1.jpg   1728 x 2188   2244 KB
dfa33f608094341a24f468f452668446.jpg    960 x 1280     74 KB
```

全部是 RGB JPEG。

## 目标格式（用户明确要求「照片放进项目时改格式」）

沿用项目既有的两级 WebP 管线，**不引入新格式**：

- `public/images/thumbnails/<id>.webp` — 最长边 560px，quality 78，method 6
- `public/images/full/<id>.webp` — 最长边 1600px，quality 80，method 6

即新照片的 id 是 **21、22、23**（接在现有 20 张之后）。

## 现有管线

`scripts/optimize-images.mjs` + `scripts/_image_pipeline.py`，配置在 optimize-images.mjs 第 30-43 行：

```js
const PATHS = {
  src: path.join(ROOT, 'public', 'images', 'zmq'),      // ← 源目录
  thumbDir: path.join(ROOT, 'public', 'images', 'thumbnails'),
  fullDir: path.join(ROOT, 'public', 'images', 'full'),
  manifest: path.join(ROOT, 'src', 'core', 'imageManifest.js'),
};
const TIERS = {
  thumb: { edge: 560, quality: 78, method: 6 },
  full: { edge: 1600, quality: 80, method: 6 },
};
```

`listSources()` 只认 `/^\d+\.jpg$/i` 的文件名（第 79 行），源文件名必须是纯数字。

## 关键约束

1. **不要改 TIERS 参数**，新照片必须和现有 20 张用同一套参数，否则视觉不一致。
2. **不要动现有 20 张的任何产物**（thumbnails/1-20.webp、full/1-20.webp 必须字节不变）。
3. 生成后 `src/core/imageManifest.js` 必须有 **23 条**记录，id 1..23，新旧记录顺序稳定。
4. manifest 的 `w`/`h` 必须是 thumb 文件的**真实像素尺寸**（不是 full 的，也不是原图的）。
5. `ratio = w / h`，保留 6 位小数（与现有格式一致）。
6. `src/core/config.js:5` 的 `TOTAL_IMAGES = 20` **必须同步改成 23** —— 这是硬编码的，不改会导致照片墙网格少一块。
7. 幂等性必须保持：连跑两次 `node scripts/optimize-images.mjs`，全部产物 SHA256 不变。
8. `node scripts/optimize-images.mjs --check` 必须 exit 0。

## 验证要求

- 用 Pillow 打开全部 23 张 thumb 和 23 张 full，确认 format=WEBP 且 `im.load()` 能完整解码
- 确认 23 张 thumb 最长边 ≤ 560，23 张 full 最长边 ≤ 1600
- 确认 manifest 的 w/h 与 Pillow 读到的真实尺寸 0 处不符
- 确认旧 20 张文件 SHA256 与改动前一致
- 报告总字节数变化

## 禁止

- 不改 `public/images/full/` 的用途（它本来就没接进 UI，保持现状）
- 不改渲染逻辑、不改卡片尺寸公式、不改布局
- 不提交 git