# ================================================================
#  ProGuard / R8 规则 —— Capacitor APP
#  ----------------------------------------------------------------
#  这里的每一条都对应一个「混淆后必然出问题」的点。R8 会把没有静态
#  引用的类裁掉、把方法名改成 a/b/c，而 Capacitor 与 WebView 之间
#  大量依赖反射和固定方法名，一旦被混淆，表现是：APP 能启动，但
#  WebView 白屏、或 JS 调 bridge 直接抛错。
#
#  规则来源：Capacitor 官方 android 模板 + WebView 的 JS 桥接要求。
# ================================================================

# ---------- WebView 的 JS 接口 ----------
# @JavascriptInterface 标注的方法由 WebView 按「原方法名」反射调用，
# 名字被改掉 JS 侧就找不到。Capacitor 的 Bridge / MessageHandler /
# PluginMethod 都靠这一条活着。
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# ---------- Capacitor 核心 ----------
# bridge 通过反射查找插件类、插件方法、以及 @PluginMethod 注解。
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.PluginMethod protected <methods>;
}
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}

# PluginHandle 之类会按类名匹配，保留类名
-keepnames class com.getcapacitor.** { *; }

# ---------- 宿主 Activity ----------
# AndroidManifest 里写的是 .MainActivity，类名不能被改。
-keep class cc.ccwu.zmq.photowall.MainActivity { *; }

# ---------- 通用：泛型与注解 ----------
# R8 默认会剥掉这些，Capacitor 的反射依赖它们还原方法签名
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault

# ---------- 保留行号，崩溃时能定位 ----------
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---------- Cordova 兼容层 ----------
# capacitor-cordova-android-plugins 是空模块，但模板里带着这些类
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin

# ---------- 压制无关警告 ----------
# 这些是可选依赖（如 androidx 的某些 profileinstaller），缺失不影响运行
-dontwarn com.getcapacitor.**
-dontwarn org.apache.cordova.**
-dontwarn androidx.**
