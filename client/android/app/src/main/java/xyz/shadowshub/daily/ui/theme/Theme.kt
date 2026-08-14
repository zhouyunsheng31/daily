package xyz.shadowshub.daily.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ============================================================================
// Daily 品牌主题（2026-08-16 UI 探索定稿 ·「清亮通透 + 平面化」）
// 色值单一事实源：shared/webos-contracts 的 WEBOS_DEFAULT_DESIGN_TOKENS（D20）
// 优先级：用户 theme 包 > 动态取色 > 本默认（M1 阶段默认品牌色，dynamicColor=false）
// 浅色 = 清亮通透（暖白底 #F8F7F3 + 亮蓝 #4F8CFF）；深色 = 深蓝沉浸（#0F172A）
// ============================================================================

/** 浅色：清亮通透（暖白底 + 亮蓝主色，E1 同族） */
private val LightColors = lightColorScheme(
    primary = Color(0xFF4F8CFF),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFDCE8FF),
    onPrimaryContainer = Color(0xFF0A2B66),
    secondary = Color(0xFF315BD6),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE6EAFB),
    onSecondaryContainer = Color(0xFF1B3A8F),
    tertiary = Color(0xFF376B53),
    onTertiary = Color(0xFFFFFFFF),
    background = Color(0xFFF8F7F3),
    onBackground = Color(0xFF171918),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF171918),
    surfaceVariant = Color(0xFFF1F3F8),
    onSurfaceVariant = Color(0xFF424740),
    outline = Color(0xFFB9BEC9),
    outlineVariant = Color(0xFFE1E4EB),
    error = Color(0xFFA54B49),
    onError = Color(0xFFFFFFFF),
)

/** 深色：深蓝沉浸（#0F172A 底，E1 图标背景同族） */
private val DarkColors = darkColorScheme(
    primary = Color(0xFF7FB0FF),
    onPrimary = Color(0xFF0A2B66),
    primaryContainer = Color(0xFF1E3E8A),
    onPrimaryContainer = Color(0xFFDCE8FF),
    secondary = Color(0xFF9DB8FF),
    onSecondary = Color(0xFF10275C),
    secondaryContainer = Color(0xFF233766),
    onSecondaryContainer = Color(0xFFD5E0FF),
    tertiary = Color(0xFF7FB3A0),
    onTertiary = Color(0xFF0E2A1F),
    background = Color(0xFF0F172A),
    onBackground = Color(0xFFECEDF0),
    surface = Color(0xFF131C30),
    onSurface = Color(0xFFECEDF0),
    surfaceVariant = Color(0xFF1E2840),
    onSurfaceVariant = Color(0xFFA9B0C0),
    outline = Color(0xFF3D4A66),
    outlineVariant = Color(0xFF2A3650),
    error = Color(0xFFE08A88),
    onError = Color(0xFF4A1513),
)

/**
 * Daily 主题入口。
 * @param darkTheme 深色模式（默认跟随系统）
 * @param dynamicColor Material You 动态取色（默认关——品牌色优先；theme 包接入后为用户主题留位）
 */
@Composable
fun DailyTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor -> {
            // 动态取色（Material You 壁纸取色）——theme 包接入前的可选项
            androidx.compose.material3.dynamicLightColorScheme(androidx.compose.ui.platform.LocalContext.current)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
