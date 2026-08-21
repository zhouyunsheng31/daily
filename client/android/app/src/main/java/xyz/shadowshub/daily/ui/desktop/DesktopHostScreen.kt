package xyz.shadowshub.daily.ui.desktop

import android.app.Application
import android.view.MotionEvent
import android.webkit.WebView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import org.koin.android.ext.android.getKoin
import xyz.shadowshub.appruntime.AppRuntimeHost
import xyz.shadowshub.core.network.AppDetail
import xyz.shadowshub.core.network.WebosApi
import xyz.shadowshub.daily.BuildConfig
import xyz.shadowshub.daily.ui.theme.LoadingView

/** 系统桌面 App 固定 id（桌面层 = HTML App，AI 可改、版本化回滚，D3/D18） */
private const val SYSTEM_DESKTOP_ID = "system.desktop"

/**
 * 桌面页宿主（M1-1 · D18 方案 A）：
 * - 沉浸全屏 WebView 渲染 system.desktop（无顶栏、edge-to-edge，无任何宿主按钮）
 * - 透传 apps.open / system.navigate 给宿主（DailyApp 分发）
 * - 返回机制：桌面在 Pager 最右页，系统返回 = 回对话页（由 DailyApp/系统处理，宿主不拦截）
 * - **WebView 实例复用**（M1-1 收尾）：Pager 切换不销毁重建，滑回即显示已加载内容，消除卡顿
 * - **右滑让渡**（M1-1 收尾，替代旧顶部箭头）：覆盖层只消费"横向右滑"（桌面→对话），
 *   点击/纵向滚动放行给 WebView；桌面 HTML 未来左滑翻页（M1-4）同样放行
 */
@Composable
fun DesktopHostScreen(
    onOpenApp: (id: String, name: String) -> Unit = { _, _ -> },
    onNavigate: (view: String) -> Unit = {},
    /** 宿主级常驻协程作用域（AppRuntimeHost 异步回调用，页面销毁后仍可用） */
    appScope: CoroutineScope,
    /** 宿主级保存的 WebView 实例（跨 Pager 页面切换保持，避免反复重载卡顿） */
    savedWebView: MutableState<WebView?> = remember { mutableStateOf(null) },
    /** 宿主级保存的 AppDetail（页面重建不重拉，避免"加载中"闪烁） */
    savedDetail: MutableState<AppDetail?> = remember { mutableStateOf(null) },
    /** 宿主级"已 loadApp"标记（翻页重建不复位，避免每次翻页回来重新加载桌面 = 刷新闪烁） */
    savedLoaded: MutableState<Boolean> = remember { mutableStateOf(false) },
    /** 宿主级"首帧渲染完成"标记（onPageFinished 置 true；品牌启动图覆盖到此时才撤下） */
    rendered: MutableState<Boolean> = remember { mutableStateOf(false) },
    onSwipeToChat: () -> Unit = {},
) {
    val context = LocalContext.current
    val api: WebosApi = remember {
        (context.applicationContext as Application).getKoin().get()
    }
    val host = remember { AppRuntimeHost(context, api, appScope, BuildConfig.API_BASE_URL, onOpenApp, onNavigate) }

    var error by remember { mutableStateOf<String?>(null) }

    // 首次组合且宿主级无缓存时才拉取详情
    LaunchedEffect(savedDetail.value) {
        if (savedDetail.value == null) {
            val d = api.appDetail(SYSTEM_DESKTOP_ID)
            android.util.Log.d("AppRuntime", "desktop appDetail: detail=${d != null}, htmlLen=${d?.activeHtml?.length ?: "null"}")
            if (d?.activeHtml != null) {
                savedDetail.value = d
            } else {
                error = "系统桌面加载失败 [appId=$SYSTEM_DESKTOP_ID, html=${d?.activeHtml?.length ?: "null"}]"
            }
        }
    }

    // detail 与 WebView 都就绪后加载一次（并行初始化：WebView 创建与网络请求同时进行，加速冷启动）
    // ⚠️ savedLoaded 必须宿主级：页面级标记在 Pager 翻页 dispose/重建后复位，会导致每次翻页
    // 回来都重新 loadApp（桌面 HTML 重新加载 = "不断刷新"卡顿）。宿主级 = 整个进程只加载一次。
    LaunchedEffect(savedDetail.value, savedWebView.value) {
        val d = savedDetail.value
        val wv = savedWebView.value
        if (d != null && wv != null && !savedLoaded.value) {
            savedLoaded.value = true
            // 关键：延迟到 WebView 完成首次布局后再加载（M0-4 白屏根因，勿删）
            wv.post {
                host.loadApp(wv, d) {
                    // 首帧渲染完成（onPageFinished）→ 撤下品牌启动图
                    rendered.value = true
                }
            }
        }
    }

    val detail = savedDetail.value
    val density = LocalDensity.current.density

    Box(Modifier.fillMaxSize()) {
        when {
            error != null -> Text(
                error!!,
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                color = MaterialTheme.colorScheme.error,
            )
            else -> {
                // WebView 总是挂载（detail 未到时先创建空 WebView，与网络请求并行初始化）
                AndroidView(
                    factory = { ctx ->
                        savedWebView.value?.also {
                            android.util.Log.d("AppRuntime", "desktop WebView reused（免重载）")
                        } ?: host.createWebView().also { wv ->
                            savedWebView.value = wv
                        }
                        // 右滑让渡：WebView 自身 OnTouchListener（不 consume，点击/滚动不受影响）
                        // ⚠️ 不能再用全屏 Compose pointerInput 覆盖层——命中后 Compose 事件不转发给
                        // Android 子 View，会吞掉 WebView 全部点击（2026-08-16 图标打不开根因）
                        val wv = savedWebView.value!!
                        var downX = 0f
                        var downY = 0f
                        var swipeTriggered = false
                        wv.setOnTouchListener { _, event ->
                            when (event.actionMasked) {
                                MotionEvent.ACTION_DOWN -> {
                                    downX = event.x
                                    downY = event.y
                                    swipeTriggered = false
                                }
                                MotionEvent.ACTION_MOVE -> {
                                    val dx = event.x - downX
                                    val dy = event.y - downY
                                    // 阈值 30dp（2026-08-16：80dp 太迟钝，轻滑不触发）
                                    val slopPx = 30f * density
                                    if (!swipeTriggered && dx > slopPx && abs(dx) > abs(dy) * 1.2f) {
                                        swipeTriggered = true
                                        onSwipeToChat()
                                    }
                                }
                            }
                            false // 不消费：WebView 正常处理点击/滚动
                        }
                        wv
                    },
                    update = {},
                    // 不销毁：复用实例（进程内常驻单 WebView，避免 Pager 来回切换反复重载卡顿）
                    onRelease = {},
                )
                // 品牌启动图：只覆盖到桌面首帧渲染完成（onPageFinished）。翻页回来 rendered=true 不再显示，
                // 且 WebView 已复用已渲染内容（不重新 loadApp）——不闪烁、不刷新
                if (!rendered.value) {
                    LoadingView()
                }
            }
        }
    }
}