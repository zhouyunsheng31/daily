package com.livingdashboard.browser

import android.graphics.Bitmap
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.livingdashboard.ai.ActiveWebViewHolder
import com.livingdashboard.data.prefs.UaMode
import com.livingdashboard.script.GmApiBridge
import com.livingdashboard.script.ScriptInjector

/** 移动端 UA（默认）— 在系统 UA 后追加 App 标识，便于网站识别（Spec 3.2.1） */
const val MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Mobile Safari/537.36 LivingDashboard/1.0"

/** 桌面端 UA — 用于"请求桌面版网站"（Spec 3.2.1） */
const val DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36 LivingDashboard/1.0"

/**
 * WebView 控制器（NC4）：暴露 inward 控制接口（goBack/goForward/reload/stopLoading/loadUrl）。
 *
 * 设计要点：
 * - `webViewRef` 是 `internal var`，由 `LivingWebView` 在 `remember` 块中赋值，`onDispose` 时置 null
 * - 调用方（BrowserScreen）用 `rememberWebViewController()` 创建实例，传给 `LivingWebView`
 * - 所有方法做空判断，避免 controller 在 WebView 销毁后被调用导致 NPE
 * - 不持有 Activity/Context 引用，避免内存泄漏（WebView 本身由 LivingWebView 管理生命周期）
 */
class WebViewController {
    internal var webViewRef: WebView? = null

    fun goBack() {
        webViewRef?.takeIf { it.canGoBack() }?.goBack()
    }

    fun goForward() {
        webViewRef?.takeIf { it.canGoForward() }?.goForward()
    }

    fun reload() {
        webViewRef?.reload()
    }

    fun stopLoading() {
        webViewRef?.stopLoading()
    }

    fun loadUrl(url: String) {
        webViewRef?.loadUrl(url)
    }

    /** 当前 URL（供调用方查询，例如地址栏显示） */
    val currentUrl: String? get() = webViewRef?.url
}

/** Composable 便捷创建函数，用 remember 缓存 controller 实例（NC4） */
@Composable
fun rememberWebViewController(): WebViewController = remember { WebViewController() }

/**
 * Living Dashboard WebView 封装（Spec 3.2.1，含 NC2 + NC4 修复）。
 *
 * NC2 修复：用 `rememberUpdatedState` 包装全部 6 个回调，确保 `remember` 块内的 Client 回调
 * 通过 delegate 读取最新值，避免闭包捕获旧值导致回调失效。
 *
 * NC4 修复：新增 `WebViewController`，传入后可外部调用 goBack/goForward/reload/stopLoading/loadUrl。
 *
 * 生命周期管理（C5 + M27）：
 * - `DisposableEffect(lifecycleOwner)` 监听 ON_PAUSE/ON_RESUME/ON_DESTROY
 * - `onDispose` 调用 `webView.destroy()` + 清除 controller 引用，防止内存泄漏
 * - Context 用 `applicationContext` 创建 WebView，避免持有 Activity 引用
 *
 * @param url 初始 URL
 * @param uaMode UA 模式（MOBILE/DESKTOP），仅在 WebView 创建时生效（M1 不支持热切换）
 * @param javaScriptEnabled 是否启用 JavaScript，仅在 WebView 创建时生效
 * @param onUrlChange URL 变化回调
 * @param onTitleChange 页面标题变化回调
 * @param onProgressChange 加载进度回调（0-100）
 * @param onBackForwardStateChange 后退/前进状态变化回调（canGoBack, canGoForward）
 * @param onFaviconChange 网站图标变化回调
 * @param onError 错误回调
 * @param modifier Compose Modifier
 * @param controller 可选的 WebViewController，传入后可外部控制 WebView
 * @param activeWebViewHolder 可选的 ActiveWebViewHolder，传入后 WebView 创建时写入引用、销毁时清空，
 *   供 BrowserEvalTool / BrowserNavigateTool / BrowserGetUrlTool 通过 webviewProvider() 读取
 */
@Composable
fun LivingWebView(
    url: String,
    uaMode: UaMode = UaMode.MOBILE,
    javaScriptEnabled: Boolean = true,
    onUrlChange: (String) -> Unit,
    onTitleChange: (String) -> Unit,
    onProgressChange: (Int) -> Unit,
    onBackForwardStateChange: (canGoBack: Boolean, canGoForward: Boolean) -> Unit,
    onFaviconChange: (Bitmap?) -> Unit = {},
    onError: (String) -> Unit = {},
    onScrollChange: (scrollY: Int, oldScrollY: Int) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier,
    controller: WebViewController? = null,
    activeWebViewHolder: ActiveWebViewHolder? = null,
    scriptInjector: ScriptInjector? = null,
    gmApiBridge: GmApiBridge? = null,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // NC2：用 rememberUpdatedState 包装回调，确保 remember 块内总能拿到最新引用。
    // Kotlin 闭包捕获的是首次 remember 执行时的参数引用，不会自动更新；
    // rememberUpdatedState 返回的 State<T> 会在每次重组时更新，闭包通过 delegate 读取最新值。
    val currentOnUrlChange by rememberUpdatedState(onUrlChange)
    val currentOnTitleChange by rememberUpdatedState(onTitleChange)
    val currentOnProgressChange by rememberUpdatedState(onProgressChange)
    val currentOnBackForwardStateChange by rememberUpdatedState(onBackForwardStateChange)
    val currentOnFaviconChange by rememberUpdatedState(onFaviconChange)
    val currentOnError by rememberUpdatedState(onError)
    val currentOnScrollChange by rememberUpdatedState(onScrollChange)

    // 用 remember 缓存 WebView 实例，避免重组时重建
    val webView = remember {
        // 用 applicationContext 创建避免 Activity 泄漏；UI 操作（如 Dialog）由调用方处理
        WebView(context.applicationContext).apply {
            settings.javaScriptEnabled = javaScriptEnabled
            settings.domStorageEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            // UA 字符串（Spec 3.2.1）
            settings.userAgentString = if (uaMode == UaMode.DESKTOP) {
                DESKTOP_UA
            } else {
                MOBILE_UA
            }
            // NC2：Client 在 factory 中创建一次，回调通过 rememberUpdatedState 的 delegate 读取最新值
            webViewClient = LivingWebViewClient(
                onUrlChange = { currentOnUrlChange(it) },
                onBackForwardStateChange = { b, f -> currentOnBackForwardStateChange(b, f) },
                onPageFinished = { _, t -> currentOnTitleChange(t) },
                onError = { currentOnError(it) },
                scriptInjector = scriptInjector,  // M4 透传
            )
            webChromeClient = LivingWebChromeClient(
                onProgressChange = { currentOnProgressChange(it) },
                onTitleChange = { currentOnTitleChange(it) },
                onFaviconChange = { currentOnFaviconChange(it) },
                gmApiBridge = gmApiBridge,  // M4 透传
            )
            // DownloadListener：M1 仅 Toast 提示
            setDownloadListener { _, _, _, _, _ ->
                Toast.makeText(context, "下载功能暂未实现（M7）", Toast.LENGTH_SHORT).show()
            }
            // 滚动监听（任务1 autoHideBar）：透传 scrollY/oldScrollY 给 BrowserScreen
            setOnScrollChangeListener { _, _, scrollY, _, oldScrollY ->
                currentOnScrollChange(scrollY, oldScrollY)
            }
            // NC4：把 WebView 引用赋给 controller，供外部调用 goBack/goForward 等
            controller?.webViewRef = this
            // M8：把 WebView 引用写入 ActiveWebViewHolder，供 BrowserEvalTool 等工具读取
            activeWebViewHolder?.value?.value = this
        }
    }

    // WebView 生命周期管理（C5 + M27）
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> webView.onPause()
                Lifecycle.Event.ON_RESUME -> webView.onResume()
                Lifecycle.Event.ON_DESTROY -> webView.destroy()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            // NC4：清除 controller 的 WebView 引用，避免 controller 在 WebView 销毁后被调用
            controller?.webViewRef = null
            // M8：清空 ActiveWebViewHolder 引用（compareAndSet 避免覆盖其他 WebView）
            activeWebViewHolder?.value?.compareAndSet(webView, null)
            webView.destroy()  // 防止内存泄漏
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { webView },  // 传入已创建并配置好的 WebView
        update = { wv ->
            // URL 变化时只调用 loadUrl，不重建 client；避免重复加载相同 URL
            if (url.isNotBlank() && wv.url != url) {
                wv.loadUrl(url)
            }
        }
    )
}
