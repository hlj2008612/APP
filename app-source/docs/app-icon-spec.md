# 美琴的照片墙 · APP 图标设计规范

> 适用范围：Capacitor Android 包 `cc.ccwu.zmq.photowall`
> 设计资产：`android/icon-preview/`（1024 画板 + 安全区参考 + 尺寸阵列）
> 对比页：`docs/app-icon-preview.html`（浏览器直接打开）
> 生成脚本：`android/make_icons_v2.py`（三方案共用一套绘制代码，改色改形都在这里）
> 本文所有尺寸、颜色、路径均已对照工程实际文件核对。

---

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 当前已落地 | **方案 C「叠卡」**（`--apply c` 已执行，res 内资源已替换） |
| 画板 | 1024 × 1024，设计坐标系 108dp |
| 安全区 | 108dp 画布中央 **66 × 66dp**（x,y ∈ [21, 87]），前景主体必须全部落在里面 |
| 深色/浅色 | 圆形遮罩下三方案均未越界；深色壁纸下 C 最稳，浅色壁纸下 B 最稳 |
| 已修的真实缺陷 | `AppTheme` 引用了不存在的 `@color/colorPrimary` 等 → 资源链接失败；启动图仍是 Capacitor 默认白底 X 标；无 `installSplashScreen()` |
| 备份 | `android/icon-backup-c/`（首次落地前的原始资源快照） |

> 挑选方式：看 `docs/app-icon-preview.html` → 决定后执行
> `py make_icons_v2.py --apply a|b|c` → 重新打包 APK。

---

## 1. 设计规范

### 1.1 画板与坐标系

| 名称 | 数值 | 说明 |
|---|---|---|
| 设计画板 | 1024 × 1024 px | 交付给设计师/Figma 的母版，含完整背景 + 前景 |
| 设计坐标系 | 108 × 108 dp | Android 自适应图标的官方画布，1dp = 1024/108 ≈ 9.48px |
| 自适应层 | 每层独立 108dp 图 | 背景层 + 前景层分别导出，系统叠合并裁剪 |
| 超采样 | ×4 后 LANCZOS 降采样 | 避免小尺寸锯齿，脚本内 `SS=4` |

### 1.2 自适应图标的分层与安全区

```
┌──────────────────────────────┐ 108dp
│ 外 18dp：任何形状都可能被裁掉  │
│   ┌──────────────────────┐   │
│   │                      │   │ ← 72dp 可见区（方形/圆角方形遮罩）
│   │   ┌──────────────┐   │   │
│   │   │ 66dp 安全区  │   │   │ ← 前景主体 100% 落在这里
│   │   │  x,y ∈[21,87]│   │   │
│   │   └──────────────┘   │   │
│   │                      │   │
│   └──────────────────────┘   │
└──────────────────────────────┘
          104dp 直径：圆形 / 水滴 / 松鼠等激进遮罩
```

| 遮罩类型 | 可见范围 | 前景主体要求 |
|---|---|---|
| 方形 / 圆角方形（多数国产 ROM） | 72dp 见方 | 落在 66dp 安全区 |
| **圆形**（Pixel、原生、部分定制 ROM） | 直径 104dp | 对角线方向只能到 66dp，所以**四角留白是必须的** |
| 水滴 / 松鼠（部分三星、OPPO） | 104dp + 挖角 | 同圆形，且左上/右上不能有主体 |

> 验收方法：`android/icon-preview/sheet-*.png` 第 2 格。青色方框 = 66dp 安全区，
> 黄色方框 = 72dp 可见区，红色圆 = 104dp 最凶遮罩。三套方案的图形都在青框内。

### 1.3 圆角与遮罩适配

- **不要自己画圆角或圆图**。自适应图标由系统套遮罩；自己再加圆角会被二次裁切，出现"圆里套圆"的毛边。
- 旧系统（API < 26）没有自适应机制，必须提供预先做好圆角的 `ic_launcher.png` 和圆形 `ic_launcher_round.png`，脚本已按圆角半径 = 边长 22% 生成。
- 前景里的**卡片本身**可以有圆角（视觉元素），但**整张画布不能有圆角边框**。

### 1.4 尺寸表（mdpi ～ xxxhdpi）

| 密度 | 倍率 | `ic_launcher.png` / `ic_launcher_round.png`（48dp） | `ic_launcher_foreground/background/monochrome.png`（108dp） | `ic_stat_photowall.png`（24dp） |
|---|---|---|---|---|
| mdpi | 1× | 48 × 48 | 108 × 108 | 24 × 24 |
| hdpi | 1.5× | 72 × 72 | 162 × 162 | 36 × 36 |
| xhdpi | 2× | 96 × 96 | 216 × 216 | 48 × 48 |
| xxhdpi | 3× | 144 × 144 | 324 × 324 | 72 × 72 |
| xxxhdpi | 4× | 192 × 192 | 432 × 432 | 96 × 96 |

> 上表是实测输出，不是推导值。脚本落地后会自检前景层边长是否等于 `108 × 倍率`。

### 1.5 深色 / 浅色适配

**原则**：图标本身不跟随系统深浅色变化（Android 没有"图标暗色模式"这一说），
但要保证「深色壁纸」和「浅色壁纸」上都能看清。

| 方案 | 深色壁纸 | 浅色壁纸 | 结论 |
|---|---|---|---|
| A 叠片（深碧绿） | 好 | 尚可（白卡提供对比） | 偏暗，桌面深色时存在感弱 |
| B 网格墙（浅渐变） | 好 | **一般**（浅色壁纸下边缘发糊，靠描边撑） | 浅色壁纸下需加暗描边 |
| C 叠卡（深色） | **最好** | 好（白色相框对比强） | 深色 APP 的首选 |

**Android 13 主题化图标**（用户开了"主题图标"开关）：系统只取 `ic_launcher_monochrome`
的 **alpha 通道**着色，彩色会被丢掉。所以必须单独提供单色层，否则出现"灰黑一块"。
脚本已生成 `ic_launcher_monochrome.png`（一版放大到 90dp 宽的超大构图，避免主题化后过小）。

### 1.6 启动图标（Splash）

| 版本区间 | 机制 | 本工程落点 |
|---|---|---|
| API 22–25（minSdk 22） | `android:background` 贴一张整屏图 | `drawable/splash.png`、`drawable-port-*/splash.png`、`drawable-land-*/splash.png` |
| API 26–30 | `core-splashscreen` 库自绘居中图标 | `values/styles.xml` 的库属性 |
| API 31+ | 系统 SplashScreen（图标直径上限 192dp） | `values-v31/styles.xml` 的 `android:windowSplashScreen*` |

- 启动图标使用 **96dp** 直径（圆裁），居中于底色。
- 底色 `#0D0D0D` 必须三处一致：`values/splash_colors.xml` 的 `splash_background`、`values/ic_launcher_background.xml` 的 `ic_launcher_background`、`capacitor.config.json` 的 `SplashScreen.backgroundColor`（当前已是 `#0d0d0d`）。
- 启动图标用**前景层**而不是整图：整图贴上去系统会再套一次遮罩，深底叠深底，圆角处会露出一圈。

### 1.7 通知图标

| 项 | 规格 |
|---|---|
| 名称 | `ic_stat_photowall` |
| 尺寸 | 24dp，五档密度（24/36/48/72/96） |
| 颜色 | **纯白 #FFFFFF + 透明底**，系统只取 alpha 着色 |
| 造型 | 相框剪影：外框实心白，照片区挖空，山和太阳实心白 |
| 位置 | `res/drawable-{m,h,x,xx,xxx}dpi/ic_stat_photowall.png` |

> 通知栏图标**永远不要**用彩色或带透明背景的整图。本项目目前没有推送插件，
> 这些资源是给 `NotificationCompat.Builder#setSmallIcon(R.drawable.ic_stat_photowall)` 预留的。

---

## 2. 三套视觉方案

三套共用构图语言：**圆角相片 + 暖色点缀**，与网页端的暗底 + 紫色强调一致。
颜色值全部取自 `src/` 的实际代码，不是估值（来源见 `values/colors.xml` 注释）。

### 方案 A · 叠片（深碧绿）

| 项 | 值 |
|---|---|
| 定位 | 沿用现有图标的"三张叠放"构图，修正比例，更沉稳 |
| 背景 | 线性渐变 165°：`#0F3542` → `#0C2233` → `#080E18`；左上青光 `#1F8F8A` 70α，右下深蓝 `#123B5E` 80α |
| 前景 | 三张卡，宽 30dp × 高 40dp，圆角 4.6dp；后两张半透明白（78α / 96α），顶层实白卡 |
| 照片区 | `#123F4A` 底，山 `#7BE3C9`（前）/ `#3FBFA8`（后），太阳 `#F7E07A` |
| 文字条 | `#B9C6D4` + `#7D90A3` |
| 主体占位 | 宽约 47dp / 高约 40dp，落在 66dp 安全区内 |
| 图层结构 | ① 渐变底 ② 左上辉光 ③ 右下辉光 ‖ ④ 后卡 ⑤ 次卡 ⑥ 主白卡 ⑦ 照片底 ⑧ 两座山 ⑨ 太阳 ⑩ 两条文字条 |
| 启动底色 | `#0C2233` |
| 适合 | 想要"摄影感 + 沉稳"，和现在这张相近但更规整 |

### 方案 B · 网格墙（紫蓝渐变）

| 项 | 值 |
|---|---|
| 定位 | 最"照片墙"的方案，九宫格一眼是相册/画廊 |
| 背景 | 线性渐变 135°：`#8B6CE8` → `#4A9EFF`（直接取自 `--theme-color` 与登录页按钮色）；左上白色辉光 46α |
| 前景 | 3 × 3 网格，格 14dp、间距 3dp、圆角 3.4dp；5 格实白，4 格半透明 58α + 1.5dp 白描边（168α） |
| 中心格 | 紫色 `#5B43B8` 的"照片"意象（太阳 + 山） |
| 主体占位 | 54dp 见方 |
| 图层结构 | ① 紫蓝渐变底 ② 左上白色辉光 ‖ ③ 五格实白 ④ 四格描边 ⑤ 中心格图形 |
| 启动底色 | `#F3F0FF`（同色系浅底，避免深底吞掉图标） |
| 适合 | 想让图标更"亮"、更年轻、更贴近 APP 里面的紫蓝配色 |

### 方案 C · 叠卡（深色 + 紫蓝辉光）★ 已落地

| 项 | 值 |
|---|---|
| 定位 | 一张带白边相框的实拍照片 + 后面一张错位的"旧照片"，最像"照片"本身 |
| 背景 | 纯 `#0D0D0D`（= 网页 `--bg`）+ 左上紫辉光 `#8B6CE8` 150α + 右下蓝辉光 `#4A9EFF` 96α |
| 主卡 | 40dp × 34dp，圆角 3.8dp，白色相框 3.6dp |
| 照片内容 | 底 `#2A1A4E`；天空 `#6B4BC4`；山 `#B9A6FF`（前）/ `#8B6CE8`（后）；太阳 `#FFD166` |
| 后卡 | 34dp × 30dp，`#1E2A44` 底，`#CFE0FF` 小圆，`#3B5B87` 山 |
| 主体占位 | 宽 53dp × 高 44dp，全部在 66dp 安全区内 |
| 图层结构 | ① 纯黑底 ② 左上紫辉光 ③ 右下蓝辉光 ‖ ④ 后卡（实心）⑤ 后卡太阳 ⑥ 后卡山 ⑦ 主卡白框 ⑧ 照片底 ⑨ 天空斜切 ⑩ 太阳 ⑪ 前山 ⑫ 后山 |
| 启动底色 | `#0D0D0D`（与页面底色完全一致，冷启动无跳色） |
| 适合 | 和 APP 的深色基调最匹配；白色相框在深色壁纸上对比最强 |

### 2.1 三方案对比（缩略结论）

| 维度 | A 叠片 | B 网格墙 | C 叠卡 |
|---|---|---|---|
| 辨识度（48px） | 中 | 中 | **高**（白框 + 暖色太阳最跳） |
| 与 APP 配色契合 | 低（碧绿为新增色） | 中 | **高**（直接用 `--bg` / `--theme-color`） |
| 深色壁纸 | 好 | 好 | **最好** |
| 浅色壁纸 | 尚可 | 一般 | **好** |
| 主题化图标（单色） | 好 | 一般（细描边易糊） | 好 |
| 启动画面融合 | 一般 | 一般 | **完全无跳色** |

---

## 3. Capacitor 工程落地

### 3.1 目录与文件清单（全部为实际路径）

```
01-源码-puapp/
├─ capacitor.config.json            ← plugins.SplashScreen.backgroundColor: "#0d0d0d"
├─ android/
│  ├─ make_icons_v2.py              ← 图标生成器（本规范配套）
│  ├─ make_icons.py                 ← 旧版，仅保留历史价值，不再使用
│  ├─ icon-preview/                 ← 样张（1024 / 圆形 / 安全区 / 尺寸阵列）
│  ├─ icon-backup-c/                ← 首次落地前的原始资源备份
│  └─ app/src/main/
│     ├─ AndroidManifest.xml        ← android:icon / roundIcon 指向 @mipmap/ic_launcher(_round)
│     ├─ java/cc/ccwu/zmq/photowall/MainActivity.java  ← SplashScreen.installSplashScreen()
│     └─ res/
│        ├─ drawable/
│        │  ├─ splash.png                      ← API<26 兜底（320×480）
│        │  ├─ splash_background.xml           ← 启动底色（layer-list）
│        │  └─ ic_launcher_background_gradient.xml  ← 备用的渐变底矢量
│        ├─ drawable-port-{mdpi..xxxhdpi}/splash.png
│        ├─ drawable-land-{mdpi..xxxhdpi}/splash.png
│        ├─ drawable-{m,h,x,xx,xxx}dpi/ic_stat_photowall.png
│        ├─ mipmap-{m,h,x,xx,xxx}dpi/
│        │  ├─ ic_launcher.png                 (48dp)
│        │  ├─ ic_launcher_round.png           (48dp，圆形)
│        │  ├─ ic_launcher_background.png      (108dp)
│        │  ├─ ic_launcher_foreground.png      (108dp)
│        │  └─ ic_launcher_monochrome.png      (108dp，Android 13 主题化)
│        ├─ mipmap-anydpi-v26/
│        │  ├─ ic_launcher.xml                 ← <adaptive-icon> 三层
│        │  └─ ic_launcher_round.xml
│        └─ values/
│           ├─ colors.xml                      ← 品牌色板（brand_*）
│           ├─ ic_launcher_background.xml      ← ic_launcher_background（唯一定义）
│           ├─ splash_colors.xml               ← splash_background
│           ├─ styles.xml                      ← AppTheme / NoActionBar / NoActionBarLaunch
│           └─ ../values-v31/styles.xml        ← Android 12+ 启动画面主题
```

### 3.2 `mipmap-anydpi-v26/ic_launcher.xml`（当前内容）

```xml
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
```

- `<monochrome>` 只有 API 33+ 才生效，写在 anydpi-v26 里对低版本无副作用。
- 换方案时，只用改 PNG（脚本生成）+ `values/ic_launcher_background.xml` 的颜色。
  A/B 想用渐变底就把背景改成 `@drawable/ic_launcher_background_gradient`。

### 3.3 `values/colors.xml` / `values/ic_launcher_background.xml`

```xml
<!-- values/ic_launcher_background.xml —— 全工程唯一一处定义 -->
<color name="ic_launcher_background">#0D0D0D</color>
```

```xml
<!-- values/colors.xml -->
<color name="brand_primary">#8B6CE8</color>
<color name="brand_accent">#4A9EFF</color>
<color name="brand_violet">#A855F7</color>
<color name="brand_dark">#0D0D0D</color>
<color name="brand_text">#E0E0E0</color>
<color name="brand_notification">#FFFFFF</color>
```

### 3.4 `values/styles.xml` + `values-v31/styles.xml`（启动画面）

API 26–30 走库属性，31+ 走系统属性，22–25 走 `android:background`：

```xml
<!-- values/styles.xml -->
<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
    <item name="android:background">@drawable/splash</item>
    <item name="windowSplashScreenBackground">@color/splash_background</item>
    <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
    <item name="windowSplashScreenIconBackgroundColor">@color/ic_launcher_background</item>
    <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
</style>
```

`MainActivity` 必须装启动画面，否则 26–30 上图标不显示：

```java
@Override
protected void onCreate(Bundle savedInstanceState) {
    SplashScreen.installSplashScreen(this);   // 必须在 super.onCreate 之前
    super.onCreate(savedInstanceState);
}
```

### 3.5 执行流程

```powershell
# 1) 预览（只出样张，不动工程资源）
cd 01-源码-puapp\android
py make_icons_v2.py

# 2) 落地某一套（会先备份到 android\icon-backup-<方案>，再写 res，最后跑资源自检）
py make_icons_v2.py --apply c

# 3) 打包（项目约定：中文路径不能直接 gradle，用一键脚本）
cd ..
.\打包APK.ps1
```

`--apply` 之后脚本会跑 4 项自检，任何一项失败就中止（不把坏资源留在工程里）：
XML 注释里的连续减号、同名 color 重复定义、`@color/` 悬空引用、前景层尺寸是否 108dp × 倍率。

### 3.6 本次已验证

用 Android SDK 里独立的 `aapt2`（不依赖 Gradle）对 `res/` 做了 `compile` + `link`：

```
aapt2 compile --dir app/src/main/res -o res.zip      → 成功
aapt2 link ... -R res.zip -R core-splashscreen -R appcompat -R core  → 成功
```

导出的资源表确认：
`mipmap/ic_launcher` 有 mdpi~xxxhdpi 五档 PNG + anydpi-v26 XML；
`ic_launcher_monochrome` 五档齐全；
`AppTheme.NoActionBarLaunch` 的 4 个 splash 属性都已指向正确资源。

> ⚠️ 完整的 `gradlew assembleRelease` **没有跑**：构建需要先把 `@capacitor/android`
> 同步进 `android/`（`capacitor.settings.gradle` 指向的模块当前不在项目内），
> 且中文路径需走 `打包APK.ps1` 的临时目录镜像流程。本次改动不含 Java 逻辑，
> `MainActivity` 只多了 `installSplashScreen()` 两行，建议下次打包时一并验证。

---

## 4. 常见坑（本工程真实踩过的）

### 4.1 资源类

| 坑 | 现象 | 解法 |
|---|---|---|
| **XML 注释里写了 `--`** | `aapt2: xml parser error: not well-formed` | 注释里写 CSS 变量名时去掉双横线（本次 `colors.xml` 就中招了） |
| **同名 color 定义两次** | `duplicate resource color/ic_launcher_background` | 只保留 `values/ic_launcher_background.xml` 一处 |
| **`@color/colorPrimary` 悬空** | 链接失败，整个 res 报错 | 本次已修：`AppTheme` 改引用 `brand_*`。**这个坑原工程就存在**，是本次发现的 |
| **`Theme.SplashScreen` 的父主题在 values/ 里是空的** | 不装 `installSplashScreen()` 就只剩纯色屏 | `MainActivity.onCreate` 里先 install 再 super |

### 4.2 自适应图标类

| 坑 | 现象 | 解法 |
|---|---|---|
| 前景铺满整个 108dp | 圆形/水滴遮罩下四个角被切，卡片缺角 | 主体收进 66dp 安全区 |
| 前景缩放系数按"卡片名义高度"算 | 实际图形只剩 8% 屏高，太小 | 按「实际外接框」缩放到约 53dp 宽 |
| 给前景再画圆角底板 | "圆里套圆"，边缘出现灰边 | 背景只铺色/渐变，不做圆角 |
| 拿整张图标当启动图 | 系统再套遮罩，深底叠深底露一圈 | 启动图标用 `ic_launcher_foreground` |
| 没做 `monochrome` | 用户开"主题图标"后显示灰黑块 | 提供 `ic_launcher_monochrome.png` |
| `ic_launcher_round.xml` 写了不同内容 | 圆形启动器与其他启动器图标不一致 | 内容与 `ic_launcher.xml` 完全相同 |

### 4.3 暗色背景类

| 坑 | 现象 | 解法 |
|---|---|---|
| 深色图标贴在深色启动底 | 图标"消失"，只看见白框 | 底色、图标背景层、`SplashScreen.backgroundColor` 三处统一为 `#0D0D0D` |
| 方案 B 浅底 + 白色格子 | 浅色壁纸下图标边缘发糊 | 格子加 1.5dp 白色描边，或整体加暗色外发光 |
| `Theme.AppCompat.Light.DarkActionBar` 残留 | 部分 ROM 上启动瞬间白闪 | 启动主题的 `postSplashScreenTheme` 指向 `AppTheme.NoActionBar`（DayNight） |
| 旧启动图还是 Capacitor 默认白底 | 冷启动先白一下再进深色页面 | 已用方案 C 的深底图替换全部 `splash.png` |

### 4.4 尺寸类

| 坑 | 现象 | 解法 |
|---|---|---|
| 把 1024 图直接丢进 `mipmap-mdpi` | 桌面图标发糊/内存暴涨 | 按 §1.4 尺寸表逐档导出 |
| 只放 xxxhdpi | mdpi 设备上图标被拉伸 | 五档齐全；`aapt2 link` 支持单档但低端机会降采样发糊 |
| 通知图标用彩色 | 通知栏显示灰块 | 纯白 + 透明底 |

---

## 5. 待你决定的事项

1. **最终选哪套**：A / B / C。目前 C 已落地，换成 A 或 B 只需 `py make_icons_v2.py --apply a|b`。
2. **方案 B 是否加暗描边**：浅色壁纸下会更好，但会稍显"厚重"。
3. **启动图标要不要带文字**：「美琴的照片墙」在 96dp 里放不下，建议只放图形（当前做法）。
4. **是否生成 Web 端 PNG favicon**：`public/favicon.svg` 目前还是 Capacitor 默认的流星标，
   要不要一并换成同一套图形（浏览器标签页与 APP 图标统一）。

> 记忆文件（`记忆/`）本轮**未改动**：图标属于纯设计/资源工作，
> 若要归档结论，建议追加到 `记忆/07-对话历史.md`，由主控决定。
