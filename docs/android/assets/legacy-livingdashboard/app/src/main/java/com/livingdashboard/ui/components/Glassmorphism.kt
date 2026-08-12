package com.livingdashboard.ui.components

import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.livingdashboard.ui.theme.GlassBackground

/**
 * D6 毛玻璃效果（Spec 9.2）。
 *
 * 修复：移除 [Modifier.blur] 调用。
 * Compose 的 Modifier.blur 会模糊当前 composable 的所有内容（包括图标和文字），
 * 而非像 CSS backdrop-filter 只模糊背景。在 44dp 高的工具栏上应用 20dp blur
 * 会导致图标和文字完全不可识别（用户反馈"模糊不可见"）。
 *
 * 现仅保留半透明背景色（GlassBackground = rgba(255,255,255,0.85)）实现毛玻璃视觉效果，
 * 确保工具栏内容（图标/文字）清晰可读。
 *
 * @param blurRadius 保留参数兼容现有调用，不再使用（已弃用）
 * @param backgroundColor 背景色（默认 GlassBackground = rgba(255,255,255,0.85)）
 */
fun Modifier.glassmorphism(
    blurRadius: Dp = 20.dp,
    backgroundColor: Color = GlassBackground
): Modifier = this.then(
    Modifier.background(backgroundColor)
)
