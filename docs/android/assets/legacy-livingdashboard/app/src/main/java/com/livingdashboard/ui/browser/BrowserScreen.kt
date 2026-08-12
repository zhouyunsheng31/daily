package com.livingdashboard.ui.browser

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.browser.DefaultBrowserHelper
import com.livingdashboard.browser.LivingWebView
import com.livingdashboard.browser.rememberWebViewController
import com.livingdashboard.ui.browser.components.AddressBar
import com.livingdashboard.ui.browser.components.ProgressBar
import com.livingdashboard.ui.components.AiConversationOverlay
import com.livingdashboard.ui.components.BottomBar
import com.livingdashboard.ui.components.MoreMenuSheet

/**
 * 浏览器页（Spec 3.3.3）。
 *
 * 布局：
 * ```
 * ┌─────────────────────────────┐
 * │ 🔒 baidu.com          [⋮]  │  ← 地址栏
 * ├─────────────────────────────┤
 * │ ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░  │  ← 加载进度条
 * ├─────────────────────────────┤
 * │      WebView 内容区          │
 * ├─────────────────────────────┤
 * │ [←][→] [Home] [标签] [⋮]    │  ← 底部栏
 * └─────────────────────────────┘
 * ```
 *
 * NC4：创建 `WebViewController`，传给 `LivingWebView`，供 BottomBar 调用 goBack/goForward。
 *
 * Bug-1 修复：底部栏"更多"按钮不再直接导航到设置页，而是展开 MoreMenuSheet 半屏面板。
 * Bug-2 修复：MoreMenuSheet 的"查看书签/历史"回调连接到导航路由，提供 UI 入口。
 * Bug-3 修复：LivingWebView 的 uaMode/javaScriptEnabled 改为消费 uiState（由设置页驱动）。
 *
 * @param onBack 系统返回键回调（导航回主页或标签页）
 * @param onOpenTabs 底部栏标签按钮回调
 * @param onNavigateToBookmarks 更多菜单"查看书签"回调（Bug-2：书签页 UI 入口）
 * @param onNavigateToHistory 更多菜单"历史"回调（Bug-2：历史页 UI 入口）
 * @param onNavigateToSettings 更多菜单"设置"回调
 * @param onNavigateToHome 底部栏 Home 按钮回调
 * @param viewModel 浏览器 ViewModel（由 hiltViewModel() 获取，自动注入 SavedStateHandle）
 */
@Composable
fun BrowserScreen(
    onBack: () -> Unit,
    onOpenTabs: () -> Unit,
    onNavigateToBookmarks: () -> Unit,
    onNavigateToHistory: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToHome: () -> Unit,
    viewModel: BrowserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    // M3 6.13：AI 模式状态（底部栏 AI 输入框 + 半屏对话浮层）
    val aiState by viewModel.aiModeState.collectAsStateWithLifecycle()

    // NC4：创建 WebViewController，传给 LivingWebView，供 BottomBar 调用 goBack/goForward
    val controller = rememberWebViewController()
    val context = LocalContext.current
    // 递归找出 Activity（用于 finishAffinity 和 DefaultBrowserHelper）
    val activity = remember(context) { context.findActivity() }

    // Bug-1 修复：更多菜单半屏面板显示状态（由本页内部管理，不再导航到设置页）
    var showMoreMenu by remember { mutableStateOf(false) }

    // 任务1 autoHideBar：地址栏 + 底部栏自动收缩状态（向下滚动收起，向上滚动唤起）
    var barsVisible by remember { mutableStateOf(true) }

    // 系统返回键处理：WebView 可后退时优先后退，否则调用 onBack 返回上页
    // （MoreMenuSheet 展开时由 ModalBottomSheet 自身处理返回键关闭）
    BackHandler(enabled = true) {
        if (uiState.canGoBack) {
            controller.goBack()
        } else {
            onBack()
        }
    }

    // Snackbar 状态（错误提示）
    val snackbarHostState = remember { SnackbarHostState() }

    // errorMessage 变化时显示 Snackbar
    LaunchedEffect(uiState.errorMessage) {
        val msg = uiState.errorMessage
        if (msg != null) {
            snackbarHostState.showSnackbar(message = msg)
            viewModel.clearError()
        }
    }

    // 地址栏提交：用 buildUrlFromInput 构建 URL，调用 controller.loadUrl
    val onUrlSubmit: (String) -> Unit = { input ->
        val url = viewModel.buildUrlFromInput(input)
        if (url.isNotEmpty()) {
            controller.loadUrl(url)
        }
    }

    // Bug-1 修复：设为默认浏览器的 RoleManager 请求 launcher
    val defaultBrowserLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { /* 结果不关心，用户可在系统设置中查看是否已设为默认 */ }

    // Bug-1 修复：MoreMenuSheet 各回调连接到实际功能
    // 添加书签：调用 ViewModel 持久化到 Room
    val onAddBookmark: () -> Unit = {
        val url = uiState.currentUrl
        if (url.isNotEmpty()) {
            viewModel.addBookmark(url, uiState.currentTitle)
            Toast.makeText(context, "已添加书签", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(context, "当前无页面可收藏", Toast.LENGTH_SHORT).show()
        }
    }
    // 下载：M1 占位，提示"暂未实现"（Spec 3.3.6）
    val onDownload: () -> Unit = {
        Toast.makeText(context, "下载功能暂未实现", Toast.LENGTH_SHORT).show()
    }
    // 分享：用 Intent.ACTION_SEND 分享当前 URL
    val onShare: () -> Unit = {
        val url = uiState.currentUrl
        if (url.isNotEmpty()) {
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, url)
            }
            context.startActivity(Intent.createChooser(shareIntent, "分享链接"))
        }
    }
    // 复制链接：写入系统剪贴板
    val onCopyLink: () -> Unit = {
        val url = uiState.currentUrl
        if (url.isNotEmpty()) {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("URL", url))
            Toast.makeText(context, "已复制链接", Toast.LENGTH_SHORT).show()
        }
    }
    // 设为默认浏览器：用 RoleManager 请求（DefaultBrowserHelper）
    val onSetDefaultBrowser: () -> Unit = {
        activity?.let { act ->
            DefaultBrowserHelper.createRequestRoleIntent(act)?.let { intent ->
                defaultBrowserLauncher.launch(intent)
            }
        }
    }
    // 清除 Cookie：委托给 ViewModel（CookieManagerWrapper）
    val onClearCookies: () -> Unit = {
        viewModel.clearCookies()
        Toast.makeText(context, "已清除 Cookie", Toast.LENGTH_SHORT).show()
    }
    // 退出：finishAffinity 退出 App
    val onExit: () -> Unit = {
        activity?.finishAffinity()
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                // 任务1 autoHideBar：地址栏 + 进度条，向下滚动收起（向上滑出），向上滚动唤起（从顶部滑入）
                AnimatedVisibility(
                    visible = barsVisible,
                    enter = slideInVertically(animationSpec = tween(300)) { -it },
                    exit = slideOutVertically(animationSpec = tween(300)) { -it },
                ) {
                    Column {
                        // 顶部地址栏
                        AddressBar(
                            currentUrl = uiState.currentUrl,
                            onUrlSubmit = onUrlSubmit,
                            isLoading = uiState.progress < 100,
                            onRefresh = { controller.reload() },
                            onStop = { controller.stopLoading() },
                            modifier = Modifier.fillMaxWidth()
                        )

                        // 加载进度条（progress < 100 时显示）
                        ProgressBar(progress = uiState.progress)
                    }
                }

                // WebView 内容区（填充剩余空间）
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    LivingWebView(
                        url = uiState.currentUrl,
                        onUrlChange = viewModel::onUrlChange,
                        onTitleChange = viewModel::onTitleChange,
                        onProgressChange = viewModel::onProgressChange,
                        onBackForwardStateChange = viewModel::onBackForwardStateChange,
                        onError = viewModel::onError,
                        // 任务1 autoHideBar：滚动监听，向下滚动收起栏，向上滚动唤起栏
                        onScrollChange = { scrollY, oldScrollY ->
                            val delta = scrollY - oldScrollY
                            // 向下滚动且非顶部 → 收起；AI 模式下不收起（避免遮挡 AI 输入框）
                            if (scrollY > 0 && delta > 10 && barsVisible && !aiState.aiMode) {
                                barsVisible = false
                            } else if (delta < -10 && !barsVisible) {
                                // 向上滚动 → 唤起
                                barsVisible = true
                            }
                        },
                        controller = controller,
                        uaMode = uiState.uaMode,  // Bug-3 修复：UA 模式由设置页驱动
                        javaScriptEnabled = uiState.javaScriptEnabled,  // Bug-3 修复：JS 开关由设置页驱动
                        modifier = Modifier.fillMaxSize(),
                        activeWebViewHolder = viewModel.activeWebViewHolder,  // M8：注入 holder，工具侧可读取 WebView
                        // M4（Spec 2.4.7 / v3 修复 S8）：脚本注入器 + GM API 桥接透传给 LivingWebView
                        scriptInjector = viewModel.scriptInjector,
                        gmApiBridge = viewModel.gmApiBridge,
                    )
                    // M3 6.13：AI 对话浮层（半屏，aiExpanded=true 时显示）
                    if (aiState.aiExpanded) {
                        AiConversationOverlay(
                            messages = aiState.aiMessages,
                            onClose = viewModel::collapseAi,
                            modifier = Modifier.align(Alignment.BottomCenter),
                        )
                    }
                }

                // 任务1 autoHideBar：底部栏，向下滚动收起（向下滑出），向上滚动唤起（从底部滑入）
                AnimatedVisibility(
                    visible = barsVisible,
                    enter = slideInVertically(animationSpec = tween(300)) { it },
                    exit = slideOutVertically(animationSpec = tween(300)) { it },
                ) {
                    // 底部栏（M3 6.13：接入 AI 输入框模式 + 任务2 左右滑切换 + AI 工作态）
                    BottomBar(
                        canGoBack = uiState.canGoBack,
                        canGoForward = uiState.canGoForward,
                        onBack = { controller.goBack() },        // NC4：直接调用 WebView.goBack()
                        onForward = { controller.goForward() },  // NC4：直接调用 WebView.goForward()
                        onHome = onNavigateToHome,
                        onTabs = onOpenTabs,
                        onMore = { showMoreMenu = true },  // Bug-1 修复：更多按钮展开半屏面板
                        tabCount = uiState.tabCount,
                        // M3 6.13：AI 模式参数
                        aiMode = aiState.aiMode,
                        aiInputText = aiState.aiInputText,
                        onAiInputTextChange = viewModel::onAiInputTextChange,
                        onAiSend = viewModel::onAiSend,
                        // 任务2：左滑切换 AI 模式，右滑切回按钮模式
                        onSwipeLeftToAiMode = viewModel::expandAiMode,
                        onSwipeRightToButtonMode = viewModel::collapseAiMode,
                        showSwipeHint = true,  // 任务2：浏览器页显示左右滑动指示器
                        // AI 工作态（设计稿状态 3/3）
                        aiWorking = aiState.aiWorking,
                        aiWorkingStatusText = aiState.aiWorkingStatusText,
                        onExpandAiPanel = viewModel::expandAiPanel,
                    )
                }
            }

            // Snackbar 宿主（浮在底部栏上方，不占用布局空间）
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier.align(Alignment.BottomCenter)
            )
        }
    }

    // Bug-1 修复：渲染更多菜单半屏面板（MoreMenuSheet 不再是死代码）
    // Bug-2 修复：onOpenBookmarks/onOpenHistory 连接到导航路由，提供书签/历史页 UI 入口
    MoreMenuSheet(
        show = showMoreMenu,
        onDismiss = { showMoreMenu = false },
        onAddBookmark = onAddBookmark,
        onOpenBookmarks = onNavigateToBookmarks,
        onOpenHistory = onNavigateToHistory,
        onDownload = onDownload,
        onShare = onShare,
        onCopyLink = onCopyLink,
        onOpenSettings = onNavigateToSettings,
        onSetDefaultBrowser = onSetDefaultBrowser,
        onClearCookies = onClearCookies,
        onExit = onExit
    )
}

/**
 * 从 Context 递归找出 Activity（用于 finishAffinity 和 DefaultBrowserHelper）。
 * LocalContext 可能是 ContextWrapper 包裹的 Activity，需逐层解包。
 */
private fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
