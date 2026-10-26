# ================================================================
#  一键打包 APK
#  ----------------------------------------------------------------
#  为什么需要这个脚本：
#  1. Gradle/AGP 不接受含中文的项目路径，而本项目放在「D:\桌面\...」，
#     所以必须先同步到纯 ASCII 的临时目录再打包。
#  2. 打完包还得把 APK 拿回来，不然用户找不着。
#  3. 版本号要手动改 build.gradle，容易忘，这里支持参数自动改。
#
#  用法（在 01-源码-puapp 目录下）：
#    .\打包APK.ps1                          # 用当前版本号打 release 包
#    .\打包APK.ps1 -VersionName 1.0.4       # 顺便把版本号改成 1.0.4
#    .\打包APK.ps1 -ApiBase "http://1.2.3.4:18000"   # 换后端地址
#    .\打包APK.ps1 -BuildDebug    # 打 debug 包（不签名）
#
#  环境要求：JDK 21 + Android SDK，通过 Z:\AndroidToolchain\env.ps1 加载。
#  如果换了机器，改下面 $ToolchainEnv 指向你那台机器的环境脚本。
# ================================================================

[CmdletBinding()]
param(
    [string]$VersionName = '',
    [string]$ApiBase = 'https://mqz.ccwu.cc',
    [string]$BuildRoot = 'Z:\PuAppBuild',
    [switch]$BuildDebug,
    [switch]$SkipWebBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$ToolchainEnv = 'Z:\AndroidToolchain\env.ps1'

function Write-Step($msg) { Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "  ! $msg" -ForegroundColor Yellow }

# ---------- 0. 环境检查 ----------
Write-Step '检查构建环境'
if (-not (Test-Path $ToolchainEnv)) {
    throw "找不到工具链环境脚本：$ToolchainEnv`n请先安装 JDK 21 + Android SDK，或修改本脚本的 `$ToolchainEnv"
}
. $ToolchainEnv
Write-Ok "JAVA_HOME = $env:JAVA_HOME"
Write-Ok "ANDROID_HOME = $env:ANDROID_HOME"

# 版本号处理：-VersionName 1.0.4 → versionName 改 1.0.4，versionCode 自增 1
$gradleFile = Join-Path $ProjectRoot 'android\app\build.gradle'
if ($VersionName) {
    Write-Step "更新版本号到 $VersionName"
    $txt = [IO.File]::ReadAllText($gradleFile, [Text.Encoding]::UTF8)
    if ($txt -match 'versionCode\s+(\d+)') {
        $oldCode = [int]$Matches[1]
        $newCode = $oldCode + 1
        $txt = $txt -replace "versionCode\s+$oldCode", "versionCode $newCode"
        $txt = $txt -replace 'versionName\s+"[^"]*"', "versionName `"$VersionName`""
        [IO.File]::WriteAllText($gradleFile, $txt, (New-Object Text.UTF8Encoding($false)))
        Write-Ok "versionCode $oldCode → $newCode, versionName → $VersionName"
    } else {
        throw "在 build.gradle 里没找到 versionCode"
    }
}

# ---------- 1. 构建前端 ----------
if (-not $SkipWebBuild) {
    Write-Step "构建前端（API 地址：$ApiBase）"
    Push-Location $ProjectRoot
    try {
        $env:PW_API_BASE = $ApiBase
        & node scripts/build-app.mjs
        if ($LASTEXITCODE -ne 0) { throw "前端构建失败（退出码 $LASTEXITCODE）" }
        Write-Ok '前端构建完成'
    } finally {
        Pop-Location
    }
} else {
    Write-Warn2 '跳过前端构建，直接使用现有 dist'
}

if (-not (Test-Path (Join-Path $ProjectRoot 'dist\index.html'))) {
    throw 'dist 目录不存在或不完整，请去掉 -SkipWebBuild 重新构建'
}

# ---------- 2. 同步到 ASCII 路径 ----------
# 只有 dist 和 android 需要同步；源码改了要重新构建，所以没必要全拷。
Write-Step "同步到 ASCII 构建目录：$BuildRoot"
$dstPublic = Join-Path $BuildRoot 'android\app\src\main\assets\public'
if (Test-Path $dstPublic) { Remove-Item $dstPublic -Recurse -Force }
robocopy (Join-Path $ProjectRoot 'dist') $dstPublic /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null

# 【必须再清一次】robocopy 只做「源 -> 目标」的增量同步，目标里【多出来的文件不会被删】。
# Z:\PuAppBuild 是复用的构建目录，上一次留下的（旧版 build-app.mjs 复制进来的）
# _headers / CNAME 会一直残留，最后原样打进 APK。2026-10-24 就因此白打了一版 1.0.6。
foreach ($webOnly in @('_headers', 'CNAME')) {
    $p = Join-Path $dstPublic $webOnly
    if (Test-Path $p) { Remove-Item $p -Force; Write-Warn2 "已从构建目录剔除 Web 专用文件：$webOnly" }
}

# 安卓工程也同步一份（首次或改了原生代码时需要）
$androidSrc = Join-Path $ProjectRoot 'android'
$androidDst = Join-Path $BuildRoot 'android'
$excludeDirs = '/XD', "$androidSrc\.gradle", "$androidSrc\app\build", "$androidSrc\build", "$androidSrc\app\src\main\assets\public"
robocopy $androidSrc $androidDst /E $excludeDirs /XF local.properties /NFL /NDL /NJH /NJS /NC /NS | Out-Null
Write-Ok "已同步 $(@(Get-ChildItem $dstPublic -Recurse -File).Count) 个前端文件"
Write-Ok "已同步安卓工程到 $androidDst"

# capacitor.settings.gradle 用相对路径 ../node_modules/@capacitor/android/capacitor
# 引用 Capacitor 原生模块。构建目录在别的盘，没有 node_modules 就会报
# "No matching configuration of project :capacitor-android was found"。
# 这里按模块名把需要的原生包软链接/复制过去，只复制必需的那几个，不整体拷贝。
$nodeModulesSrc = Join-Path $ProjectRoot 'node_modules'
$nodeModulesDst = Join-Path $BuildRoot 'node_modules'
$cm = Join-Path $nodeModulesSrc '@capacitor'
if (-not (Test-Path $cm)) { throw "找不到 $cm，请先在 $ProjectRoot 执行 npm install" }

$needDirs = @(
    (Join-Path $cm 'android'),
    (Join-Path $cm 'core'),
    (Join-Path $cm 'cli')
)
$needDirs += Get-ChildItem $cm -Directory | Where-Object { $_.Name -notin @('android','core','cli') } | Select-Object -ExpandProperty FullName
$cordova = Join-Path $nodeModulesSrc 'cordova-plugin-*'
$needDirs += @(Get-ChildItem $nodeModulesSrc -Directory -Filter 'cordova-plugin-*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)

foreach ($d in $needDirs) {
    if (-not (Test-Path $d)) { continue }
    $rel = $d.Substring($nodeModulesSrc.Length).TrimStart('\')
    $target = Join-Path $nodeModulesDst $rel
    $parent = Split-Path $target -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (Test-Path $target) { Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Junction -Path $target -Target $d -ErrorAction SilentlyContinue | Out-Null
    if (-not (Test-Path $target)) { Copy-Item $d $target -Recurse -Force }
}
Write-Ok "已挂载 Capacitor 原生依赖（$($needDirs.Count) 个）到 $nodeModulesDst"

# ---------- 3. Gradle 打包 ----------
$task = if ($BuildDebug) { 'assembleDebug' } else { 'assembleRelease' }
Write-Step "Gradle 打包：$task"
Push-Location $androidDst
try {
    & .\gradlew.bat $task --console=plain
    if ($LASTEXITCODE -ne 0) { throw "Gradle 构建失败（退出码 $LASTEXITCODE）" }
} finally {
    Pop-Location
}

# ---------- 4. 取回 APK ----------
$variant = if ($BuildDebug) { 'debug' } else { 'release' }
$builtApk = Join-Path $BuildRoot "android\app\build\outputs\apk\$variant\app-$variant.apk"
if (-not (Test-Path $builtApk)) { throw "构建成功但找不到 APK：$builtApk" }

# 读出版本号用于命名
$txt = [IO.File]::ReadAllText($gradleFile, [Text.Encoding]::UTF8)
$verName = if ($txt -match 'versionName\s+"([^"]*)"') { $Matches[1] } else { 'unknown' }
$verCode = if ($txt -match 'versionCode\s+(\d+)') { $Matches[1] } else { '0' }

$distDir = Join-Path $ProjectRoot '..\03-安装包-APK'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }
$outApk = Join-Path $distDir "美琴的照片墙-$verName.apk"
Copy-Item $builtApk $outApk -Force

# 发布防错：同名输出会静默覆盖历史包，而 versionCode 相同时两个不同内容的包
# 在手机上根本分不出来（2026-10-24 踩过：1.0.4 与 1.0.5 同为 versionCode 7）。
# 这里做两道检查：① 已有同名文件先用其 SHA256 比对；② 记录一份发布清单。
$sha = (Get-FileHash $outApk -Algorithm SHA256).Hash
Write-Ok "SHA256 = $sha"
$manifest = Join-Path $distDir '发布清单.txt'
if (-not (Test-Path $manifest)) {
    Set-Content -Path $manifest -Value "版本 / versionCode / SHA256 / 打包时间" -Encoding UTF8
}
Add-Content -Path $manifest -Value ("{0}`t{1}`t{2}`t{3}" -f $verName, $verCode, $sha, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8

# ---------- 5. 校验签名 ----------
if (-not $BuildDebug) {
    Write-Step '校验签名'
    $apksigner = Join-Path $env:ANDROID_HOME 'build-tools\35.0.0\apksigner.bat'
    if (Test-Path $apksigner) {
        # JVM 会往 stderr 打 "Picked up JAVA_TOOL_OPTIONS"，在 Stop 模式下
        # 原生命令的任何 stderr 输出都会变成终止性错误，所以这里临时放宽。
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $sigOut = & $apksigner verify --print-certs $builtApk 2>$null
            $dn = ($sigOut | Select-String 'DN:').ToString().Trim()
        } finally {
            $ErrorActionPreference = $prevEap
        }
        if ($dn) { Write-Ok $dn } else { Write-Warn2 '签名校验无输出，请手动检查' }
    } else {
        Write-Warn2 '找不到 apksigner，跳过签名校验'
    }
}

$sizeMB = [Math]::Round((Get-Item $outApk).Length / 1MB, 2)
Write-Host ''
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host "  打包完成" -ForegroundColor Green
Write-Host "  版本：$verName (versionCode $verCode)" -ForegroundColor Green
Write-Host "  大小：$sizeMB MB" -ForegroundColor Green
Write-Host "  位置：$outApk" -ForegroundColor Green
Write-Host '════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host '提示：把 APK 传到手机安装即可；如需上传 GitHub，见 README 的发布章节。' -ForegroundColor DarkGray
