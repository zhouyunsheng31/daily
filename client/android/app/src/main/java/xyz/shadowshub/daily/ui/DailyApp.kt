package xyz.shadowshub.daily.ui

import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import xyz.shadowshub.core.network.AppDetail
import xyz.shadowshub.daily.ui.apps.AppRunScreen
import xyz.shadowshub.daily.ui.chat.ChatScreen
import xyz.shadowshub.daily.ui.desktop.DesktopHostScreen

/**
 * 沉浸式宿主骨架（M1-1 · D18 方案 A 横滑导航，替代旧 4 Tab）。
 *
 * 页面序列：[ 💬 AI 对话页（宿主 Compose）| 🖥 桌面页 1..N（HTML WebView）]
 * - 初始页 = 桌面（index 1）；桌面继续右滑 → 露出对话页（负一屏）
 * - App 运行页（AppRunScreen）= 全屏覆盖层（无顶栏，沉浸）
 * - 无底部 Tab 栏 / 无 Scaffold 顶栏；壁纸透底（MainActivity enableEdgeToEdge）
 * - M1-1 降级：桌面页 WebView 拦截横滑，桌面→对话用顶部按钮（M1-4 做手势让渡）
 */
@Composable
fun DailyApp() {
    // 初始页 = 桌面（index 1）：直接以桌面为第一帧，避免冷启动先闪对话页再跳转
    val pagerState = rememberPagerState(initialPage = 1, pageCount = { 2 })
    val scope = rememberCoroutineScope()

    // 桌面 WebView 实例提升到宿主级：跨 Pager 页面切换保持（避免来回滑动反复重载卡顿）
    val savedDesktopWebView = remember { mutableStateOf<WebView?>(null) }
    // 桌面 AppDetail 同样提升到宿主级：页面重建不重拉（避免"加载中"闪烁）
    val savedDesktopDetail = remember { mutableStateOf<AppDetail?>(null) }

    // 打开的 App（全屏运行页，覆盖主 UI）
    var openApp by remember { mutableStateOf<Pair<String, String>?>(null) }

    /** App 运行页/桌面里的 apps.open（图标点击）→ 宿主分发：
     *  daily.ai → 对话页（Pager page 0）；其余 → 全屏运行页 */
    val handleOpenApp: (String, String) -> Unit = { id, name ->
        when (id) {
            "daily.ai" -> {
                openApp = null
                scope.launch { pagerState.animateScrollToPage(0) }
            }
            else -> { openApp = id to name }
        }
    }

    /** system.navigate → 关闭运行页 + 切 Pager 页（assistant→对话，其余→桌面） */
    val handleNavigate: (String) -> Unit = { view ->
        openApp = null
        scope.launch { pagerState.animateScrollToPage(if (view == "assistant") 0 else 1) }
    }

    if (openApp != null) {
        AppRunScreen(
            appId = openApp!!.first,
            appName = openApp!!.second,
            onBack = { openApp = null },
            onOpenApp = handleOpenApp,
            onNavigate = handleNavigate,
        )
        return
    }

    // 初始页 = 桌面（index 1）
    // （initialPage=1 已保证第一帧在桌面，无需 scrollToPage）

    // 系统返回语义：对话页（page 0）返回 → 回桌面；桌面页返回 → 默认退出 Daily
    BackHandler(enabled = pagerState.currentPage == 0) {
        scope.launch { pagerState.animateScrollToPage(1) }
    }

    HorizontalPager(
        state = pagerState,
        // 关键（2026-08-16 桌面点击随机失败根因修复）：桌面页（page 1）禁用 Pager 滑动——
        // Pager 会在 down 后参与触摸竞争（横向 slop 判定），手指有小位移时拦截事件序列，
        // WebView 只收到 down（点击动画）收不到 up（JS 不触发）→ 图标点不开。
        // 桌面页的翻页完全交给 WebView OnTouchListener 的右滑让渡（onSwipeToChat）；
        // 对话页（page 0）保留 Pager 滑动（对话→桌面）。
        userScrollEnabled = pagerState.currentPage == 0,
        modifier = Modifier,
    ) { page ->
        when (page) {
            0 -> ChatScreen()
            1 -> DesktopHostScreen(
                onOpenApp = handleOpenApp,
                onNavigate = handleNavigate,
                savedWebView = savedDesktopWebView,
                savedDetail = savedDesktopDetail,
                onSwipeToChat = { scope.launch { pagerState.animateScrollToPage(0) } },
            )
        }
    }
}