package com.livingdashboard.ui.canvas

import androidx.compose.runtime.Immutable
import com.livingdashboard.ui.widget.ZoomLevel

/**
 * 画布变换状态（缩放 + 平移），Spec 5.2 节。
 *
 * - x/y：屏幕坐标系的平移量（像素）
 * - zoom：缩放系数（1.0 = 100%）
 *
 * 渲染时组件屏幕位置 = 画布坐标 * zoom + (x, y)。
 *
 * 范围限制：
 * - zoom ∈ [MIN_ZOOM, MAX_ZOOM]
 * - MIN_ZOOM = 0.15（< 0.3 进入缩略图级别）
 * - MAX_ZOOM = 2.0（> 1.0 进入完整组件级别）
 *
 * v4 #20：与 WidgetContainer 配合使用 graphicsLayer 渲染，
 * 仅更新 GPU 合成层，不触发 measure/layout。
 */
@Immutable
data class CanvasTransform(
    val x: Float = 0f,
    val y: Float = 0f,
    val zoom: Float = 1f
) {
    companion object {
        /** 初始变换：无平移、无缩放 */
        val INITIAL = CanvasTransform(x = 0f, y = 0f, zoom = 1f)

        /** 最小缩放（< 0.3 进入缩略图级别，节省内存） */
        const val MIN_ZOOM = 0.15f

        /** 最大缩放（> 1.0 进入完整组件级别，查看细节） */
        const val MAX_ZOOM = 2.0f
    }
}

/**
 * 画布引擎：坐标转换 + 缩放钳制，Spec 5.2 节。
 *
 * 参考 Workspace.tsx 的 screenToCanvas / canvasToScreen。
 * 所有方法纯函数，无副作用，可在 ViewModel/Composable 中安全调用。
 */
object CanvasEngine {

    /** 屏幕坐标 → 画布坐标（用于点击命中测试） */
    fun screenToCanvas(
        screenX: Float,
        screenY: Float,
        transform: CanvasTransform
    ): Pair<Float, Float> {
        val canvasX = (screenX - transform.x) / transform.zoom
        val canvasY = (screenY - transform.y) / transform.zoom
        return canvasX to canvasY
    }

    /** 画布坐标 → 屏幕坐标（用于渲染定位） */
    fun canvasToScreen(
        canvasX: Float,
        canvasY: Float,
        transform: CanvasTransform
    ): Pair<Float, Float> {
        val screenX = canvasX * transform.zoom + transform.x
        val screenY = canvasY * transform.zoom + transform.y
        return screenX to screenY
    }

    /** 钳制缩放级别到 [MIN_ZOOM, MAX_ZOOM] */
    fun clampZoom(zoom: Float): Float =
        zoom.coerceIn(CanvasTransform.MIN_ZOOM, CanvasTransform.MAX_ZOOM)
}

/**
 * 根据 zoom 系数推断缩放级别（D9 分层渲染）。
 *
 * 现有 [ZoomLevel] 枚举值映射：
 * - < 0.3 → THUMBNAIL（缩略图：只显示图标 + 标题，节省内存）
 * - 0.3 ~ 0.7 → SUMMARY（摘要：关键信息）
 * - 0.7 ~ 1.0 → INTERACTIVE（交互：完整可交互界面）
 * - > 1.0 → FULL（完整：放大查看细节）
 *
 * 适配 Spec 5.2 节 ZoomLevel.fromZoom 语义，但使用现有 ui.widget.ZoomLevel 枚举值。
 */
fun zoomLevelFromZoom(zoom: Float): ZoomLevel = when {
    zoom < 0.3f -> ZoomLevel.THUMBNAIL
    zoom < 0.5f -> ZoomLevel.SUMMARY
    zoom <= 1.5f -> ZoomLevel.INTERACTIVE
    else -> ZoomLevel.FULL
}
