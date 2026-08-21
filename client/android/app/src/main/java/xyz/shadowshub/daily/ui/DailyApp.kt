package xyz.shadowshub.daily.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Application
import android.content.Context
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.koin.android.ext.android.getKoin
import xyz.shadowshub.appruntime.DailyJsBridge
import xyz.shadowshub.core.network.WebosApi
import xyz.shadowshub.daily.BuildConfig
import xyz.shadowshub.daily.ui.theme.LoadingView

/**
 * 沉浸式 Daily Web 同构客户端宿主。
 *
 * 核心架构：
 * - 纯双端同构：直接消费 Web 端 HTML 模板与完整 Shell（对话页、桌面、应用商店全部统一）；
 * - 本地持久化：DOMStorage + CookieManager 同步；
 * - 沉浸全屏：edge-to-edge，无浏览器地址栏和工具栏；
 * - 原生手势与返回键支持：优雅响应 __dailySystemBack 钩子。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DailyApp() {
    val context = LocalContext.current
    val appScope = rememberCoroutineScope()
    val api: WebosApi = remember {
        (context.applicationContext as Application).getKoin().get()
    }

    var webViewInstance by remember { mutableStateOf<WebView?>(null) }
    var pageRendered by remember { mutableStateOf(false) }

    // 物理返回键处理：拦截并转发给 Web 端的 __dailySystemBack 钩子
    BackHandler(enabled = true) {
        val wv = webViewInstance
        if (wv != null) {
            wv.evaluateJavascript("window.__dailySystemBack ? __dailySystemBack() : false") { result ->
                if (result != "true") {
                    if (wv.canGoBack()) {
                        wv.goBack()
                    } else {
                        (context as? Activity)?.finish()
                    }
                }
            }
        } else {
            (context as? Activity)?.finish()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webViewInstance?.destroy()
            webViewInstance = null
        }
    }

    Box(Modifier.fillMaxSize().imePadding()) {
        AndroidView(
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    setBackgroundColor(0xFFF8F7F3.toInt())

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true
                        setSupportZoom(false)
                        builtInZoomControls = false
                        displayZoomControls = false
                        useWideViewPort = true
                        loadWithOverviewMode = true
                        cacheMode = WebSettings.LOAD_DEFAULT
                        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    }

                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    cookieManager.setAcceptThirdPartyCookies(this, true)

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val url = request.url.toString()
                            val host = request.url.host ?: ""
                            // 站内或相对路径放行，外部链接使用系统浏览器打开
                            return if (host.contains("shadowshub.xyz") || host == "localhost" || host == "127.0.0.1") {
                                false
                            } else {
                                runCatching {
                                    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, request.url)
                                    ctx.startActivity(intent)
                                }
                                true
                            }
                        }

                        override fun onPageFinished(view: WebView, url: String?) {
                            super.onPageFinished(view, url)
                            android.util.Log.d("AppRuntime", "Shell Web onPageFinished: $url")
                            // 页面首帧渲染完成后撤下品牌启动图
                            pageRendered = true
                        }
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(msg: android.webkit.ConsoleMessage): Boolean {
                            android.util.Log.d("AppRuntime", "webOS Console[${msg.messageLevel()}]: ${msg.message()}")
                            return true
                        }
                    }

                    // 注入 Native 增强桥
                    addJavascriptInterface(
                        DailyJsBridge(
                            appId = "system.shell",
                            api = api,
                            scope = appScope,
                            onResponse = { json ->
                                post {
                                    val escaped = json.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "")
                                    evaluateJavascript("window.__dailySdkDispatch('$escaped');", null)
                                }
                            },
                        ),
                        "dailyBridge",
                    )

                    // 启动加载 WebOS 移动端主站
                    val targetUrl = "${BuildConfig.API_BASE_URL}/daily/"
                    android.util.Log.d("AppRuntime", "Loading WebOS Shell: $targetUrl")
                    loadUrl(targetUrl)
                }.also {
                    webViewInstance = it
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        // 品牌冷启动过渡图（首屏渲染完毕前平滑展示）
        if (!pageRendered) {
            LoadingView()
        }
    }
}
