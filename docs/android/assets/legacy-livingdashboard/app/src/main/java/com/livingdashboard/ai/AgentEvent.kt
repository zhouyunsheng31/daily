package com.livingdashboard.ai

import kotlinx.serialization.json.JsonObject

/**
 * Agent 推送到 UI 的事件（Spec 6.2 节）。
 *
 * UI 收集 [AgentLoop.run] 返回的 Flow，按事件类型更新聊天列表。
 */
sealed class AgentEvent {
    /**
     * 每轮 LLM 请求开始时 emit，UI 重置上一条 assistant 消息的 isComplete=false。
     * 无字段，使用 object 单例。
     */
    object TurnStart : AgentEvent()

    /** AI 文本增量（assistant 消息内容） */
    data class TextDelta(val text: String) : AgentEvent()

    /** AI 思考链增量（UI 折叠显示） */
    data class ThinkingDelta(val text: String) : AgentEvent()

    /** 工具调用开始 */
    data class ToolCallStart(val callId: String, val toolName: String, val args: JsonObject) : AgentEvent()

    /** 工具调用结束 */
    data class ToolCallEnd(val callId: String, val success: Boolean, val result: String) : AgentEvent()

    /** 一轮对话结束（无 tool_calls 或达到最大轮次） */
    data class TurnEnd(val finishReason: String) : AgentEvent()

    /** 错误（可恢复时 recoverable=true，UI 给出重试按钮） */
    data class Error(val message: String, val recoverable: Boolean = false) : AgentEvent()
}
