package com.livingdashboard.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.livingdashboard.ai.ActiveNavigatorHolder
import com.livingdashboard.ui.AppMode
import com.livingdashboard.ui.MainViewModel
import com.livingdashboard.ui.aggregate.AggregatePanelScreen
import com.livingdashboard.ui.bookmark.BookmarkScreen
import com.livingdashboard.ui.browser.BrowserScreen
import com.livingdashboard.ui.canvas.CanvasHomeScreen
import com.livingdashboard.ui.canvas.CanvasHomeViewModel
import com.livingdashboard.ui.canvas.CanvasScreen
import com.livingdashboard.ui.canvas.WebOSFavoritesScreen
import com.livingdashboard.ui.history.HistoryScreen
import com.livingdashboard.ui.home.BrowserHomeScreen
import com.livingdashboard.ui.script.ScriptEditScreen
import com.livingdashboard.ui.script.ScriptListScreen
import com.livingdashboard.ui.settings.AiConfigScreen
import com.livingdashboard.ui.settings.SettingsScreen
import com.livingdashboard.ui.tab.TabManagerScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 持有 [ActiveNavigatorHolder] 的 ViewModel（Spec 6.10 集成）。
 *
 * - 通过 Hilt 注入 App 级 [ActiveNavigatorHolder]（@Singleton）
 * - [AppNavGraph] 通过 [hiltViewModel] 获取本类，访问 [activeNavigatorHolder]
 * - Composable 销毁时由 [DisposableEffect] 清空 holder.value.value = null
 *   （holder 本身是 @Singleton，App 级生命周期，不会随 ViewModel 销毁）
 */
@HiltViewModel
class NavigatorHolderViewModel @Inject constructor(
    val activeNavigatorHolder: ActiveNavigatorHolder,
) : ViewModel()

/**
 * 应用导航图（Spec 3.3.1 + 附录 B）。
 *
 * M2 改造：
 * - 签名改为 `AppNavGraph(navController, appMode, mainViewModel)`（接收外部传入的 navController + MainViewModel）
 * - 新增 DisposableEffect + addOnDestinationChangedListener（destination 变化时调用 onEnterHome/onLeaveHome）
 * - 保留 M1 路由（home/browser/{tabId}/tabs/bookmarks/history/settings）
 * - 新增路由：
 *   - canvas_home → CanvasHomeScreen
 *   - canvas/{panelId} → CanvasScreen
 *   - webos/{widgetId} → WebOSFavoritesScreen
 *   - aggregate → AggregatePanelScreen
 * - startDestination 根据 appMode 决定（BROWSER → "home"，CANVAS → "canvas_home"）
 *
 * M3 改造（Spec 6.10）：
 * - 通过 [NavigatorHolderViewModel] 获取 [ActiveNavigatorHolder]
 * - [DisposableEffect] 把 navController 写入 `activeNavigatorHolder.value.value`
 * - Composable 销毁时 `activeNavigatorHolder.value.value = null`（避免持有已销毁 NavController）
 * - 工具层（NavigateToPanelTool / CreatePanelTool）通过 `activeNavigatorHolder.navigate(route)` 间接访问
 *
 * @param navController 导航控制器（由 MainActivityContent 创建并传入）
 * @param appMode 当前 App 模式（决定 startDestination）
 * @param mainViewModel MainViewModel 引用（用于 destination 监听 + 协程作用域创建标签页）
 */
@Composable
fun AppNavGraph(
    navController: NavHostController,
    appMode: AppMode,
    mainViewModel: MainViewModel
) {
    val scope = rememberCoroutineScope()

    // M3 6.10：获取 ActiveNavigatorHolder（通过 @HiltViewModel 注入）
    val navHolderViewModel: NavigatorHolderViewModel = hiltViewModel()
    val activeNavigatorHolder = navHolderViewModel.activeNavigatorHolder

    // M3 6.10：把 navController 写入 holder，Composable 销毁时置 null
    // 工具层通过 activeNavigatorHolder.navigate(route) 间接访问 NavController（保证主线程访问）
    DisposableEffect(navController) {
        activeNavigatorHolder.value.value = navController
        onDispose {
            activeNavigatorHolder.value.value = null
        }
    }

    // v5 #N5：destination 变化监听——自动调用 onEnterHome/onLeaveHome（Spec 7.3 节要求的完整实现）
    DisposableEffect(navController) {
        val listener = NavController.OnDestinationChangedListener { _, destination, _ ->
            when (destination.route) {
                Routes.BROWSER_HOME, Routes.CANVAS_HOME -> mainViewModel.onEnterHome()
                else -> mainViewModel.onLeaveHome()
            }
        }
        navController.addOnDestinationChangedListener(listener)
        onDispose { navController.removeOnDestinationChangedListener(listener) }
    }

    // ===== D3 修复：Home 键状态机接入 UI =====

    // 统一的 Home 按钮回调：所有 BottomBar 的 onHome 都调用此回调
    val onHomePressed = { mainViewModel.onHomePressed() }

    // 断点4修复：观察 isAtHome 状态（D3 状态机驱动导航的依据）
    val isAtHome by mainViewModel.isAtHome.collectAsStateWithLifecycle()

    // 断点5修复：appMode 变化时导航到对应主页（switchMode 触发模式切换）
    LaunchedEffect(appMode) {
        val targetHome = if (appMode == AppMode.BROWSER) Routes.BROWSER_HOME else Routes.CANVAS_HOME
        val currentRoute = navController.currentDestination?.route
        if (currentRoute != null && currentRoute != targetHome) {
            navController.navigate(targetHome) {
                // 清空回退栈到起始页，让新主页成为唯一根
                popUpTo(navController.graph.startDestinationId) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    // D3 修复：isAtHome 变为 true 且当前不在主页时，导航回当前模式主页
    // （onHomePressed 在 isAtHome=false 时仅设置 isAtHome=true，由本 Effect 触发实际导航）
    LaunchedEffect(isAtHome) {
        if (isAtHome) {
            val targetHome = if (appMode == AppMode.BROWSER) Routes.BROWSER_HOME else Routes.CANVAS_HOME
            val currentRoute = navController.currentDestination?.route
            // 当前不在任何主页时才导航（避免在主页上重复导航导致循环）
            if (currentRoute != Routes.BROWSER_HOME && currentRoute != Routes.CANVAS_HOME) {
                navController.navigate(targetHome) {
                    popUpTo(targetHome) { inclusive = true }
                    launchSingleTop = true
                }
            }
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (appMode == AppMode.BROWSER) Routes.BROWSER_HOME else Routes.CANVAS_HOME
    ) {
        // ===== M1 路由（保留） =====

        // 浏览器主页
        composable(Routes.BROWSER_HOME) {
            BrowserHomeScreen(
                onNavigateToBrowser = { tabId ->
                    navController.navigate(Routes.browser(tabId))
                },
                // D3 修复断点2：浏览器主页添加 BottomBar，Home 按钮调用 onHomePressed
                onHome = onHomePressed,
                onTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onMore = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                },
                // 问题4修复：Logo 点击 → 导航到 BOOKMARKS 路由
                onOpenBookmarks = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.BOOKMARKS)
                }
            )
        }

        // WebView 浏览器页（tabId 由调用方在导航前插入 Room）
        composable(Routes.BROWSER) {
            BrowserScreen(
                onBack = { navController.popBackStack() },
                onOpenTabs = { navController.navigate(Routes.TABS) },
                // Bug-1 修复：更多按钮由 BrowserScreen 内部展开 MoreMenuSheet，不再直接导航到设置页
                // Bug-2 修复：书签/历史页 UI 入口由 MoreMenuSheet 回调驱动
                onNavigateToBookmarks = { navController.navigate(Routes.BOOKMARKS) },
                onNavigateToHistory = { navController.navigate(Routes.HISTORY) },
                onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
                // D3 修复断点3：onNavigateToHome 改为调用 onHomePressed（D3 状态机）
                onNavigateToHome = onHomePressed
            )
        }

        // 标签页管理（v4 #12：TabManagerScreen 加 TabRow 网页标签 + 画布面板）
        composable(Routes.TABS) {
            TabManagerScreen(
                onBack = { navController.popBackStack() },
                onTabClick = { tabId ->
                    // 切换标签：导航到 browser/{tabId}，回退栈弹到 home（避免回退栈堆积 tabs + browser）
                    navController.navigate(Routes.browser(tabId)) {
                        popUpTo(Routes.BROWSER_HOME)
                    }
                },
                onPanelClick = { panelId ->
                    navController.navigate(Routes.canvas(panelId))
                },
                initialMode = if (appMode == AppMode.BROWSER) {
                    com.livingdashboard.ui.components.BottomBarMode.BROWSER
                } else {
                    com.livingdashboard.ui.components.BottomBarMode.CANVAS
                }
            )
        }

        // 书签管理
        composable(Routes.BOOKMARKS) {
            BookmarkScreen(
                onBookmarkClick = { url ->
                    // 先创建标签再导航（Spec M22 时序）
                    scope.launch {
                        val tabId = mainViewModel.createTabForUrl(url)
                        navController.navigate(Routes.browser(tabId))
                    }
                },
                onClose = { navController.popBackStack() }
            )
        }

        // 历史记录
        composable(Routes.HISTORY) {
            HistoryScreen(
                onHistoryClick = { url ->
                    // 先创建标签再导航（Spec M22 时序）
                    scope.launch {
                        val tabId = mainViewModel.createTabForUrl(url)
                        navController.navigate(Routes.browser(tabId))
                    }
                },
                onClose = { navController.popBackStack() }
            )
        }

        // 设置
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onClose = { navController.popBackStack() },
                onNavigateToAiConfig = { navController.navigate(Routes.AI_CONFIG) },
                onNavigateToScripts = { navController.navigate(Routes.SCRIPT_LIST) }  // M4 新增（Spec 2.6.3）
            )
        }

        // M8：AI 配置页（Spec 6.11.3 节）
        composable(Routes.AI_CONFIG) {
            AiConfigScreen(onClose = { navController.popBackStack() })
        }

        // ===== M4 新增路由（Spec 2.6.3 / 2.6.4） =====

        // 脚本管理列表页
        composable(Routes.SCRIPT_LIST) {
            ScriptListScreen(
                onBack = { navController.popBackStack() },
                onCreate = { navController.navigate(Routes.SCRIPT_NEW) },
                onEdit = { id -> navController.navigate(Routes.scriptEdit(id)) }
            )
        }

        // 脚本新建页（scriptId = null 模式）
        composable(Routes.SCRIPT_NEW) {
            ScriptEditScreen(scriptId = null, onClose = { navController.popBackStack() })
        }

        // 脚本编辑页（带 scriptId 参数）
        composable(
            route = Routes.SCRIPT_EDIT,
            arguments = listOf(navArgument("scriptId") { type = NavType.StringType })
        ) { backStackEntry ->
            val id = backStackEntry.arguments?.getString("scriptId") ?: return@composable
            ScriptEditScreen(scriptId = id, onClose = { navController.popBackStack() })
        }

        // ===== M2 新增路由 =====

        // 画布主页（Spec T1）
        composable(Routes.CANVAS_HOME) {
            // NC9 修复：用 CanvasHomeViewModel.currentPanelId 而非硬编码 "current_panel_id"
            val canvasHomeViewModel: CanvasHomeViewModel = hiltViewModel()
            val currentPanelId by canvasHomeViewModel.currentPanelId.collectAsStateWithLifecycle()
            // v5 #N4：补全 CanvasHomeScreen 所有必填参数（onCircleIconClick 等）
            CanvasHomeScreen(
                onCircleIconClick = {
                    mainViewModel.onLeaveHome()
                    currentPanelId?.let { navController.navigate(Routes.canvas(it)) }
                },
                onFavoriteClick = { widgetId ->
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.webos(widgetId))
                },
                onSwipeDownToCanvas = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.AGGREGATE)
                },
                onShowAggregate = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.AGGREGATE)
                },
                onShowTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onShowSettings = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                },
                // D3 修复断点1：CanvasHomeScreen 的 Home 按钮调用 onHomePressed
                onHome = onHomePressed,
                viewModel = canvasHomeViewModel
            )
        }

        // 画布页（分层画布，Spec T3）
        composable(
            route = Routes.CANVAS,
            arguments = listOf(navArgument("panelId") { type = NavType.StringType })
        ) { backStackEntry ->
            val panelId = backStackEntry.arguments?.getString("panelId") ?: return@composable
            // v5 #N6：CanvasScreen 加 BottomBar，需传 onShowTabs/onShowSettings
            CanvasScreen(
                panelId = panelId,
                onBack = { navController.popBackStack() },
                onShowTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onShowSettings = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                },
                // 问题3修复：收藏管理 → 聚合面板（AGGREGATE 路由）
                onShowAggregate = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.AGGREGATE)
                },
                // D3 修复：CanvasScreen 的 Home 按钮调用 onHomePressed
                onHome = onHomePressed
            )
        }

        // WebOS 收藏组件全屏页（Spec T11）
        // v4 #12：移除 PANEL_MANAGER 路由，面板管理合并到 TabManagerScreen 的"画布面板"Tab
        composable(
            route = Routes.WEBOS,
            arguments = listOf(navArgument("widgetId") { type = NavType.StringType })
        ) { backStackEntry ->
            val widgetId = backStackEntry.arguments?.getString("widgetId") ?: return@composable
            WebOSFavoritesScreen(
                widgetId = widgetId,
                onBack = { navController.popBackStack() }
            )
        }

        // 聚合面板（Spec T12）
        composable(Routes.AGGREGATE) {
            // v5 #N6 延伸：传 onShowTabs/onShowSettings 给 AggregatePanelScreen
            // （再传给复用的 CanvasScreen 的 BottomBar）
            AggregatePanelScreen(
                onBack = { navController.popBackStack() },
                onShowTabs = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.TABS)
                },
                onShowSettings = {
                    mainViewModel.onLeaveHome()
                    navController.navigate(Routes.SETTINGS)
                }
            )
        }
    }
}
