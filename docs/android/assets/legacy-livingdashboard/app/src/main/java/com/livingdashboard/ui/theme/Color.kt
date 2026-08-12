package com.livingdashboard.ui.theme

import androidx.compose.ui.graphics.Color

// ===== M0 默认色板（保留，用于 themeColorIndex = -1 兜底） =====

val Purple80 = Color(0xFFD0BCFF)
val PurpleGrey80 = Color(0xFFCCC2DC)
val Pink80 = Color(0xFFEFB8C8)

val Purple40 = Color(0xFF6650a4)
val PurpleGrey40 = Color(0xFF625b71)
val Pink40 = Color(0xFF7D5260)

// ===== M1 预设主题色（Spec 3.4 节） =====

/**
 * 6 色预设主题色列表（Spec 3.4 节）。
 *
 * - 索引 0：紫色（M0 Purple40，默认主题色，保证 M0/M1 视觉一致）
 * - 索引 1：蓝色
 * - 索引 2：青色
 * - 索引 3：橙色
 * - 索引 4：红色
 * - 索引 5：绿色
 *
 * themeColorIndex = -1 时跟随系统 dynamicColor（Android 12+）或 Purple40 兜底；
 * themeColorIndex = 0..5 时用 ThemeColors[index] 作为 primary 构建颜色方案，禁用 dynamicColor。
 *
 * 设置页"主题色"分组显示 7 个选项：1 个"跟随系统" + 6 个预设色。
 */
val ThemeColors = listOf(
    Color(0xFF6650a4),  // 紫色（M0 Purple40，默认主题色）
    Color(0xFF0066CC),  // 蓝色
    Color(0xFF00897B),  // 青色
    Color(0xFFE65100),  // 橙色
    Color(0xFFC62828),  // 红色
    Color(0xFF2E7D32)   // 绿色
)

// ===== M2 白色洁净色系（Spec 9.1 + 9.2，D6） =====

/**
 * 毛玻璃背景色（Spec 9.2）。
 * - GlassBackground：浅色模式，rgba(255,255,255,0.85)
 * - GlassBackgroundDark：暗色模式，rgba(0,0,0,0.6)
 */
val GlassBackground = Color(0xD9FFFFFF)
val GlassBackgroundDark = Color(0x99000000)

/** 卡片背景：未聚焦 rgba(0,0,0,0.03) / 聚焦 rgba(0,0,0,0.06) */
val CardBackground = Color(0x08000000)
val CardBackgroundFocused = Color(0x0F000000)

/** 聊天气泡背景：用户 rgba(0,0,0,0.05) / AI rgba(0,0,0,0.03) */
val UserBubbleColor = Color(0x0D000000)
val AiBubbleColor = Color(0x08000000)

/** 分隔线 rgba(0,0,0,0.06) */
val DividerColor = Color(0x0F000000)

/** 文字色：主文字 #1D1D1F / 次文字 #86868B */
val PrimaryText = Color(0xFF1D1D1F)
val SecondaryText = Color(0xFF86868B)

/** 状态色（Spec 9.1） */
val ErrorColor = Color(0xFFFF3B30)
val SuccessColor = Color(0xFF34C759)
