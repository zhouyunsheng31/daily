package xyz.shadowshub.daily.ui.desktop

import android.app.Application
import android.webkit.WebView
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.koin.android.ext.android.getKoin
import xyz.shadowshub.appruntime.AppRuntimeHost
import xyz.shadowshub.core.network.AppDetail
import xyz.shadowshub.core.network.WebosApi
import xyz.shadowshub.daily.BuildConfig

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
    /** 宿主级保存的 WebView 实例（跨 Pager 页面切换保持，避免反复重载卡顿） */
    savedWebView: MutableState<WebView?> = remember { mutableStateOf(null) },
    /** 宿主级保存的 AppDetail（页面重建不重拉，避免"加载中"闪烁） */
    savedDetail: MutableState<AppDetail?> = remember { mutableStateOf(null) },
    onSwipeToChat: () -> Unit = {},
) {
    val context = LocalContext.current
    val api: WebosApi = remember {
        (context.applicationContext as Application).getKoin().get()
    }
    val scope = rememberCoroutineScope()
    val host = remember { AppRuntimeHost(context, api, scope, BuildConfig.API_BASE_URL, onOpenApp, onNavigate) }

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

    val detail = savedDetail.value

    Box(Modifier.fillMaxSize()) {
        when {
            error != null -> Text(
                error!!,
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                color = MaterialTheme.colorScheme.error,
            )
            detail != null -> AndroidView(
                factory = { ctx ->
                    savedWebView.value?.also {
                        android.util.Log.d("AppRuntime", "desktop WebView reused（免重载）")
                    } ?: host.createWebView().also { wv ->
                        savedWebView.value = wv
                        // 关键：延迟到 WebView 完成首次布局后再加载（M0-4 白屏根因，勿删）
                        wv.post { host.loadApp(wv, detail!!) }
                    }
                },
                update = {},
                // 不销毁：复用实例（进程内常驻单 WebView，避免 Pager 来回切换反复重载卡顿）
                onRelease = {},
            )
            else -> Text("加载中…", modifier = Modifier.align(Alignment.Center))
        }

        // 右滑让渡层（仅消费"横向右滑"，其余放行 WebView）
        Box(
            Modifier
                .matchParentSize()
                .pointerInput(Unit) {
                    var triggered = false
                    var totalDx = 0f
                    detectHorizontalDragGestures(
                        onDragEnd = { triggered = false },
                        onDragCancel = { triggered = false },
                    ) { change, dragAmount ->
                        totalDx += dragAmount
                        if (!triggered && totalDx > 80f) { // 右滑累计超过阈值 → 切对话页
                            triggered = true
                            change.consume()
                            onSwipeToChat()
                        } else {
                            change.consume()
                        }
                    }
                },
        )
    }
}