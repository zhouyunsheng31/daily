package com.livingdashboard.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

// M0 默认颜色方案（保留，用于 themeColorIndex = -1 且非 dynamicColor 时兜底）
private val DarkColorScheme = darkColorScheme(
    primary = Purple80,
    secondary = PurpleGrey80,
    tertiary = Pink80,
    background = GlassBackgroundDark,
    surface = GlassBackgroundDark,
    onSurface = PrimaryText,
    onBackground = PrimaryText
)

/**
 * M2 白色洁净色系 LightColorScheme（Spec 9.1，D6）。
 *
 * - background / surface：纯白 #FFFFFF
 * - onSurface / onBackground：主文字 #1D1D1F
 * - onSurfaceVariant：次文字 #86868B
 * - error：#FF3B30
 *
 * primary 仍由 themeColorIndex/dynamicColor 逻辑控制（保持 M1 兼容）。
 */
private val LightColorScheme = lightColorScheme(
    primary = Purple40,
    secondary = PurpleGrey40,
    tertiary = Pink40,
    background = androidx.compose.ui.graphics.Color.White,
    surface = androidx.compose.ui.graphics.Color.White,
    onSurface = PrimaryText,
    onBackground = PrimaryText,
    onSurfaceVariant = SecondaryText,
    error = ErrorColor
)

/**
 * Living Dashboard 主题（Spec 3.4 节 C3 修复 + Spec 9.1 D6 白色洁净色系）。
 *
 * @param themeColorIndex 主题色索引：
 * - -1（默认）= 跟随系统 dynamicColor（Android 12+）或 M0 默认紫色
 * - 0..5 = 预设主题色（ThemeColors[index]），强制禁用 dynamicColor
 * @param darkTheme 是否暗色主题（默认跟随系统）
 * @param dynamicColor 是否启用 dynamicColor（默认 true，但 themeColorIndex >= 0 时强制关闭）
 * @param content Composable 内容
 *
 * C3 修复：当用户选择预设主题色（themeColorIndex >= 0）时，必须禁用 dynamicColor，
 * 否则两者会冲突（dynamicColor 覆盖 primary 色）。
 *
 * M2 D6：LightColorScheme 改用白色洁净色系（纯白背景 + #1D1D1F 主文字）。
 */
@Composable
fun LivingDashboardTheme(
    themeColorIndex: Int = -1,
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val useDynamicColor = dynamicColor && themeColorIndex < 0 &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    val colorScheme = when {
        useDynamicColor -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        themeColorIndex >= 0 -> {
            val baseColor = ThemeColors.getOrElse(themeColorIndex) { ThemeColors[0] }
            if (darkTheme) {
                darkColorScheme(
                    primary = baseColor,
                    background = GlassBackgroundDark,
                    surface = GlassBackgroundDark,
                    onSurface = PrimaryText,
                    onBackground = PrimaryText
                )
            } else {
                lightColorScheme(
                    primary = baseColor,
                    background = androidx.compose.ui.graphics.Color.White,
                    surface = androidx.compose.ui.graphics.Color.White,
                    onSurface = PrimaryText,
                    onBackground = PrimaryText,
                    onSurfaceVariant = SecondaryText,
                    error = ErrorColor
                )
            }
        }
        else -> {
            if (darkTheme) DarkColorScheme else LightColorScheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
