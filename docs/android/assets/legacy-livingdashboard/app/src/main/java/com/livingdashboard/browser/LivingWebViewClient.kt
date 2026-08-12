package com.livingdashboard.browser

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.util.Log
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.livingdashboard.script.RunAt
import com.livingdashboard.script.ScriptInjector

/**
 * Living Dashboard WebViewClient（Spec 3.2.2，含 C7 + C10 修复）。
 *
 * C7 修复：`shouldOverrideUrlLoading` 对 http/https 不拦截；对 tel/mailto/sms/intent/market/
 * weixin/alipays 等非 http(s) scheme 用 `Intent(ACTION_VIEW)` 启动外部 Activity 并返回 true 拦截；
 * 启动失败 catch ActivityNotFoundException 回调 onError。
 *
 * C10 修复：
 * - `onReceivedError` 只处理主帧错误（`request.isForMainFrame`），子资源错误不打扰用户
 * - `onReceivedSslError` 回调 onError，调用 `handler.cancel()`（不调用 proceed，安全考虑）
 *
 * @param onUrlChange URL 变化回调
 * @param onBackForwardStateChange 后退/前进状态变化回调（canGoBack, canGoForward）
 * @param onPageFinished 页面加载完成回调（url, title）
 * @param onError 错误回调
 */
class LivingWebViewClient(
    private val onUrlChange: (String) -> Unit,
    private val onBackForwardStateChange: (Boolean, Boolean) -> Unit,
    private val onPageFinished: (String, String) -> Unit,
    private val onError: (String) -> Unit,
    private val scriptInjector: ScriptInjector? = null,
) : WebViewClient() {

    /**
     * C7 修复：URL 拦截逻辑。
     * - http/https：不拦截，返回 false（WebView 自己加载）
     * - tel/mailto/sms/intent/market/weixin/alipays 等：启动外部 Activity，返回 true 拦截
     * - 未知 scheme：尝试启动外部 Activity，失败则返回 false 走默认行为
     */
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        val scheme = url.scheme?.lowercase()
        return when (scheme) {
            "http", "https" -> {
                val urlStr = url.toString()
                // v3 修复 M8：拦截 .user.js 后缀 URL（导入方式 C），交给 ScriptInjector 处理（下载→解析→弹 Dialog）
                if (urlStr.endsWith(".user.js")) {
                    scriptInjector?.onUserScriptUrlDetected(urlStr)
                    return true  // 拦截下载
                }
                // WebView 自己加载，回调通知地址栏更新
                onUrlChange(urlStr)
                false
            }
            "tel", "mailto", "sms", "intent", "market", "weixin", "alipays" -> {
                // 非 http/https scheme：启动外部 Activity 拦截
                try {
                    val intent = Intent(Intent.ACTION_VIEW, url)
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    view.context.startActivity(intent)
                } catch (e: ActivityNotFoundException) {
                    Log.w("LivingWebView", "No app to handle scheme: $scheme", e)
                    onError("没有应用可以打开此链接（$scheme）")
                } catch (e: Exception) {
                    Log.w("LivingWebView", "Failed to launch external intent for $url", e)
                    onError("打开外部应用失败")
                }
                true  // 拦截，不让 WebView 处理
            }
            else -> {
                // 未知 scheme：交给系统处理，但拦截避免 WebView 报错
                try {
                    val intent = Intent(Intent.ACTION_VIEW, url)
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    view.context.startActivity(intent)
                    true
                } catch (e: Exception) {
                    Log.w("LivingWebView", "Unknown scheme $scheme, cannot handle", e)
                    false  // 让 WebView 走默认行为
                }
            }
        }
    }

    /** 页面开始加载：回调 onUrlChange + onBackForwardStateChange + M4 注入 document-start 脚本 */
    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        onUrlChange(url)
        onBackForwardStateChange(view.canGoBack(), view.canGoForward())
        // M4（Spec 2.4.4）：document-start 脚本在 onPageStarted 时立即注入
        scriptInjector?.injectForUrl(view, url, RunAt.DOCUMENT_START)
    }

    /** 页面加载完成：回调 onPageFinished(url, title) + onBackForwardStateChange + M4 注入 document-end/idle 脚本 */
    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        val title = view.title ?: ""
        onPageFinished(url, title)
        onBackForwardStateChange(view.canGoBack(), view.canGoForward())
        // M4（Spec 2.4.4）：document-end 在 onPageFinished 时注入
        scriptInjector?.injectForUrl(view, url, RunAt.DOCUMENT_END)
        // M4（Spec 2.4.4）：document-idle 在 onPageFinished 后 postDelayed 100ms 注入
        view.postDelayed({ scriptInjector?.injectForUrl(view, url, RunAt.DOCUMENT_IDLE) }, 100L)
    }

    /**
     * C10 修复：网络错误回调，只处理主帧错误，子资源错误不打扰用户。
     */
    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        super.onReceivedError(view, request, error)
        // 只处理主帧错误，子资源错误（图片、CSS 等）不打扰用户
        if (request != null && request.isForMainFrame) {
            val msg = error?.description?.toString() ?: "未知错误"
            Log.w("LivingWebView", "onReceivedError: ${request.url} -> $msg")
            onError("页面加载失败：$msg")
        }
    }

    /**
     * C10 修复：SSL 错误回调。
     * M1 简化：取消加载 + 提示，不弹证书选择，不调用 handler.proceed()（安全考虑）。
     */
    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        super.onReceivedSslError(view, handler, error)
        Log.w("LivingWebView", "onReceivedSslError: ${error?.url} -> ${error?.primaryError}")
        handler?.cancel()
        onError("SSL 证书错误，已停止加载")
    }
}
