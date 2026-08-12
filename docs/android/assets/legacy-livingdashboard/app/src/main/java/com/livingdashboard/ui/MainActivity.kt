package com.livingdashboard.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import com.livingdashboard.sync.DeviceAuth
import com.livingdashboard.sync.ServerConfig
import com.livingdashboard.sync.WsClient
import com.livingdashboard.ui.nav.AppNavGraph
import com.livingdashboard.ui.nav.Routes
import com.livingdashboard.ui.onboarding.HomeModeSelectorScreen
import com.livingdashboard.ui.script.ScriptImportViewModel
import com.livingdashboard.ui.theme.LivingDashboardTheme
import com.livingdashboard.ui.widget.LocalWidgetRegistry
import com.livingdashboard.ui.widget.WidgetRegistry
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * MainActivity（Spec 3.5 节 + Spec 8.1 节 M2 改造）。
 *
 * 职责：
 * 1. 保留 M0 的 WS 注入（wsClient/deviceAuth/serverConfig，C4 原则：M0 WS 逻辑保留不动）
 * 2. 接收外部 URL（ACTION_VIEW Intent）→ 存入 StateFlow → Composable 观察后创建标签 + 导航
 * 3. setContent 渲染 MainActivityContent（含导航图 + 主题色应用 + 外部 URL 处理）
 * 4. M2 改造：首次启动检测（defaultHomeMode == null 时显示 HomeModeSelectorScreen）
 *
 * C9 修复：用 MutableStateFlow<String?> 持有外部 URL，Composable 观察该 Flow 触发创建标签 + 导航。
 * NC3 修复：用 MainViewModel（@HiltViewModel）注入 TabRepository + SettingsStore，
 * Composable 通过 hiltViewModel<MainViewModel>() 获取，避免直接注入 Repository（无法编译）。
 *
 * launchMode = singleTop（AndroidManifest 配置）：保证 App 已在前台时收到新 URL 走 onNewIntent，
 * 而不是新建 Activity 实例。
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    // M0 注入保留（C4：WS 连接逻辑在 LivingDashboardApp.onCreate 中，此处仅保留注入字段）
    @Inject lateinit var wsClient: WsClient
    @Inject lateinit var deviceAuth: DeviceAuth
    @Inject lateinit var serverConfig: ServerConfig

    // M2 修复 P0 bug：注入 WidgetRegistry 单例（WidgetModule @Provides 提供），
    // 通过 CompositionLocalProvider 提供给 Compose 树，供 WidgetRenderer / WebOSFavoritesScreen 访问
    @Inject lateinit var widgetRegistry: WidgetRegistry

    // 持有外部 URL（来自 ACTION_VIEW Intent），Composable 观察后处理
    private val _pendingExternalUrl = MutableStateFlow<String?>(null)
    val pendingExternalUrl: StateFlow<String?> = _pendingExternalUrl.asStateFlow()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MainActivityContent(
                pendingExternalUrl = pendingExternalUrl,
                onExternalUrlConsumed = { _pendingExternalUrl.value = null },
                widgetRegistry = widgetRegistry
            )
        }
        // 处理启动 Intent（从外部点击 URL 启动 App）
        handleViewIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleViewIntent(intent)
    }

    /**
     * 处理 ACTION_VIEW Intent，提取 http/https URL 存入 StateFlow。
     *
     * Composable 会观察 pendingExternalUrl Flow，调用 MainViewModel.createTabForUrl(url)
     * 创建标签页后导航到 browser/{tabId}（Spec M22 时序）。
     */
    private fun handleViewIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) {
            val uri = intent.data
            if (uri != null && (uri.scheme == "http" || uri.scheme == "https")) {
                _pendingExternalUrl.value = uri.toString()
            }
        }
    }
}

/**
 * MainActivity 顶层 Composable（Spec 3.5 节 + Spec 8.1 节 M2 改造）。
 *
 * 职责：
 * 1. 用 hiltViewModel<MainViewModel>() 获取 MainViewModel（注入 TabRepository + SettingsStore）
 * 2. 收集 themeColorIndex 传给 LivingDashboardTheme
 * 3. 收集 externalUrl，LaunchedEffect 中调用 mainViewModel.createTabForUrl(url) 拿 tabId 后导航
 * 4. M2 新增：收集 defaultHomeMode，为 null（首次启动）时显示 HomeModeSelectorScreen
 * 5. M2 新增：收集 appMode，传给 AppNavGraph 决定 startDestination
 * 6. 渲染 AppNavGraph
 * 7. M4 修复 P1：订阅 ScriptImportViewModel.importNotifications，用全局 Snackbar 显示
 *    "已导入脚本: XXX" / "导入失败: XXX"（方式 C 自动导入通知）
 *
 * @param pendingExternalUrl 外部 URL Flow（来自 ACTION_VIEW Intent）
 * @param onExternalUrlConsumed 外部 URL 消费完毕回调（清空 Flow，避免重复处理）
 */
@Composable
fun MainActivityContent(
    pendingExternalUrl: StateFlow<String?>,
    onExternalUrlConsumed: () -> Unit,
    widgetRegistry: WidgetRegistry,
    mainViewModel: MainViewModel = hiltViewModel(),
    scriptImportViewModel: ScriptImportViewModel = hiltViewModel(),
) {
    // M1 保留：navController 在 MainActivityContent 内部创建，传给 AppNavGraph
    val navController = rememberNavController()

    // 主题色（NC3：从 MainViewModel 获取，不再直接声明 settingsStore）
    val themeColorIndex by mainViewModel.themeColorIndex.collectAsStateWithLifecycle()

    // M2 新增：App 模式（决定 AppNavGraph 的 startDestination）
    val appMode by mainViewModel.appMode.collectAsStateWithLifecycle()

    // M2 新增：首次启动检测（null = 未选择主页模式，显示 HomeModeSelectorScreen）
    val defaultHomeMode by mainViewModel.defaultHomeMode.collectAsStateWithLifecycle()

    // 观察外部 URL
    val externalUrl by pendingExternalUrl.collectAsStateWithLifecycle()

    // M4 修复 P1：订阅脚本导入通知
    val importNotification by scriptImportViewModel.importNotifications.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    // 外部 URL 变化时：创建标签页 + 导航到浏览器页
    LaunchedEffect(externalUrl) {
        val url = externalUrl ?: return@LaunchedEffect
        // NC3：通过 MainViewModel 创建标签页（内部处理 Room 写入），拿到 tabId
        val newTabId = mainViewModel.createTabForUrl(url)
        // 导航到浏览器页（此时 tabId 已存在 Room，见 M22 时序）
        navController.navigate(Routes.browser(newTabId)) {
            // 避免回退栈堆积多个外部 URL 实例
            popUpTo(Routes.BROWSER_HOME) { inclusive = false }
        }
        // 消费完毕，清空 Flow
        onExternalUrlConsumed()
    }

    // M4 修复 P1：脚本导入通知变化时显示 Snackbar
    LaunchedEffect(importNotification) {
        val result = importNotification ?: return@LaunchedEffect
        val message = if (result.success) {
            "已导入脚本: ${result.name}"
        } else {
            "导入失败: ${result.error ?: "未知错误"}"
        }
        snackbarHostState.showSnackbar(message)
        // 消费完毕，清空 StateFlow，避免 configuration change 后重复显示
        scriptImportViewModel.consumeNotification()
    }

    // M2 修复 P0 bug：用 CompositionLocalProvider 注入 WidgetRegistry，
    // 让 WidgetRenderer 和 WebOSFavoritesScreen 通过 LocalWidgetRegistry.current 访问
    CompositionLocalProvider(LocalWidgetRegistry provides widgetRegistry) {
        LivingDashboardTheme(themeColorIndex = themeColorIndex) {
            // M4 修复 P1：用 Box 包裹，SnackbarHost 放在底部，覆盖在内容之上
            Box(modifier = Modifier.fillMaxSize()) {
                when {
                    // D4：首次启动，defaultHomeMode == null
                    defaultHomeMode == null -> {
                        HomeModeSelectorScreen(
                            onSelect = { mode ->
                                mainViewModel.setDefaultHomeMode(mode)
                                mainViewModel.switchMode(
                                    if (mode == "canvas") AppMode.CANVAS else AppMode.BROWSER
                                )
                            }
                        )
                    }
                    // 正常启动
                    else -> {
                        AppNavGraph(
                            navController = navController,
                            appMode = appMode,
                            mainViewModel = mainViewModel
                        )
                    }
                }
                // M4 修复 P1：全局 Snackbar，显示脚本导入结果
                SnackbarHost(
                    hostState = snackbarHostState,
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
        }
    }
}
