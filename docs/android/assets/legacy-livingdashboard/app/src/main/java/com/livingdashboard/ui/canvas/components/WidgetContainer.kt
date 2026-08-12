package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.data.entity.WidgetPositionEntity
import com.livingdashboard.ui.canvas.CanvasTransform
import com.livingdashboard.ui.canvas.zoomLevelFromZoom
import com.livingdashboard.ui.widget.WidgetRenderParams
import com.livingdashboard.ui.widget.WidgetRenderer
import com.livingdashboard.ui.widget.ZoomLevel

/**
 * 组件容器：处理长按拖拽（D8 + NC6 修复），Spec 5.5 节。
 *
 * - 长按 + 拖拽：移动组件位置（detectDragGesturesAfterLongPress 有 onDragEnd 回调）
 * - 双指缩放/平移：由父级 CanvasScreen 的 detectTransformGestures 处理（不在 WidgetContainer）
 * - 收藏/删除：组件右上角"⋮"按钮弹出菜单（T10 修订，避免与长按拖拽冲突）
 *
 * NC6 修复：原实现用 detectTransformGestures 处理拖拽，但该 API 没有手势结束回调，
 * 导致拖拽位置永不提交。改用 detectDragGesturesAfterLongPress（有 onDragEnd/onDragCancel）。
 *
 * v4 #20 修复：用 graphicsLayer（translationX/Y + scaleX/Y）替代 offset+size，
 * 仅更新 GPU 合成层，不触发 measure/layout，避免拖拽/缩放期间每帧重排。
 *
 * v6 #22 修复（最终方案）：不添加多指检测代码。Compose 内置手势分发机制保证
 * 长按阈值（~400ms）前 detectDragGesturesAfterLongPress 不消费事件，
 * 双指在阈值前落下时父级 detectTransformGestures 自动接管。
 * 边缘场景（长按阈值后落第二指）在 M2 阶段不完美解决。
 *
 * @param params 组件渲染参数（含 widgetId/type/state 等）
 * @param position 组件位置（画布坐标）
 * @param widgetSize 组件尺寸（width, height in px，未缩放）
 * @param transform 当前画布变换
 * @param onMove 拖拽结束回调（画布坐标增量 dx, dy）
 * @param onShowMenu 点击"⋮"按钮回调（弹出收藏/删除菜单）
 * @param modifier 外层 Modifier
 */
@Composable
fun WidgetContainer(
    params: WidgetRenderParams,
    position: WidgetPositionEntity,
    widgetSize: Pair<Float, Float>,
    transform: CanvasTransform,
    onMove: (Float, Float) -> Unit,
    onShowMenu: () -> Unit,
    modifier: Modifier = Modifier
) {
    // 拖拽期间的临时偏移（屏幕坐标）
    var dragOffset by remember { mutableStateOf(Offset.Zero) }
    // 拖拽提交后的期望位置（避免数据库更新延迟导致闪烁）
    var pendingPosition by remember { mutableStateOf<Offset?>(null) }

    // NC6 修复：用 rememberUpdatedState 确保 pointerInput 长生命周期协程中读到最新值
    val currentTransform by rememberUpdatedState(transform)
    val currentOnMove by rememberUpdatedState(onMove)

    // 有效位置：拖拽提交后用 pendingPosition（期望值），否则用 position
    // 注意：不再在 LaunchedEffect 中清除 pendingPosition，避免切换 effectivePosition 数据源导致跳变
    // pendingPosition 在下次 onDragStart 时清除（使用最新 position）
    val effectivePosition = pendingPosition ?: Offset(position.x, position.y)

    val zoomLevel = zoomLevelFromZoom(currentTransform.zoom)

    // 计算屏幕位置 = 有效画布坐标 * zoom + transform + dragOffset
    val screenX = effectivePosition.x * currentTransform.zoom + currentTransform.x + dragOffset.x
    val screenY = effectivePosition.y * currentTransform.zoom + currentTransform.y + dragOffset.y

    // 不用 graphicsLayer 的 scaleX/scaleY：WebView 硬件层与 Compose GPU 合成层冲突
    // 改用实际尺寸（widgetSize * zoom）让组件真正 re-measure，内容完整渲染
    Box(
        modifier = modifier
            .graphicsLayer {
                translationX = screenX
                translationY = screenY
            }
            .size(
                width = (widgetSize.first * currentTransform.zoom).dp,
                height = (widgetSize.second * currentTransform.zoom).dp
            )
            .pointerInput(position.widgetId) {
                detectDragGestures(
                    onDragStart = {
                        // 新拖拽开始时，清除 pendingPosition，使用最新 position
                        pendingPosition = null
                        dragOffset = Offset.Zero
                    },
                    onDrag = { change, dragAmount ->
                        change.consume()
                        dragOffset += dragAmount
                    },
                    onDragEnd = {
                        if (dragOffset != Offset.Zero) {
                            val canvasDx = dragOffset.x / currentTransform.zoom
                            val canvasDy = dragOffset.y / currentTransform.zoom
                            // 立即设置期望位置，不等数据库更新（避免闪烁）
                            pendingPosition = Offset(effectivePosition.x + canvasDx, effectivePosition.y + canvasDy)
                            currentOnMove(canvasDx, canvasDy)
                            dragOffset = Offset.Zero
                        }
                    },
                    onDragCancel = {
                        dragOffset = Offset.Zero
                    }
                )
            }
    ) {
        WidgetRenderer(
            params = params.copy(
                zoomLevel = zoomLevel,
                zoom = currentTransform.zoom
            ),
            modifier = Modifier.fillMaxSize()
        )

        // T10 修订：右上角"⋮"按钮，点击弹出收藏/删除菜单
        // 仅在可交互缩放级别显示（THUMBNAIL 级别不显示，避免遮挡）
        if (zoomLevel != ZoomLevel.THUMBNAIL) {
            WidgetMenuButton(
                onClick = onShowMenu,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
            )
        }
    }
}

/**
 * 组件菜单按钮（⋮），点击弹出收藏/删除菜单（T10 修订）。
 */
@Composable
private fun WidgetMenuButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    IconButton(
        onClick = onClick,
        modifier = modifier.size(24.dp)
    ) {
        Icon(
            imageVector = Icons.Default.MoreVert,
            contentDescription = "组件菜单",
            tint = Color(0xFF666666),
            modifier = Modifier.size(16.dp)
        )
    }
}

/**
 * 缩略图占位（v4 #21：CanvasScreen 视口剔除用）。
 *
 * 超出视口或处于 THUMBNAIL 缩放级别（zoom < 0.3）的组件用此占位，
 * 渲染为 Apple Watch 风格彩色小球：72dp 实心圆形 + 白色边框 + 阴影 + 类型符号。
 * 不同 Widget 类型用不同颜色，便于在缩略级别快速识别组件。
 *
 * @param type 组件类型（决定小球颜色 + 符号）
 * @param title 组件标题（保留参数兼容调用方，小球模式下不显示文字）
 * @param modifier 外层 Modifier
 */
@Composable
fun WidgetThumbnailPlaceholder(
    type: com.livingdashboard.data.entity.WidgetType,
    title: String,
    modifier: Modifier = Modifier
) {
    val color = when (type) {
        com.livingdashboard.data.entity.WidgetType.AI_ASSISTANT -> Color(0xFF4A90E2)
        com.livingdashboard.data.entity.WidgetType.WEBVIEW -> Color(0xFF34C759)
        com.livingdashboard.data.entity.WidgetType.HTML_CANVAS -> Color(0xFFFF9500)
        com.livingdashboard.data.entity.WidgetType.CALCULATOR -> Color(0xFFFF3B30)
        com.livingdashboard.data.entity.WidgetType.FOCUS_TIMER -> Color(0xFF5856D6)
        com.livingdashboard.data.entity.WidgetType.FREE_HTML -> Color(0xFF8E8E93)
    }
    val symbol = when (type) {
        com.livingdashboard.data.entity.WidgetType.AI_ASSISTANT -> "AI"
        com.livingdashboard.data.entity.WidgetType.WEBVIEW -> "W"
        com.livingdashboard.data.entity.WidgetType.HTML_CANVAS -> "H"
        com.livingdashboard.data.entity.WidgetType.CALCULATOR -> "÷"
        com.livingdashboard.data.entity.WidgetType.FOCUS_TIMER -> "T"
        com.livingdashboard.data.entity.WidgetType.FREE_HTML -> "<>"
    }
    Box(
        modifier = modifier
            .size(72.dp)
            .shadow(elevation = 4.dp, shape = CircleShape)
            .clip(CircleShape)
            .background(color)
            .border(width = 3.dp, color = Color.White, shape = CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = symbol,
            color = Color.White,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
    }
}
