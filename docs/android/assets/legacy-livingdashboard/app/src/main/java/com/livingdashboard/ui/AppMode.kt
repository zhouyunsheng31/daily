package com.livingdashboard.ui

/**
 * App 模式（浏览器 / 画布），Spec 7.1 节。
 *
 * - BROWSER：浏览器模式，主页为 BrowserHomeScreen
 * - CANVAS：画布模式，主页为 CanvasHomeScreen
 *
 * Home 键切换规则（D3）：
 * 当前模式按 Home → 回到当前模式主页
 * 再按 Home → 切换到另一模式
 *
 * 默认模式由首次启动选择（D4，HomeModeSelectorScreen）。
 */
enum class AppMode {
    BROWSER,
    CANVAS
}
