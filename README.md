# 美琴的照片墙 · APP

把原本纯前端的 Vue 照片墙，做成了**可以安装的安卓 APP**（Capacitor 打包）。
界面完全沿用原项目的视觉语言（深色主题、紫色强调色、照片墙/影院/画报三个页面），
**没有重做任何 UI**；改动集中在「数据从哪来」这一层。

照片**不放在 APP 里**，全部存在一台私有虚拟机上的后端服务里：

```
 手机 APP  ──HTTP+令牌──▶  虚拟机后端 (Python)  ──▶  磁盘上的原图/缩略图
 (Capacitor)   +图片签名URL     SQLite 索引            谁也拿不走
```

APK 解包后**看不到任何一张照片** —— 这是和「把图片打进包里」最本质的区别。

---

## 一、装到手机

下载：**[apk/app-release-1.0.1.apk](apk/app-release-1.0.1.apk)**（1.21 MB）

> **1.0.1 修了什么**：照片墙（`#/wall`）一片空白。
> 原因是 `src/core/renderer.js` 的 `thumbUrl()` / `fullUrl()` 还在拼
> `images/thumbnails/N.webp` 这个**打包进 APK 的本地路径**，而构建时为
> 防止照片泄漏已经把 `public/images` 移开了，所以永远 404。
> 画报页和影院页一直是对的（它们走 `assetUrl(entry.thumb)`）。
> 1.0.0 可以卸载了。

装之前系统会提示「未知来源应用」，允许即可。装完桌面上出现图标「美琴的照片墙」。

### 第一次打开要填服务器地址

APP 打开是登录页。点底部的 **⚙ 服务器设置**，填入后端地址，例如：

```
http://192.168.3.26:18000
```

> 具体填什么取决于你的网络。见下面「三、让手机连上服务器」。
> 地址填错也不怕：点「保存」会立刻检测连通性，连不上会直接提示。

然后填账号密码登录。

---

## 二、账号

| 账号 | 密码 | 权限 |
|---|---|---|
| `author` | `Ulc_xXB-Jt5w` | 可以上传、删除照片 |
| `viewer` | `m2Pmo-gJNa5W` | 只能看 |

> 这两个口令是部署时随机生成的。想换的话，在虚拟机里改
> `/var/lib/photo-wall/config.json` 的 `credentials` 段然后重启服务。
> 口令以加盐摘要（scrypt）形式存储，不是明文。

---

## 三、让手机连上服务器

### 为什么需要这一步

照片后端跑在一台 VMware 虚拟机里，网段是 `192.168.5.x`，这是 VMware 的
**NAT 内部网段**，只有宿主机自己能进去。手机连的是家里 WiFi 的
`192.168.3.x`，两者不通。

### 方法 A：手动改（最稳，推荐）

**同样需要管理员身份**。打开记事本时也必须**以管理员身份运行**，否则保存会报「拒绝访问」。

1. 右键开始菜单 → **Windows PowerShell (管理员)**
2. 先备份：

```powershell
copy C:\ProgramData\VMware\vmnetnat.conf C:\ProgramData\VMware\vmnetnat.conf.bak
```

3. 用管理员记事本打开配置：

```powershell
notepad C:\ProgramData\VMware\vmnetnat.conf
```

4. 找到 `[incomingtcp]` 这一段，**在它下面另起一行**加入：

```
18000 = 192.168.5.129:18000
```

> 注意：该段里原本的 `#8887 = ...` 那几行都是**注释**（行首有 `#`），不要动。
> 新加的行**不能带 `#`**，否则不生效。

5. 保存，然后重启 NAT 服务：

```powershell
restart-service "VMware NAT Service"
```

6. 验证（在宿主机上跑，返回 `{"ok": true, ...}` 就成了）：

```powershell
curl http://127.0.0.1:18000/api/health
```

7. 放行防火墙（只需一次）：

```powershell
netsh advfirewall firewall add rule name="PhotoWall" dir=in action=allow protocol=TCP localport=18000
```

8. 在 APP 里填 **`http://192.168.3.26:18000`**（`192.168.3.26` 是这台电脑的 WiFi 地址，换网络就跟着变，用 `ipconfig` 查）。

**回滚**：

```powershell
copy C:\ProgramData\VMware\vmnetnat.conf.bak C:\ProgramData\VMware\vmnetnat.conf
restart-service "VMware NAT Service"
```

### 方法 B：跑脚本

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-port-forwarding.ps1
```

脚本做的事和方法 A 完全一样，外加自动备份、自动检测 WiFi 地址并直接告诉你该填什么。
已针对 Windows PowerShell 5.1 做过兼容（**整份脚本保持纯 ASCII**，原因见「坑 12」）。

跑完会打印：

```
================ DONE ================
On the phone (same WiFi), open the APP, tap the gear icon
and set the server address to:
    http://192.168.3.26:18000
```

**回滚**：脚本会留下 `vmnetnat.conf.bak-时间戳`，覆盖回去再重启服务即可。

---

## 四、换了网络怎么办

APP 里的服务器地址**可以随时改**，不用重新打包：登录页 → ⚙ 服务器设置 → 改地址 → 保存。

比如从家里 WiFi 换到学校网，只要先确认新的后端地址，填进去就行。

「用默认」按钮会还原成打包时内置的地址。

---

## 五、三个页面

| 页面 | 说明 |
|---|---|
| **画报** | 瀑布流，卡片按每张照片真实比例排版；7 档列数断点（1900→8 列 … <768→2 列）；桌面端有 3D 倾斜视差 |
| **影院** | 倾斜 10° 的错落列，按窗口宽度自动选 4/5/6 列，上下双向跑马灯 |
| **照片墙** | 20×15 世界网格无限平移，按 `(col*47 + row*31) % N` 取图 |
| 首页 | 可滚动长页，占位文案待填 |

底部导航条只在画报/影院/照片墙三页显示，首页和照片墙是沉浸式、不显示 —— 这是原项目的设计，没有改动。

---

## 六、安全设计

| 措施 | 说明 |
|---|---|
| 密码不进前端 | 原来账号密码硬编码在 `Login.vue` 里，搜代码就能看到；现在走 `/api/login` 校验 |
| 加盐摘要 | 服务端存的是 scrypt 摘要，不是明文口令 |
| 短期令牌 | HMAC 签名，默认 12 小时过期；**服务重启即全部失效** |
| 图片签名 URL | `<img src>` 带不了请求头，所以图片走「针对这一张图 + 15 分钟有效期」的签名，而不是把长期令牌塞进 URL |
| 防盗链 | 签名绑定 `图片ID + 变体(thumb/full) + 过期时间`，拿 A 图签名访问 B 图会被拒 |
| 限流 | 登录 5 次/分钟、上传 20 次、读取 240 次，令牌桶算法 |
| CORS 白名单 | 只放行 `localhost` 系列与服务器自身 IP，`evil.com` 之类一律拒绝，没有用 `*` |
| 权限分级 | `viewer` 删照片返回 403 |
| APK 不含照片 | 打包时主动把 `public/images` 移开，杜绝解包拿走照片 |

**明文 HTTP 的取舍**：后端在局域网，没有域名也签不出受信任证书，所以
`usesCleartextTraffic=true`。传输未加密，但鉴权仍靠令牌与签名。
日后接上 Cloudflare Tunnel 或配了正式证书，把
`android/app/src/main/res/xml/network_security_config.xml` 里的
`cleartextTrafficPermitted` 改成 `false` 即可回到全 HTTPS。

---

## 七、从源码构建 APK

### 环境要求

- JDK 21
- Android SDK（platform 35 + build-tools 35.0.0）
- Node.js 20+
- **构建路径必须是纯 ASCII** —— 这一点很关键，见下面的「踩过的坑」

本机工具链在 `Z:\AndroidToolchain`，先 dot-source 一下环境：

```powershell
. Z:\AndroidToolchain\env.ps1
```

### 构建

```powershell
# 1. 前端（会注入 VITE_BASE=./ 和后端地址，并把 public/images 移开）
node scripts/build-app.mjs

# 2. 同步到 Android 工程
#    （不用 cap sync，它会重装 gradle 依赖，很慢；手工同步等价且快）
Remove-Item android\app\src\main\assets\public -Recurse -Force
robocopy dist android\app\src\main\assets\public /E

# 3. 打包
cd android
.\gradlew.bat assembleRelease
```

产物在 `android/app/build/outputs/apk/release/app-release.apk`。

### 指定后端地址

```powershell
$env:PW_API_BASE = 'http://192.168.3.26:18000'
node scripts/build-app.mjs
```

或者改 `.env.app` 文件里的 `PW_API_BASE`。

### 签名

`android/keystore.properties`（**已被 gitignore，不会进仓库**）：

```properties
storeFile=keystore/photowall-release.jks
storePassword=******
keyAlias=photowall
keyPassword=******
```

仓库里没有签名密钥。要自己签字就生成一个：

```powershell
keytool -genkeypair -v -keystore keystore/photowall-release.jks `
  -alias photowall -keyalg RSA -keysize 2048 -validity 10950 `
  -storepass 你的密码 -keypass 你的密码 `
  -dname "CN=PhotoWall, OU=Personal, O=MQ, C=CN"
```

不配签名文件也能 `assembleDebug`，只是产物未签名。

---

## 八、踩过的坑

记录在这里，省得下次再踩。

### 1. Gradle 拒绝中文路径

```
Your project path contains non-ASCII characters.
```

`D:\WinServer2019\软件server` 带中文，AGP 直接拒绝构建。虽然加
`android.overridePathCheck=true` 能骗过检查，但 aapt2 / ndk 等工具在非 ASCII
路径下仍有真实风险。**所以最终的构建工程放在 `Z:\PuAppBuild`（纯 ASCII），
源码在工作区，改完同步过去。**

### 2. `npm install` 会偷偷降级 vite

原项目的 `package.json` 写的是 `vite: ^5.0.0`，但实际装的 node_modules 是
**vite 8.3.0**（`vite.config.js` 用了 `rolldownOptions`，5.x 不支持）。
跑一次 `npm install` 就会把 vite 降到 5.4.21 并删掉 rolldown，构建直接坏。

这次装 Capacitor 时就中了招，靠从原项目 robocopy 回 node_modules 才恢复。
现在 `package.json` 已改成 `^8.3.0` / `@vitejs/plugin-vue: ^6.0.9`，
但**仍然建议不要在这个工程里跑 `npm install`**。

### 3. Capacitor 6 的配置文件只能写 JSON

- `@capacitor/cli` 6.x **没有** `defineConfig`（那是 7.x 才加的）
- 工程 `package.json` 有 `"type": "module"`，所以 `module.exports` 会报
  `module is not defined in ES module scope`

试了 `.js` + `export default`，CLI 能读文件但拿不到 `appId`。
最后用 `capacitor.config.json` 才彻底正常。

### 4. 明文 HTTP 要开两处，缺一不可

- `capacitor.config.json` 的 `server.cleartext` / `android.allowMixedContent`
  → 只管 WebView 自己
- `AndroidManifest.xml` 的 `usesCleartextTraffic` + `networkSecurityConfig`
  → 管系统网络栈

只改前者，请求仍会被拦，报 `CLEARTEXT communication not permitted`。

### 5. CORS：不带端口的 origin 匹配不上

后端 CORS 白名单写的是 `https://localhost:*`，匹配逻辑是：

```python
head, _, port = pat.rpartition(":")     # head='https://localhost', port='*'
if origin == head or origin.startswith(head + ":"):
    rest = ...
    if rest.isdigit():                   # ← origin 没有端口时 rest=''，返回 False
```

而 Capacitor 的 `androidScheme: "https"` 让页面源正好是 **`https://localhost`（无端口）**，
于是 APP 里所有跨域请求都拿不到 `Access-Control-Allow-Origin`。
修法是 `origin == head` 时直接放行。

### 6. `<img>` 带不了请求头

图片接口原来要求 `Authorization` 头，但浏览器的 `<img src>` 发不了自定义头，
结果整页图全 401。改成**图片签名 URL**：清单接口返回
`/api/photos/<id>/thumb?exp=...&sig=...`，签名只对这一张图生效、15 分钟过期。

### 7. 打包会把照片副本塞进 APK

`vite.config.js` 是 `copyPublicDir: true`，`public/images` 里的 23 张照片
（46 个文件 3.71 MB）会被原样打进 APK。因为照片已改走后端，这些副本既没用、
又等于**把照片公开发给了每个装了这个 APP 的人**。
`scripts/build-app.mjs` 会在构建前把 `public/images` 临时改名移开，构建完再改回来。

### 8. 异步数据 + 模块级常量 = 页面永远空白

照片清单从后端异步拉，但原代码里有几处「模块初始化时就把数据算好」的写法：

- `Pictorial.vue`：`const cards = IMAGE_POOL.map(...)` —— 清单还没到就映射，得到空数组
- `Cinema.vue`：`const POOL_SIZE = IMAGE_POOL.length` —— 恒为 0，影院页直接 return

都改成函数 / `ref`，并在清单到达后重建。

### 9. 登录前的请求必然 401，别把失败缓存住

`main.js` 在挂载时就拉一次照片清单，那时用户还没登录，必然 401。
如果把这个失败的 Promise 缓存进 `loadPromise`，登录后就永远拿回失败结果、
相册永远空白。`config.js` 现在对 401 不做缓存。

### 10. PowerShell 5.1 的坑

- 中文注释会让解析器误报「缺少 )」
- 管道符 `|` 不能行尾续行
- `Start-Job` 起的子进程会随 job 结束被杀 → 后端服务必须用
  `run_in_background` 方式常驻
- 原生 exe 往 stderr 写正常输出（如 `java -version`）也会被当成 `NativeCommandError`，
  判断成败要看真正的退出码或输出内容

### 11. `env.ps1` 里有个 `$sdk` 没定义

原始版本第 5 行用 `$sdk` 拼 PATH，但那个变量从没赋值，导致
`platform-tools`、`cmdline-tools` 实际一直不在 PATH 上。已修。

### 12. PowerShell 5.1 按 GBK 解析 .ps1，中文注释会炸

第一版 `setup-port-forwarding.ps1` 写了中文注释和中文 `Write-Host`，在
Windows PowerShell 5.1 下直接报：

```
所在位置 ...setup-port-forwarding.ps1:115 字符: 12
+ Write-Host "锟斤拷...
字符串缺少终止符: "。
语句块或类型定义中缺少右“}”。
```

原因：**Windows PowerShell 5.1 读取 `.ps1` 时按系统 ANSI 代码页解码**
（本机 `chcp` = 936 即 GBK），而文件是 UTF-8 无 BOM。中文字符被拆成
半个 GBK 字符，其中某些字节正好落在引号范围里，把字符串"截断"了。

三种解法（按可靠性排序）：

1. **脚本全文纯 ASCII** ← 本项目采用，最省事，永远不会再犯
2. 文件存成 **UTF-8 带 BOM**（`EF BB BF`），PS 5.1 见到 BOM 才会按 UTF-8 读
3. 存成 UTF-16 LE

验证方法：用解析器静态检查，不执行也能发现语法错误

```powershell
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    'setup-port-forwarding.ps1', [ref]$null, [ref]$errors)
$errors
```

上一轮我恰恰在记忆里记着这个坑，却还是写出了中文脚本 —— 教训是
**给 PS 5.1 用的脚本，一律别写中文**。

### 13. 照片墙空白：改数据层时漏掉了 renderer.js

`Pictorial.vue` 和 `Cinema.vue` 取图都写成 `assetUrl(entry.thumb)`，
天然支持后端绝对 URL。但 `core/renderer.js`（照片墙引擎）是另一套写法：

```js
// 错的：照片已不在包内，这个路径永远 404
export function thumbUrl(i) {
    return assetUrl('images/thumbnails/' + i + '.webp', BASE_URL);
}
```

症状很有迷惑性：**登录正常、清单 23 条、画报页和影院页都正常，只有照片墙全白**。
因为其它页面走后端 URL 没问题，唯独这个页面拼的是本地静态路径。

改法是先查清单里的真实地址，查不到才退回本地路径。

**教训**：改数据来源时，不能只改显式 import 了清单的模块，
还要全库搜一遍**硬编码的资源路径字符串**：

```powershell
Select-String -Path src\*.* -Recurse -Pattern 'images/thumbnails|images/full'
```

### 14. 异步清单 + 模块加载时执行的初始化 = 用到的是空数据

`renderer.js` 的 `buildSizeTable()` 在模块顶层执行，把每张图的宽高比
写进 `BASE_W` / `BASE_H`。原来清单是静态常量，这没问题；
现在清单异步到达，函数执行时 `IMAGE_POOL` 还是空数组，
于是全部退回内置的 `FALLBACK_RATIOS`（近似值），
结果是 16:9 的横图被按 3:4 排，**照片被拉变形**。

修法是在清单填充完成后重算一次。但 `config.js` 不能顶层 import
`renderer.js` —— `renderer.js` 已经 import 了 `config.js`，
会形成循环依赖、让导出在初始化期变成 `undefined`。用动态 import 绕开：

```js
// config.js 里，清单填好之后
import('./renderer.js')
    .then((m) => m.rebuildSizeTable && m.rebuildSizeTable())
    .catch(() => {});
```

> Vite 会警告 `INEFFECTIVE_DYNAMIC_IMPORT`（因为别处已静态 import 该模块，
> 拆不出独立 chunk）。这个警告无害，动态 import 仍然能正确拿到模块对象。

### 15. 按下标取数组，删照片后会错位

```js
const entry = IMAGE_POOL[i - 1];   // 假设 id 与下标严格对应
```

照片固定 23 张时成立。但删掉中间某张后 id 会变成 `1,2,4,7...`，
`IMAGE_POOL[i - 1]` 就会张冠李戴 —— 卡片上显示的是别的照片。
改成按 id 查：`IMAGE_POOL.find((e) => e.id === i)`。

### 16. 旧测试服务占着端口，导致同一地址行为不一致

调试时发现：`192.168.3.26:18000` 登录正常，`127.0.0.1:18000` 报
「用户名或口令不正确」。查 `Get-NetTCPConnection` 才看到**两个监听**：

```
127.0.0.1:18000   PID 11276  python.exe   ← 之前测试遗留的 server.py
0.0.0.0:18000     PID 30680  vmnat        ← VMware 端口转发，正确
```

`127.0.0.1` 比 `0.0.0.0` 更精确，所以本机请求命中了残留服务。
停掉那个 python 进程即恢复正常。

```powershell
Get-NetTCPConnection -LocalPort 18000 -State Listen |
    Select-Object LocalAddress, OwningProcess
```

### 17. 图片 URL 写死内网 IP，APP 里照片全白

后端原本把 `config.json` 里的 `public_base_url` 拼到图片地址前面，
而这个值是写死的 `http://192.168.5.129:18000`（VMware NAT 内网地址）。
手机走 `192.168.3.26` 转发进来时，登录和清单都正常，
但拿到的图片地址指向一个它根本访问不到的内网 IP。

改成**用请求自身的 Host 头**拼绝对地址：

```python
host_hdr = self.headers.get("Host", "") or ""
if host_hdr and re.match(r"^[A-Za-z0-9.-]+(:[0-9]{1,5})?$", host_hdr):
    base = "http://" + host_hdr
else:
    base = s.public_base_url
```

这样同一台后端被三条路径访问（`192.168.3.26` 转发 / `127.0.0.1` 本机 /
`192.168.5.129` 内网）时，各自拿到的都是自己能访问的地址。

---

## 九、目录结构

```
repo-app/
├─ apk/
│   ├─ app-release-1.0.0.apk          旧版（照片墙空白，留作对照）
│   └─ app-release-1.0.1.apk          当前版本，已签名，直接装
├─ app-source/                         完整工程源码
│   ├─ src/
│   │   ├─ core/
│   │   │   ├─ api.js                  ★ 新增：后端客户端（登录/令牌/清单/上传/删除）
│   │   │   ├─ config.js               ★ 改造：清单改为从 API 拉取
│   │   │   ├─ imageManifest.js        ★ 改造：只留 assetUrl / getImageEntry
│   │   │   ├─ renderer.js             照片墙 20×15 网格引擎（未改）
│   │   │   ├─ input.js / inertia.js / state.js / utils.js
│   │   ├─ views/
│   │   │   ├─ Login.vue               ★ 改造：走 API 登录 + 服务器设置入口
│   │   │   ├─ Pictorial.vue           ★ 微改：卡片数据改响应式
│   │   │   ├─ Cinema.vue              ★ 微改：池大小改函数
│   │   │   ├─ PhotoWall.vue / Home.vue
│   │   ├─ components/
│   │   │   ├─ NavBar.vue              导航条（未改）
│   │   │   └─ PtrTransition.vue       斜向擦除转场（未改）
│   │   └─ router/index.js             ★ 微改：登录判断改为看令牌
│   ├─ android/                        Capacitor 原生工程
│   │   ├─ app/src/main/
│   │   │   ├─ AndroidManifest.xml     ★ 明文 HTTP 放行
│   │   │   ├─ res/xml/network_security_config.xml   ★ 新增
│   │   │   └─ res/mipmap-*/           ★ 自绘图标
│   │   ├─ app/build.gradle            ★ R8 + 签名配置
│   │   ├─ app/proguard-rules.pro      ★ Capacitor 反射保护规则
│   │   └─ make_icons.py               图标生成脚本
│   ├─ scripts/build-app.mjs           ★ 新增：APK 专用构建
│   ├─ capacitor.config.json           ★ 新增
│   └─ 记忆/                            开发过程记录
└─ .gitignore
```

★ = 本次新增或改动

---

## 十、后端

后端没有放在这个仓库里（它跑在私有虚拟机上）。要了解它：

```bash
# 在虚拟机里
systemctl status photo-wall
journalctl -u photo-wall -n 50
cat /var/lib/photo-wall/config.json     # 需要 sudo
```

接口一览：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | 返回短期令牌 |
| POST | `/api/logout` | 无状态，客户端丢弃令牌即可 |
| GET | `/api/photos` | 照片清单（含签名图片 URL） |
| GET | `/api/photos/<id>/thumb` | 缩略图，560px 长边；**签名 URL 可免令牌** |
| GET | `/api/photos/<id>/full` | 原图；同上 |
| POST | `/api/photos` | 上传（需 author 角色） |
| DELETE | `/api/photos/<id>` | 删除（需 author 角色） |
| GET | `/api/health` | 健康检查，不需要令牌 |

---

## 十一、已知限制

1. **没做过真机测试**。构建环境里没有 Android 模拟器，也没有连真机。
   APK 的静态指标都核对过（签名有效、包名/图标正确、明文策略生效、
   资源完整、R8 保护规则覆盖 Capacitor 反射点），但「装上去跑一遍」这一步
   是在你手机上完成的。
2. **只能局域网用**。没有做内网穿透，出门用流量连不上。
   要公网访问需要单独配 Cloudflare Tunnel 之类。
3. **上传/删除没有 UI**。后端接口是通的（`uploadPhoto` / `deletePhoto`
   已在 `api.js` 里），但原项目没有上传页面，我没有擅自加 —— 按「不重构 UI」
   的原则，这属于功能扩展，等你确认要不要。
4. **点赞/评论/收藏是纯展示**。原项目就是静态图标，没有后端。
5. **首页是占位文案**，原项目就是这样（"后续等我们美丽的负责人想想这里写什么"）。

---

## 十二、许可

MIT，见 [LICENSE](LICENSE)。
