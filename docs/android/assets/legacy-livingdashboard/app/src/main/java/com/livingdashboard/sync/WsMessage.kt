package com.livingdashboard.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// WS JSON 配置：classDiscriminator = "kind"（与服务器协议一致）
// 服务器 ws.ts 检查 msg.kind，默认 kotlinx 是 "type"，必须改
val WsJson = kotlinx.serialization.json.Json {
    classDiscriminator = "kind"
    ignoreUnknownKeys = true
    encodeDefaults = true
}

@Serializable
sealed class ClientMessage {
    @Serializable @SerialName("user_message")
    data class UserMessage(
        val panelId: String,
        val content: String
    ) : ClientMessage()

    @Serializable @SerialName("tool_result")
    data class ToolResult(
        val requestId: String,
        val success: Boolean,
        val data: JsonElement? = null,
        val error: String? = null
    ) : ClientMessage()

    @Serializable @SerialName("error_report")
    data class ErrorReport(
        val widgetId: String,
        val message: String,
        val stack: String? = null,
        val source: String
    ) : ClientMessage()

    @Serializable @SerialName("ping")
    object Ping : ClientMessage()

    /** M3 新增（Spec 5.1）：客户端回传 ask_user 的用户响应 */
    @Serializable @SerialName("ask_user_response")
    data class AskUserResponse(
        val requestId: String,
        val success: Boolean,
        val data: JsonElement? = null,
        val panelId: String? = null,
    ) : ClientMessage()

    /** M3 新增（Spec 5.1）：客户端通知服务器销毁指定面板的 Pi Agent session */
    @Serializable @SerialName("dispose_session")
    data class DisposeSession(
        val panelId: String,
    ) : ClientMessage()
}

@Serializable
sealed class ServerMessage {
    @Serializable @SerialName("tool_call")
    data class ToolCall(
        val requestId: String,
        val tool: String,
        val params: JsonElement,
        val targetDeviceId: String? = null,
        val panelId: String? = null
    ) : ServerMessage()

    @Serializable @SerialName("pi_event")
    data class PiEvent(
        val event: String,
        val data: JsonElement,
        val panelId: String? = null
    ) : ServerMessage()

    @Serializable @SerialName("session_ready")
    data class SessionReady(
        val sessionId: String,
        val panelId: String? = null
    ) : ServerMessage()

    @Serializable @SerialName("error")
    data class Error(
        val message: String,
        val panelId: String? = null
    ) : ServerMessage()

    @Serializable @SerialName("pong")
    object Pong : ServerMessage()

    @Serializable @SerialName("change")
    data class Change(
        val changeType: String,
        val data: JsonElement,
        val sourceDeviceId: String? = null
    ) : ServerMessage()

    /** M3 新增（Spec 5.1）：服务器 ask_user 工具执行时下发，弹窗询问用户 */
    @Serializable @SerialName("ask_user")
    data class AskUser(
        val requestId: String,
        val prompt: String,
        val message: String? = null,
        val options: List<String> = emptyList(),
        val allowMultiple: Boolean = false,
        val panelId: String? = null,
    ) : ServerMessage()
}
