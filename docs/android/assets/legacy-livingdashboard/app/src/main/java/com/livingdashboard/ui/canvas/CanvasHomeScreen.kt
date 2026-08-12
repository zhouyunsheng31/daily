package com.livingdashboard.ui.canvas

import android.util.Log
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Calculate
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToDown
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.ui.canvas.components.AgentModeSwitcher
import com.livingdashboard.ui.canvas.components.AIInputPill
import com.livingdashboard.ui.canvas.components.AskUserDialog
import com.livingdashboard.ui.canvas.components.CircleIcon
import com.livingdashboard.ui.canvas.components.FavoriteWidgetGrid
import com.livingdashboard.ui.components.BottomBar
import com.livingdashboard.ui.components.BottomBarMode
import com.livingdashboard.ui.components.CanvasMoreMenuSheet

/**
 * 画布主页，Spec 6.1 节。
 *
 * 参考 layout-design-mobile.md 第 2.10 节 + 桌面端 CanvasHome.tsx。
 *
 * 布局：
 * 1. 圆形图标（顶部，可点击进入画布面板）
 * 2. AI 输入框（pill 收起态 / 展开态对话历史）
 * 3. 收藏组件网格（3 列，长按取消收藏）
 * 4. 下滑提示（dragAccum > 80px 触发 onSwipeDownToCanvas）
 *
 * 底部加 [BottomBar]（mode = CANVAS，5 按钮对称布局）。
 *
 * @param onCircleIconClick 点击圆形图标 → 进入画布面板
 * @param onFavoriteClick 点击收藏组件 → WebOS 收藏页
 * @param onSwipeDownToCanvas 下滑 → 进入画布
 * @param onShowAggregate 显示聚合面板
 * @param onShowTabs BottomBar 标签按钮
 * @param onShowSettings BottomBar 更多菜单 → 设置
 * @param viewModel 画布主页 ViewModel（Hilt 注入）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CanvasHomeScreen(
    onCircleIconClick: () -> Unit,
    onFavoriteClick: (String) -> Unit,
    onSwipeDownToCanvas: () -> Unit,
    onShowAggregate: () -> Unit,
    onShowTabs: () -> Unit = {},
    onShowSettings: () -> Unit = {},
    onHome: () -> Unit = {},
    viewModel: CanvasHomeViewModel = hiltViewModel()
) {
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val aiInputText by viewModel.aiInputText.collectAsStateWithLifecycle()
    val aiExpanded by viewModel.aiExpanded.collectAsStateWithLifecycle()
    val aiMessages by viewModel.uiMessages.collectAsStateWithLifecycle()
    // M8：AgentModeSwitcher 用，思考等级 + 运行时模式
    val currentThinkingLevel by viewModel.currentThinkingLevel.collectAsStateWithLifecycle()
    val runtimeMode by viewModel.runtimeMode.collectAsStateWithLifecycle()

    // v5 #N6：BottomBar 更多菜单展开状态
    var showMoreMenu by remember { mutableStateOf(false) }

    // 添加组件类型选择器展开状态
    var showAddWidgetSheet by remember { mutableStateOf(false) }

    // AgentModeSwitcher 默认折叠，点击展开模式切换 + 滑块
    var agentSwitcherExpanded by remember { mutableStateOf(false) }

    // v4 #10：点击外部收起 AI 输入框
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    BackHandler(enabled = aiExpanded) {
        viewModel.collapseAi()
        focusManager.clearFocus()
    }

    // 修复：下滑手势检测放在外层 Box 上，用 PointerEventPass.Initial 观察
    // 触摸事件但不消费，避免干扰子组件（CircleIcon/AIInputPill/FavoriteWidgetGrid）的点击
    // v5 #N6：用 Box 包裹，让 BottomBar 固定在底部
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .pointerInput(aiExpanded) {
                if (aiExpanded) return@pointerInput
                awaitPointerEventScope {
                    var startY = 0f
                    var tracking = false
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        val change = event.changes.firstOrNull() ?: continue

                        if (change.changedToDown()) {
                            startY = change.position.y
                            tracking = true
                        } else if (tracking) {
                            if (change.changedToUp()) {
                                tracking = false
                            } else {
                                val dy = change.position.y - startY
                                if (dy < -80f) {
                                    onSwipeDownToCanvas()
                                    tracking = false
                                }
                            }
                        }
                    }
                }
            }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp)
                .padding(top = 24.dp, bottom = 80.dp)
        ) {
            // 1. 圆形图标（v4 #9：可点击进入画布面板）
            CircleIcon(
                onClick = onCircleIconClick,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = 32.dp)
            )

            Spacer(modifier = Modifier.height(24.dp))

            // 2. AI 输入框（v4 #10：收起/展开两态切换）
            // M8：展开态时上方显示 AgentModeSwitcher（默认折叠，点击展开）
            if (aiExpanded) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "AI",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color(0xFF333333)
                    )
                    IconButton(onClick = { agentSwitcherExpanded = !agentSwitcherExpanded }) {
                        Icon(
                            imageVector = Icons.Default.Tune,
                            contentDescription = if (agentSwitcherExpanded) "收起 AI 设置" else "展开 AI 设置",
                            tint = Color(0xFF666666)
                        )
                    }
                }
                if (agentSwitcherExpanded) {
                    AgentModeSwitcher(
                        runtimeMode = runtimeMode,
                        thinkingLevel = currentThinkingLevel,
                        onModeChange = viewModel::onAgentModeChange,
                        onThinkingLevelChange = viewModel::onThinkingLevelChange,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
            }
            AIInputPill(
                text = aiInputText,
                onTextChange = viewModel::onAiInputTextChange,
                onSend = {
                    Log.i("CanvasHomeScreen", "onSend clicked, aiInputText='${viewModel.aiInputText.value}'")
                    Toast.makeText(context, "onSend clicked", Toast.LENGTH_SHORT).show()
                    viewModel.onAiSend()
                    // 发送后保持展开态（layout-design 2.10 要求）
                },
                expanded = aiExpanded,
                messages = aiMessages,
                onFocus = viewModel::expandAi,
                onCollapse = {
                    viewModel.collapseAi()
                    focusManager.clearFocus()
                },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(32.dp))

            // 3. 收藏组件网格
            FavoriteWidgetGrid(
                favorites = favorites,
                onClickFavorite = onFavoriteClick,
                onAddWidget = { showAddWidgetSheet = true },
                onLongClickFavorite = { widgetId ->
                    // v5 #3：长按收藏组件 → 取消收藏
                    viewModel.toggleFavorite(widgetId)
                },
                modifier = Modifier.weight(1f)
            )

            // 4. 上滑提示
            Spacer(modifier = Modifier.height(8.dp))
            SwipeDownHint(
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }

        // v5 #N6：底部栏（layout-design 2.10 要求 5 按钮对称布局）
        // 修复 Bug #1：Box 内 BottomBar 默认在 TopStart，需 align 到 BottomCenter
        // D3 修复：onHome 调用 onHomePressed（由 AppNavGraph 传入 mainViewModel.onHomePressed()）
        // 问题2修复：画布主页非画布页，改用 BROWSER 模式（back/forward 默认禁用），避免无功能的缩放按钮
        BottomBar(
            mode = BottomBarMode.BROWSER,
            modifier = Modifier.align(Alignment.BottomCenter),
            onHome = onHome,
            onTabs = onShowTabs,
            onMore = { showMoreMenu = true }
        )
    }

    // v5 #N6：画布模式更多菜单（面板管理/收藏管理/设置）
    CanvasMoreMenuSheet(
        show = showMoreMenu,
        onDismiss = { showMoreMenu = false },
        onOpenPanelManager = onShowTabs,    // 面板管理 → TabManagerScreen
        onOpenFavorites = onShowAggregate,  // 收藏管理 → 聚合面板
        onOpenSettings = onShowSettings
    )

    // 问题1修复：添加组件类型选择器
    // 原为 ModalBottomSheet，平台主题下会崩溃，改用 AlertDialog
    if (showAddWidgetSheet) {
        AlertDialog(
            onDismissRequest = { showAddWidgetSheet = false },
            title = { Text("添加组件") },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                ) {
                    addWidgetOptions.forEach { option ->
                        ListItem(
                            headlineContent = { Text(option.name) },
                            supportingContent = { Text(option.description) },
                            leadingContent = {
                                Icon(
                                    imageVector = option.icon,
                                    contentDescription = null
                                )
                            },
                            modifier = Modifier.clickable {
                                viewModel.addWidget(option.type)
                                showAddWidgetSheet = false
                            }
                        )
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showAddWidgetSheet = false }) { Text("取消") }
            }
        )
    }

    // M8 Spec 6.11.4：AskUserDialog 订阅 askUserDialogState，AskUserTool 触发时弹出
    // （全局单例，所有面板共享；AskUserTool 通过 AskUserDialogState.showAndWait 挂起等待）
    AskUserDialog(askUserDialogState = viewModel.askUserDialogState)
}

/**
 * 上滑提示，Spec 6.1 节。
 *
 * 仅作为视觉提示（图标+文字），手势检测已提升到外层 Column。
 */
@Composable
private fun SwipeDownHint(
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            Icons.Default.KeyboardArrowUp,
            contentDescription = "上滑进入聚合面板",
            tint = Color(0xFF999999)
        )
        Text(
            text = "上滑进入聚合面板",
            fontSize = 10.sp,
            color = Color(0xFF999999)
        )
    }
}

/**
 * 添加组件类型选项（问题1修复）。
 *
 * 列出所有可用组件类型，供 ModalBottomSheet 选择器展示。
 */
private data class AddWidgetOption(
    val type: WidgetType,
    val name: String,
    val description: String,
    val icon: ImageVector
)

private val addWidgetOptions = listOf(
    AddWidgetOption(WidgetType.WEBVIEW, "网页", "内嵌网页组件", Icons.Default.Public),
    AddWidgetOption(WidgetType.CALCULATOR, "计算器", "计算工具", Icons.Default.Calculate),
    AddWidgetOption(WidgetType.FOCUS_TIMER, "专注计时", "番茄钟计时器", Icons.Default.Schedule),
    AddWidgetOption(WidgetType.HTML_CANVAS, "HTML 画布", "自定义 HTML 画布", Icons.Default.Code),
    AddWidgetOption(WidgetType.FREE_HTML, "自由 HTML", "自由 HTML 内容", Icons.Default.Brush),
)
