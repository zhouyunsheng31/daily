package xyz.shadowshub.daily.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBars
import androidx.compose.ui.platform.LocalDensity
import kotlin.math.max
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import okhttp3.OkHttpClient
import org.koin.android.ext.android.getKoin
import xyz.shadowshub.appruntime.DailyJsBridge
import xyz.shadowshub.appruntime.WebResourceCacheHelper
import xyz.shadowshub.core.network.WebosApi
import xyz.shadowshub.daily.BuildConfig
import xyz.shadowshub.daily.ui.theme.LoadingView

/**
 * 沉浸式 Daily Web 同构客户端宿主。
 *
 * 核心架构：
 * - 纯双端同构：直接消费 Web 端 HTML 模板与完整 Shell（对话页、桌面、应用商店全部统一）；
 * - 本地持久化与离线缓存：DOMStorage + CookieManager + WebResourceCacheHelper 本地静态资源落盘；
 * - 沉浸全屏与安全区适配：statusBarsPadding / navigationBarsPadding 避让系统状态栏与手势条，消除重叠；
 * - 原生文件/图片选择器支持：完整实现 WebChromeClient.onShowFileChooser；
 * - 原生手势与返回键支持：优雅响应 __dailySystemBack 钩子。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DailyApp() {
    val context = LocalContext.current
    val appScope = rememberCoroutineScope()
    val koin = remember { (context.applicationContext as Application).getKoin() }
    val api: WebosApi = remember { koin.get() }
    val okHttpClient: OkHttpClient = remember { koin.get() }
    val cacheHelper = remember { WebResourceCacheHelper(context, okHttpClient, appScope) }

    var webViewInstance by remember { mutableStateOf<WebView?>(null) }
    var pageRendered by remember { mutableStateOf(false) }

    // 系统文件与图片选择器回调
    var fileChooserCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val fileChooserLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris: Array<Uri>? = if (result.resultCode == Activity.RESULT_OK) {
            val intent = result.data
            val clipData = intent?.clipData
            val dataUri = intent?.data
            if (clipData != null && clipData.itemCount > 0) {
                (0 until clipData.itemCount).map { clipData.getItemAt(it).uri }.toTypedArray()
            } else if (dataUri != null) {
                arrayOf(dataUri)
            } else {
                null
            }
        } else {
            null
        }
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    // 动态计算系统的状态栏、挖孔摄像头（DisplayCutout）与导航栏高度，安全注入到 Web 页面中（保持全屏壁纸铺满同时内容避让）
    val insets = WindowInsets.statusBars.asPaddingValues()
    val navInsets = WindowInsets.navigationBars.asPaddingValues()
    val cutoutInsets = WindowInsets.displayCutout.asPaddingValues()
    val rawStatusDp = insets.calculateTopPadding().value
    val rawCutoutDp = cutoutInsets.calculateTopPadding().value
    val statusBarDp = max(rawStatusDp, rawCutoutDp).let { if (it > 0) it else 44f }
    val navBarDp = navInsets.calculateBottomPadding().value.let { if (it > 0) it else 18f }

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
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = null
            webViewInstance?.destroy()
            webViewInstance = null
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .imePadding()
    ) {
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
                            val host = request.url.host ?: ""
                            // 站内或相对路径放行，外部链接使用系统浏览器打开
                            return if (host.contains("shadowshub.xyz") || host == "localhost" || host == "127.0.0.1") {
                                false
                            } else {
                                runCatching {
                                    val intent = Intent(Intent.ACTION_VIEW, request.url)
                                    ctx.startActivity(intent)
                                }
                                true
                            }
                        }

                        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                            return cacheHelper.interceptRequest(request) ?: super.shouldInterceptRequest(view, request)
                        }

                        override fun onPageFinished(view: WebView, url: String?) {
                            super.onPageFinished(view, url)
                            android.util.Log.d("AppRuntime", "Shell Web onPageFinished: $url")
                            // 注入系统安全区 CSS 变量：壁纸铺满全屏，内容完美避让状态栏与导航条
                            val safeTop = if (statusBarDp > 0) statusBarDp else 28f
                            val safeBottom = if (navBarDp > 0) navBarDp else 14f
                            val script = "document.documentElement.style.setProperty('--safe-top', '${safeTop}px'); document.documentElement.style.setProperty('--safe-bottom', '${safeBottom}px');"
                            view.evaluateJavascript(script, null)
                            // 页面首帧渲染完成后撤下品牌启动图
                            pageRendered = true
                        }
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(msg: android.webkit.ConsoleMessage): Boolean {
                            android.util.Log.d("AppRuntime", "webOS Console[${msg.messageLevel()}]: ${msg.message()}")
                            return true
                        }

                        // 支持 <input type="file">（文件、图片上传）
                        override fun onShowFileChooser(
                            webView: WebView?,
                            filePathCallback: ValueCallback<Array<Uri>>?,
                            fileChooserParams: FileChooserParams?
                        ): Boolean {
                            fileChooserCallback?.onReceiveValue(null)
                            fileChooserCallback = filePathCallback
                            return try {
                                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                                    type = "*/*"
                                    addCategory(Intent.CATEGORY_OPENABLE)
                                }
                                fileChooserLauncher.launch(intent)
                                true
                            } catch (_: Exception) {
                                fileChooserCallback?.onReceiveValue(null)
                                fileChooserCallback = null
                                false
                            }
                        }
                    }

                    // 注入 Native 增强桥
                    addJavascriptInterface(
                        DailyJsBridge(
                            appId = "system.shell",
                            api = api,
                            scope = appScope,
                            context = ctx,
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