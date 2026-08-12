package com.livingdashboard.ui.canvas

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.widget.WidgetRenderParams
import com.livingdashboard.ui.widget.WidgetRegistry
import com.livingdashboard.ui.widget.LocalWidgetRegistry
import com.livingdashboard.ui.widget.ZoomLevel
import org.json.JSONObject

/**
 * 收藏组件页（WebOS 风格全屏页），Spec 6.5 节。
 *
 * 参考 layout-design-mobile.md 第 2.12 节。几乎全屏，回退退一级（回画布主页）。
 *
 * v4 #2 修复：原代码 state = emptyMap() 且 onUpdateState = { _ -> }，组件状态不同步。
 * 现通过 [WebOSFavoritesViewModel] 加载 widget.stateJson 并持久化状态变更。
 *
 * 渲染策略：
 * - 用 [WidgetRegistry] 查找组件渲染函数
 * - 用 [ZoomLevel.FULL] 几乎全屏渲染
 * - 状态变更通过 onStateChange 回调持久化到原面板（D7 真实引用）
 *
 * @param widgetId 组件 ID
 * @param onBack 返回回调
 * @param viewModel 收藏组件 ViewModel（Hilt 注入）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebOSFavoritesScreen(
    widgetId: String,
    onBack: () -> Unit,
    viewModel: WebOSFavoritesViewModel = hiltViewModel()
) {
    // v4 #2：加载真实 widget 数据（含 stateJson）
    val widget by viewModel.observeWidget(widgetId)
        .collectAsStateWithLifecycle(initialValue = null)

    // 通过 LocalWidgetRegistry 获取渲染函数
    val widgetRegistry = LocalWidgetRegistry.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(widgetDisplayName(widget?.type))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xE6FFFFFF)  // D6 rgba(255,255,255,0.9)
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.White)
                .padding(padding)
        ) {
            // 几乎全屏渲染组件（ZoomLevel.FULL），用真实状态
            val currentWidget = widget
            if (currentWidget != null) {
                // v4 #2：解析真实 stateJson
                val state = parseStateJson(currentWidget.stateJson)
                val renderer = widgetRegistry.getRenderer(
                    com.livingdashboard.ui.widget.WidgetType.valueOf(currentWidget.type.name)
                )
                if (renderer != null) {
                    renderer(
                        WidgetRenderParams(
                            widgetId = widgetId,
                            panelId = currentWidget.panelId,
                            type = com.livingdashboard.ui.widget.WidgetType.valueOf(currentWidget.type.name),
                            title = currentWidget.title,
                            state = state,
                            zoomLevel = ZoomLevel.FULL,
                            zoom = 1f,
                            onStateChange = { newState ->
                                // v4 #2：持久化状态变更（同步到原面板，D7 真实引用）
                                viewModel.updateWidgetState(widgetId, newState)
                            }
                        )
                    )
                } else {
                    // 未注册的组件类型
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "未知组件类型: ${currentWidget.type}",
                            color = Color(0xFF999999)
                        )
                    }
                }
            } else {
                // 加载中
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

/**
 * 解析组件状态 JSON 字符串为 Map。
 *
 * @param json JSON 字符串
 * @return 状态 Map
 */
private fun parseStateJson(json: String): Map<String, Any> {
    val obj = JSONObject(json)
    val map = mutableMapOf<String, Any>()
    for (key in obj.keys()) {
        map[key] = obj.get(key)
    }
    return map
}

/**
 * 组件类型显示名称（用于 TopAppBar 标题）。
 *
 * 与 CanvasHomeViewModel.widgetDisplayName 保持一致。
 */
private fun widgetDisplayName(type: com.livingdashboard.data.entity.WidgetType?): String {
    if (type == null) return "收藏组件"
    return when (type) {
        com.livingdashboard.data.entity.WidgetType.AI_ASSISTANT -> "AI 助手"
        com.livingdashboard.data.entity.WidgetType.WEBVIEW -> "网页"
        com.livingdashboard.data.entity.WidgetType.CALCULATOR -> "计算器"
        com.livingdashboard.data.entity.WidgetType.FOCUS_TIMER -> "专注计时"
        com.livingdashboard.data.entity.WidgetType.HTML_CANVAS -> "HTML 画布"
        com.livingdashboard.data.entity.WidgetType.FREE_HTML -> "自由 HTML"
    }
}
