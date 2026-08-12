package com.livingdashboard.ui.aggregate

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.canvas.CanvasScreen
import com.livingdashboard.ui.canvas.CanvasViewModel

/**
 * 聚合面板页，Spec 6.6 节。
 *
 * 聚合面板 = 特殊面板，显示所有收藏组件。布局同 [CanvasScreen]，
 * 但数据源是 favorites 表（通过 observeAggregateWidgets JOIN widget_positions + widgets）。
 *
 * v4 #11 修复：layout-design 2.13 要求"上滑回到画布主页"，
 * 原代码直接复用 CanvasScreen 无法识别上滑手势。
 * 现包裹一层 detectVerticalDragGestures 识别上滑（向上拖拽超过阈值后触发 onBack）。
 *
 * 手势冲突缓解：
 * - 上滑手势用 detectVerticalDragGestures（单指垂直拖拽）
 * - CanvasScreen 内部用 detectTransformGestures（双指缩放/平移）
 * - 两者不冲突（单指 vs 双指）
 *
 * 但与 WidgetContainer 的长按拖拽冲突？
 * - WidgetContainer 用 detectDragGesturesAfterLongPress（长按后单指拖拽）
 * - 此处的 detectVerticalDragGestures 不需要长按，会先消费单指垂直事件
 * - 实际上：用户在组件上长按 + 拖拽 → WidgetContainer 接管
 * - 用户在空白处上滑 → 此处 detectVerticalDragGestures 接管
 * - 在 M2 阶段可接受（用户上滑主要在空白处）
 *
 * @param onBack 返回画布主页（上滑超过阈值或 BackHandler 触发）
 * @param onShowTabs BottomBar 标签按钮回调（传给复用的 CanvasScreen）
 * @param onShowSettings BottomBar 更多菜单 → 设置回调（传给复用的 CanvasScreen）
 * @param viewModel 画布 ViewModel（Hilt 注入，复用 CanvasScreen 的 ViewModel）
 */
@Composable
fun AggregatePanelScreen(
    onBack: () -> Unit,
    onShowTabs: () -> Unit = {},
    onShowSettings: () -> Unit = {},
    viewModel: CanvasViewModel = hiltViewModel()
) {
    // 聚合面板 ID 需在 App 初始化时获取
    val aggregatePanelId by viewModel.aggregatePanelId.collectAsStateWithLifecycle()

    if (aggregatePanelId == null) {
        // 加载中
        Box(
            modifier = Modifier.fillMaxSize().background(Color.White),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
        return
    }

    // 聚合面板 ID 加载后，更新 ViewModel 的 effectivePanelId，让 AI 消息发送能拿到真实 ID
    LaunchedEffect(aggregatePanelId) {
        aggregatePanelId?.let { viewModel.updateEffectivePanelId(it) }
    }

    // v4 #11：包裹上滑手势识别（layout-design 2.13 要求"上滑回到画布主页"）
    // 上滑阈值 80px，超过则触发 onBack
    var dragAccum by remember { mutableStateOf(0f) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragStart = { dragAccum = 0f },
                    onVerticalDrag = { _, dragAmount ->
                        // 上滑 dragAmount < 0（屏幕坐标 Y 向下为正）
                        dragAccum += dragAmount
                    },
                    onDragEnd = {
                        // 上滑超过阈值（dragAccum < -80）触发回主页
                        if (dragAccum < -80f) onBack()
                    }
                )
            }
    ) {
        // 复用 CanvasScreen，传入聚合面板 ID
        // D7：聚合面板的组件列表来自 widget_positions 表（panelId = 聚合面板 ID）
        //      通过 observeAggregateWidgets() JOIN widgets 表获取真实数据
        // 位置来自 widget_positions 表（panelId = 聚合面板 ID，由 toggleFavorite 写入）
        // v5 #N6 延伸：传入 onShowTabs/onShowSettings，让复用的 CanvasScreen 的 BottomBar 按钮可用
        CanvasScreen(
            panelId = aggregatePanelId!!,
            onBack = onBack,
            onShowTabs = onShowTabs,
            onShowSettings = onShowSettings,
            viewModel = viewModel
        )
    }
}
