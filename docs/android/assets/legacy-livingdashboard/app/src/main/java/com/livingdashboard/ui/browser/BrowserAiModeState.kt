package com.livingdashboard.ui.browser

import com.livingdashboard.ui.canvas.UiChatMessage

/**
 * 浏览器底部栏 AI 模式状态（Spec 6.13 节）。
 *
 * 由 [BrowserViewModel] 持有，驱动 [com.livingdashboard.ui.components.BottomBar] 的 AI 输入框模式
 * 与 BrowserScreen 的 AI 对话浮层。
 *
 * @param aiMode 是否处于 AI 输入框模式（true=底部栏显示 AI 输入框，false=显示按钮行）
 * @param aiInputText AI 输入框当前文本
 * @param aiExpanded AI 对话浮层是否展开（true=半屏浮层显示对话历史）
 * @param aiMessages AI 对话消息列表（用户 + 助手 + 工具调用等）
 * @param aiWorking AI 是否处于工作态（true=底部栏显示 AI 工作状态 pill，优先于 aiMode）
 * @param aiWorkingStatusText AI 工作态状态文字（如"AI 正在浏览 baidu.com..."）
 */
data class BrowserAiModeState(
    val aiMode: Boolean = false,
    val aiInputText: String = "",
    val aiExpanded: Boolean = false,
    val aiMessages: List<UiChatMessage> = emptyList(),
    val aiWorking: Boolean = false,
    val aiWorkingStatusText: String = "",
)
