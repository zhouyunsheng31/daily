package xyz.shadowshub.daily.ui

import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
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
    val pagerState = rememberPagerState(pageCount = { 2 })
    val scope = rememberCoroutineScope()

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
    LaunchedEffect(Unit) { pagerState.scrollToPage(1) }

    HorizontalPager(state = pagerState, modifier = Modifier) { page ->
        when (page) {
            0 -> ChatScreen()
            1 -> DesktopHostScreen(
                onOpenApp = handleOpenApp,
                onNavigate = handleNavigate,
                onChat = { scope.launch { pagerState.animateScrollToPage(0) } },
            )
        }
    }
}