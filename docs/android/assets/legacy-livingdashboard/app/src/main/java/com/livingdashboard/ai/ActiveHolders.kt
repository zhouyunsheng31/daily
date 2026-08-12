package com.livingdashboard.ai

import android.webkit.WebView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 活跃 WebView / PanelId 持有者（M8 Spec 七章 行 1696-1697）。
 *
 * Spec 原文用 `@Volatile var value: LivingWebView?`，但 LivingWebView 是 @Composable 函数
 * 而非 class（见 ui/browser/LivingWebView.kt:96）。实际活跃 WebView 是 [android.webkit.WebView]
 * 实例，由 CanvasHomeViewModel / BrowserViewModel 持有。本文件按真实类型 [WebView] 调整。
 *
 * 用 [MutableStateFlow] 持有，相对 `@Volatile var` 的优势：
 * - UI 层（Compose）可用 `holder.value.collectAsState()` 订阅变化，无需手动 invalidate
 * - 工具侧通过 `holder.value.value` 同步读取当前快照
 * - 线程安全（MutableStateFlow 内部用 atomic reference）
 *
 * 由 DI @Singleton 注入：UI 侧写、工具侧读，避免双向依赖。
 */

/**
 * 持有当前活跃的 [WebView]（浏览器/画布内嵌 WebView）。
 *
 * - 写入方：BrowserViewModel / CanvasHomeViewModel 在 WebView 创建/销毁时调 `holder.value.value = webView`
 * - 读取方：BrowserEvalTool / BrowserNavigateTool / BrowserGetUrlTool 通过 `webviewProvider()` 拿当前 WebView
 * - null 表示当前没有活跃 WebView（如用户尚未打开浏览器或 WebView 已销毁）
 */
class ActiveWebViewHolder {
    val value: MutableStateFlow<WebView?> = MutableStateFlow(null)

    /** 只读视图，UI 订阅用 */
    val state: StateFlow<WebView?> = value.asStateFlow()
}

/**
 * 持有当前活跃的画布面板 ID（PanelEntity.id）。
 *
 * - 写入方：CanvasViewModel 在面板切换时调 `holder.value.value = panelId`
 * - 读取方：ListWidgetsTool / CreateHtmlWidgetTool 通过 `panelIdProvider()` 拿当前 panelId
 * - null 表示当前没有活跃面板（如用户在主页或面板未加载完）
 */
class ActivePanelIdHolder {
    val value: MutableStateFlow<String?> = MutableStateFlow(null)

    /** 只读视图，UI 订阅用 */
    val state: StateFlow<String?> = value.asStateFlow()
}
