package xyz.shadowshub.appruntime

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CoroutineScope
import xyz.shadowshub.core.network.AppDetail
import xyz.shadowshub.core.network.WebosApi
import java.io.File

/**
 * App Runtime：WebView 沙箱加载版本化 HTML App（M0-3 验证）。
 * - 注入：<base href=raw 端点> + app-runtime-bootstrap.js（SDK shim + localStorage polyfill）
 * - 桥：addJavascriptInterface dailyBridge → storage 走 native OkHttp（带 cookie，不暴露 token）
 * - 导航白名单：仅允许平台域（shadowshub.xyz / 127.0.0.1），外链阻断（后续按 manifest network.domains 细化）
 */
class AppRuntimeHost(
    private val context: Context,
    private val api: WebosApi,
    private val scope: CoroutineScope,
    private val baseUrl: String = "https://shadowshub.xyz",
) {

    @SuppressLint("SetJavaScriptEnabled")
    fun createWebView(): WebView {
        val webView = WebView(context)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                // 仅放行平台域（raw 素材端点 + 平台页面）；其余阻断（M0-3 简单策略）
                return !isAllowedUrl(url)
            }
        }
        return webView
    }

    /** 加载 App：注入 base + bootstrap，用 loadDataWithBaseURL 以空 base 加载（相对素材走 base href） */
    fun loadApp(webView: WebView, detail: AppDetail, onLoaded: (() -> Unit)? = null) {
        val html = detail.activeHtml ?: return
        val bootstrap = readBootstrap()
        val contextJson = """{"app":{"id":"${detail.id}","name":"${escapeJson(detail.name)}"},"capabilities":["app.storage.private"],"sdkVersion":"0.1.0"}"""
        val baseTag = "<base href=\"$baseUrl/webos/api/apps/${detail.id}/files/raw?scope=app&amp;path=\">"
        val script = "<script>window.__DAILY_WEBOS_CONTEXT__=${contextJson.replace("</", "<\\/")};</script>" +
            "<script data-daily-webos-runtime>$bootstrap</script>"

        val finalHtml = injectIntoHead(html, baseTag + script)
        webView.addJavascriptInterface(
            DailyJsBridge(
                appId = detail.id,
                api = api,
                scope = scope,
                onResponse = { json -> postToJs(webView, json) },
            ),
            "dailyBridge",
        )
        webView.loadDataWithBaseURL(null, finalHtml, "text/html", "utf-8", null)
        onLoaded?.invoke()
    }

    private fun postToJs(webView: WebView, json: String) {
        val escaped = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
        webView.post {
            webView.evaluateJavascript("window.__dailySdkDispatch('$escaped');", null)
        }
    }

    private fun isAllowedUrl(url: String): Boolean {
        val host = runCatching { android.net.Uri.parse(url).host }.getOrNull() ?: return false
        return host == "shadowshub.xyz" || host == "www.shadowshub.xyz" || host == "127.0.0.1" || host == "localhost"
    }

    private fun readBootstrap(): String {
        return try {
            context.assets.open("app-runtime-bootstrap.js").bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            "// bootstrap missing"
        }
    }

    private fun injectIntoHead(html: String, injection: String): String {
        val idx = html.indexOf("</head>", ignoreCase = true)
        return if (idx >= 0) html.substring(0, idx) + injection + html.substring(idx)
        else injection + html
    }

    private fun escapeJson(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")

    companion object {
        fun destroy(webView: WebView?) {
            webView?.let {
                it.removeJavascriptInterface("dailyBridge")
                it.stopLoading()
                it.loadUrl("about:blank")
                it.destroy()
            }
        }
    }
}