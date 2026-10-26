package cc.ccwu.zmq.photowall;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

/**
 * 主 Activity。
 *
 * 【为什么需要覆写返回键（2026-10-24 实测缺陷）】
 * 直接继承 BridgeActivity 且什么都不做时，Android 的物理返回键会一路冒到系统，
 * 于是任何页面（包括画报资料卡、大图查看器打开着的时候）按一下就直接退回桌面，
 * 既不关弹层、也不回上一页 —— 对 Android 用户来说这是最明显的「不像 APP」。
 *
 * 【为什么不让 WebView 自己 goBack】
 * 本项目的页面切换是「转场动画播完之后再由 router.push 发起」的程序化导航，
 * WebView 的 history 栈在这种时序下并不可靠（连续点击、转场被丢弃时更明显）。
 * 所以改由前端自己在 window.__pwBack__ 里维护一个轻量导航栈 + 弹层栈：
 *   true  = 已经处理（关了一层弹层 / 退了一页）
 *   false = 前端已到根（登录页且没有弹层），交给系统退出 APP
 *
 * 【异步性】evaluateJavascript 的回调是异步的，系统在回调到达前不能决定
 * 「是否消费这次返回键」，所以这里先无条件接管：
 *   - 回调说处理不了 → finish() 退出；
 *   - 回调迟迟不来（WebView 卡死 / 页面白屏）→ 1 秒后兜底退出，绝不卡死。
 */
public class MainActivity extends BridgeActivity {

    /** 兜底退出延时：评估回调丢失时不让用户觉得「返回键坏了」。 */
    private static final long BACK_FALLBACK_MS = 1000L;

    private boolean backPending = false;

    /**
     * 【启动画面必须在这里装】
     * AppTheme.NoActionBarLaunch 继承的是父主题 "Theme.SplashScreen"（不带 .DayNight），
     * 这个父主题在 values/ 里故意是空的，SplashScreen 相关的颜色和图标要靠
     * SplashScreen.installSplashScreen() 在 super.onCreate() 之前注入。
     * 少了这一行，冷启动就是一块没有任何图标的纯色屏，直到 WebView 画完才出现内容。
     *
     * 顺序不能颠倒：必须先 install，再交给 BridgeActivity 去 createView。
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onBackPressed() {
        final WebView webView = (bridge != null) ? bridge.getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }

        // 连按两次返回：第二次直接退出，避免被前一次的回调拖住。
        if (backPending) {
            finish();
            return;
        }
        backPending = true;

        webView.evaluateJavascript(
            "(function(){try{return (typeof window.__pwBack__ === 'function') ? window.__pwBack__() : false;}catch(e){return false;}})()",
            value -> {
                backPending = false;
                boolean handled = value != null && value.contains("true");
                if (!handled) {
                    finish();
                }
            }
        );

        // 兜底：回调没回来也不能让用户觉得返回键失灵。
        webView.postDelayed(() -> {
            if (backPending) {
                backPending = false;
                if (!isFinishing()) {
                    finish();
                }
            }
        }, BACK_FALLBACK_MS);
    }
}
