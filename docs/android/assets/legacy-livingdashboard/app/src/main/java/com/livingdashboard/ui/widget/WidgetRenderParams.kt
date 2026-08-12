package com.livingdashboard.ui.widget

/**
 * MVP 组件类型枚举（Spec 附录 A，D10）。
 * - AI_ASSISTANT：AI 助手占位（M3 接入真实能力）
 * - WEBVIEW：网页组件（复用 M1 LivingWebView）
 * - CALCULATOR：计算器
 * - FOCUS_TIMER：专注计时（番茄钟）
 * - HTML_CANVAS：HTML 画布（用 WebView 渲染 HTML）
 * - FREE_HTML：自由 HTML（共享 DOM，任意形状，pointer-events 穿透）
 */
enum class WidgetType {
    AI_ASSISTANT,
    WEBVIEW,
    CALCULATOR,
    FOCUS_TIMER,
    HTML_CANVAS,
    FREE_HTML
}

/**
 * 画布缩放级别（Spec 5.4，D9 分层渲染）。
 * - THUMBNAIL：缩略图，只显示图标 + 标题，节省内存（视口剔除用）
 * - SUMMARY：摘要，显示关键信息（如最近消息、当前表达式）
 * - INTERACTIVE：交互，完整可交互界面
 * - FULL：全屏，组件独占屏幕
 */
enum class ZoomLevel {
    THUMBNAIL,
    SUMMARY,
    INTERACTIVE,
    FULL
}

/**
 * 组件渲染参数（Spec 5.2 + M3 6.12 节）。
 *
 * 组件不直接依赖 Room，通过 [onStateChange] 回调将状态变更通知上层（ViewModel → Repository）。
 *
 * M3 新增 [panelId] 字段：AIAssistantWidget 需要知道所属面板 ID 才能隔离 AI 对话上下文。
 * 默认值 `""` 保证既有调用方（CanvasScreen.kt 等）无需修改即可编译（M5 修复）。
 *
 * @param widgetId 组件实例唯一 ID
 * @param panelId 所属面板 ID（M3 新增，默认 ""，AIAssistantWidget 用它隔离 Session）
 * @param type 组件类型，用于 WidgetRenderer 分发
 * @param title 组件标题（缩略图级别显示）
 * @param state 组件状态（如 url、html、mode 等），由上层从 WidgetEntity 注入
 * @param zoomLevel 当前缩放级别，决定渲染呈现
 * @param zoom 当前画布缩放系数（0.x ~ N），供组件做精细适配
 * @param onStateChange 状态变更回调，组件调用此函数持久化新状态
 */
data class WidgetRenderParams(
    val widgetId: String,
    val panelId: String = "",  // M3 新增，M5 加默认值（不破坏现有 CanvasScreen.kt 调用方）
    val type: WidgetType,
    val title: String,
    val state: Map<String, Any>,
    val zoomLevel: ZoomLevel,
    val zoom: Float,
    val onStateChange: (Map<String, Any>) -> Unit
)
