package com.livingdashboard.ui.widget

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 组件渲染器（Spec 5.4）。
 *
 * 根据 [WidgetRenderParams.type] 从 [WidgetRegistry] 查找渲染函数并调用；
 * 根据 [WidgetRenderParams.zoomLevel] 由组件内部决定分层呈现（D9）：
 * - THUMBNAIL：缩略图（图标 + 关键信息）
 * - SUMMARY：摘要（关键信息列表）
 * - INTERACTIVE：交互（完整可交互界面）
 * - FULL：全屏（组件独占屏幕）
 *
 * 设计要点：
 * - 缩略图由组件自定义（如 WebviewWidget 显示 favicon+域名、FocusTimerWidget 显示剩余时间），
 *   不用统一占位，因为各组件的"关键信息"语义不同
 * - 外层用 D6 白色洁净色系背景包装（透明 + 圆角）
 * - 未注册的 type 显示 UnknownWidget，便于调试时发现遗漏
 *
 * @param params 组件渲染参数
 * @param modifier 外层 Modifier
 */
@Composable
fun WidgetRenderer(
    params: WidgetRenderParams,
    modifier: Modifier = Modifier
) {
    val renderer = LocalWidgetRegistry.current.getRenderer(params.type)
    if (renderer == null) {
        UnknownWidget(params.type, modifier)
        return
    }

    // D6 白色洁净色系：半透明背景 + 圆角，让组件融入画布
    Box(
        modifier = modifier
            .background(
                color = Color(0x08000000),  // rgba(0,0,0,0.03)
                shape = RoundedCornerShape(12.dp)
            )
    ) {
        renderer(params)
    }
}

/**
 * 未知组件占位（type 未注册到 WidgetRegistry 时显示）。
 * 红色背景提示开发者注册遗漏。
 */
@Composable
private fun UnknownWidget(type: WidgetType, modifier: Modifier) {
    Box(
        modifier = modifier
            .background(Color(0xFFFFE0E0), RoundedCornerShape(8.dp))
            .padding(8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = "未知组件: $type",
            fontSize = 12.sp,
            color = Color(0xFFFF0000)
        )
    }
}
