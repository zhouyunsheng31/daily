package com.livingdashboard.ui.canvas

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.canvas.components.WidgetContainer
import com.livingdashboard.ui.canvas.components.WidgetThumbnailPlaceholder
import com.livingdashboard.ui.components.AiConversationOverlay
import com.livingdashboard.ui.components.BottomBar
import com.livingdashboard.ui.components.BottomBarMode
import com.livingdashboard.ui.components.CanvasMoreMenuSheet
import com.livingdashboard.ui.widget.WidgetRenderParams
import org.json.JSONObject

/**
 * 分层画布页，Spec 6.3 节。
 *
 * 参考 layout-design-mobile.md 第 2.11 节 + 桌面端 Workspace.tsx。
 *
 * 功能：
 * - 双指缩放/平移（detectTransformGestures）
 * - 视口检测：只渲染可见组件，超出视口用 [WidgetThumbnailPlaceholder] 占位
 *   （v4 #21：避免大量 WebView 同时渲染导致内存溢出）
 * - BackHandler：系统返回键 → onBack（返回画布主页）
 * - 底部加 [BottomBar]（mode = CANVAS，含缩小/放大按钮）
 * - 组件菜单 ModalBottomSheet（收藏/删除）
 *
 * @param panelId 面板 ID
 * @param onBack 返回画布主页（BackHandler + BottomBar Home 按钮调用）
 * @param onShowTabs BottomBar 标签按钮回调
 * @param onShowSettings BottomBar 更多菜单 → 设置回调
 * @param viewModel 画布 ViewModel（Hilt 注入）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CanvasScreen(
    panelId: String,
    onBack: () -> Unit,
    onShowTabs: () -> Unit = {},
    onShowSettings: () -> Unit = {},
    onShowAggregate: () -> Unit = {},
    onHome: () -> Unit = onBack,
    viewModel: CanvasViewModel = hiltViewModel()
) {
    val transform by viewModel.transform.collectAsStateWithLifecycle()
    val widgets by viewModel.observeWidgets(panelId).collectAsStateWithLifecycle(emptyList())
    val positions by viewModel.observePositions(panelId).collectAsStateWithLifecycle(emptyList())
    val menuWidgetId by viewModel.menuWidgetId.collectAsStateWithLifecycle()
    val aiState by viewModel.aiModeState.collectAsStateWithLifecycle()

    // v4 #21：视口检测——只渲染可见组件，超出视口的用占位符
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val screenWidthPx = with(density) { configuration.screenWidthDp.dp.toPx() }
    val screenHeightPx = with(density) { configuration.screenHeightDp.dp.toPx() }

    // v5 #N7：系统返回键 → AI 浮层展开时先收起浮层，否则返回画布主页
    BackHandler {
        if (aiState.aiExpanded) {
            viewModel.collapseAi()
        } else {
            onBack()
        }
    }

    // v5 #N6：BottomBar 更多菜单展开状态
    var showMoreMenu by remember { mutableStateOf(false) }

    // 编辑标题 / 调整大小对话框状态（独立于 menuWidgetId，避免 dismiss 菜单时对话框被移除）
    var editingWidgetId by remember { mutableStateOf<String?>(null) }
    var editTitleText by remember { mutableStateOf("") }
    var resizingWidgetId by remember { mutableStateOf<String?>(null) }

    // v5 #N6：用 Column 包裹，让 BottomBar 固定在底部
    Column(modifier = Modifier.fillMaxSize().background(Color.White)) {
        // 双指缩放/平移手势区域
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .pointerInput(panelId) {
                    detectTransformGestures(
                        onGesture = { centroid, pan, zoom, _ ->
                            viewModel.onCanvasGesture(centroid, pan, zoom)
                        }
                    )
                }
        ) {
            // 修复：空面板进入画布时显示提示，避免一片空白
            if (widgets.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "画布为空\n通过 AI 输入框或面板管理添加组件",
                        color = Color(0xFF999999),
                        textAlign = TextAlign.Center
                    )
                }
            }
            // 渲染所有组件（带视口检测）
            widgets.forEach { widget ->
                val position = positions.find { it.widgetId == widget.id } ?: return@forEach

                // v4 #21：计算组件在屏幕上的位置（含 transform）
                val screenX = position.x * transform.zoom + transform.x
                val screenY = position.y * transform.zoom + transform.y
                val scaledWidth = widget.width * transform.zoom
                val scaledHeight = widget.height * transform.zoom

                // 视口剔除：完全在屏幕外的不渲染
                val isVisible = screenX + scaledWidth >= 0 &&
                    screenX <= screenWidthPx &&
                    screenY + scaledHeight >= 0 &&
                    screenY <= screenHeightPx

                if (!isVisible || transform.zoom < 0.3f) {
                    // v4 #21：超出视口或 THUMBNAIL 缩放级别用彩色小球占位（不渲染 WebView）
                    WidgetThumbnailPlaceholder(
                        type = widget.type,
                        title = widget.title,
                        modifier = Modifier
                            .graphicsLayer {
                                translationX = screenX
                                translationY = screenY
                                scaleX = transform.zoom
                                scaleY = transform.zoom
                            }
                    )
                } else {
                    WidgetContainer(
                        params = WidgetRenderParams(
                            widgetId = widget.id,
                            panelId = panelId,
                            type = com.livingdashboard.ui.widget.WidgetType.valueOf(widget.type.name),
                            title = widget.title,
                            state = parseStateJson(widget.stateJson),
                            zoomLevel = zoomLevelFromZoom(transform.zoom),
                            zoom = transform.zoom,
                            onStateChange = { newState ->
                                viewModel.updateWidgetState(widget.id, newState)
                            }
                        ),
                        position = position,
                        widgetSize = widget.width to widget.height,
                        transform = transform,
                        onMove = { dx, dy ->
                            viewModel.moveWidget(panelId, widget.id, dx, dy)
                        },
                        onShowMenu = { viewModel.showWidgetMenu(widget.id) }
                    )
                }
            }
            // M3 6.13：AI 对话浮层（半屏，aiExpanded=true 时显示）
            if (aiState.aiExpanded) {
                AiConversationOverlay(
                    messages = aiState.aiMessages,
                    onClose = viewModel::collapseAi,
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
        }

        // v5 #N6：底部栏（layout-design 2.11 要求画布页有底部栏）
        // D3 修复：onHome 调用 onHomePressed（由 AppNavGraph 传入 mainViewModel.onHomePressed()）
        // M3 6.13：接入 AI 输入框模式 + 左右滑切换 + AI 工作态（与 BrowserScreen 一致）
        BottomBar(
            mode = BottomBarMode.CANVAS,
            onZoomOut = { viewModel.zoomOut() },
            onZoomIn = { viewModel.zoomIn() },
            onHome = onHome,
            onTabs = onShowTabs,
            onMore = { showMoreMenu = true },
            // M3 6.13：AI 模式参数
            aiMode = aiState.aiMode,
            aiInputText = aiState.aiInputText,
            onAiInputTextChange = viewModel::onAiInputTextChange,
            onAiSend = viewModel::onAiSend,
            onSwipeLeftToAiMode = viewModel::expandAiMode,
            onSwipeRightToButtonMode = viewModel::collapseAiMode,
            showSwipeHint = true,
            aiWorking = aiState.aiWorking,
            aiWorkingStatusText = aiState.aiWorkingStatusText,
            onExpandAiPanel = viewModel::expandAiPanel,
        )
    }

    // NC6/T10：组件菜单 AlertDialog（收藏/编辑标题/调整大小/复制/删除）
    // 原为 ModalBottomSheet，但在平台主题（Theme.Material.Light.NoActionBar）下
    // ModalBottomSheet 内部 Popup 会崩溃，改用 AlertDialog 提升兼容性
    if (menuWidgetId != null) {
        val widgetId = menuWidgetId!!
        val isFavorite = viewModel.isFavorite(widgetId)
        val widget = widgets.find { it.id == widgetId }
        AlertDialog(
            onDismissRequest = { viewModel.dismissWidgetMenu() },
            title = { Text("组件菜单") },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp)
                ) {
                    ListItem(
                        headlineContent = {
                            Text(if (isFavorite) "取消收藏" else "收藏")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Default.Star,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            viewModel.toggleFavorite(widgetId)
                            viewModel.dismissWidgetMenu()
                        }
                    )
                    ListItem(
                        headlineContent = { Text("编辑标题") },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Default.Edit,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            editTitleText = widget?.title ?: ""
                            editingWidgetId = widgetId
                            viewModel.dismissWidgetMenu()
                        }
                    )
                    ListItem(
                        headlineContent = { Text("调整大小") },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Default.AspectRatio,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            resizingWidgetId = widgetId
                            viewModel.dismissWidgetMenu()
                        }
                    )
                    ListItem(
                        headlineContent = { Text("复制组件") },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            viewModel.duplicateWidget(widgetId)
                        }
                    )
                    ListItem(
                        headlineContent = { Text("删除组件") },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Default.Delete,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            viewModel.deleteWidget(widgetId)
                        }
                    )
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { viewModel.dismissWidgetMenu() }) { Text("取消") }
            }
        )
    }

    // 编辑标题对话框
    editingWidgetId?.let { wId ->
        AlertDialog(
            onDismissRequest = { editingWidgetId = null },
            title = { Text("编辑标题") },
            text = {
                OutlinedTextField(
                    value = editTitleText,
                    onValueChange = { editTitleText = it },
                    singleLine = true,
                    label = { Text("标题") }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val trimmed = editTitleText.trim()
                    if (trimmed.isNotEmpty()) {
                        viewModel.updateWidgetTitle(wId, trimmed)
                    }
                    editingWidgetId = null
                }) { Text("确定") }
            },
            dismissButton = {
                TextButton(onClick = { editingWidgetId = null }) { Text("取消") }
            }
        )
    }

    // 调整大小对话框
    resizingWidgetId?.let { wId ->
        AlertDialog(
            onDismissRequest = { resizingWidgetId = null },
            title = { Text("调整大小") },
            text = {
                Column {
                    WidgetSize.values().forEach { size ->
                        val label = when (size) {
                            WidgetSize.SMALL -> "小 (200×150)"
                            WidgetSize.MEDIUM -> "中 (300×200)"
                            WidgetSize.LARGE -> "大 (400×300)"
                        }
                        ListItem(
                            headlineContent = { Text(label) },
                            modifier = Modifier.clickable {
                                viewModel.updateWidgetSize(wId, size)
                                resizingWidgetId = null
                            }
                        )
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { resizingWidgetId = null }) { Text("取消") }
            }
        )
    }

    // v5 #N6：画布模式更多菜单
    CanvasMoreMenuSheet(
        show = showMoreMenu,
        onDismiss = { showMoreMenu = false },
        onOpenPanelManager = onShowTabs,
        onOpenFavorites = onShowAggregate,  // 问题3修复：收藏管理 → 聚合面板（AGGREGATE 路由）
        onOpenSettings = onShowSettings
    )
}

/**
 * 解析组件状态 JSON 字符串为 Map。
 *
 * @param json JSON 字符串
 * @return 状态 Map（key 为字段名，value 为字段值）
 */
private fun parseStateJson(json: String): Map<String, Any> {
    val obj = JSONObject(json)
    val map = mutableMapOf<String, Any>()
    for (key in obj.keys()) {
        map[key] = obj.get(key)
    }
    return map
}
