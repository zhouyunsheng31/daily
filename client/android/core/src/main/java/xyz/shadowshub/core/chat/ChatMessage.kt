package xyz.shadowshub.core.chat

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** 对话消息（契约镜像：shared/webos-contracts WebOsChatMessage） */
@Serializable
data class ChatMessage(
    val role: String, // user | assistant
    val content: String,
    val thinking: String? = null,
    val toolCall: ToolCallState? = null,
    val toolCalls: List<ToolCallState>? = null,
    val createdAt: Long? = null,
) {
    @Serializable
    data class ToolCallState(val tool: String, val done: Boolean? = null, val ok: Boolean? = null)
}

/** chat/stream 请求体（契约镜像：WebOsChatRequest） */
data class ChatStreamRequest(
    val messages: List<ChatMessage>,
    val model: String = "flash",
    val thinking: String = "medium",
    val conversationId: String = "default",
    val rebuild: Boolean = false,
    /** SSE 重连（2026-08-11 架构统一）：重放任务缓冲 + 接管活跃连接，不扣费 */
    val resume: Boolean = false,
    /** resume 时携带最后一条用户消息（服务端用于匹配任务缓冲） */
    val lastUser: String? = null,
) {
    fun toJsonObject(): JsonObject = buildJsonObject {
        putJsonArray("messages") {
            messages.forEach { m ->
                add(
                    buildJsonObject {
                        put("role", m.role)
                        put("content", m.content)
                    }
                )
            }
        }
        put("model", model)
        put("thinking", thinking)
        put("conversationId", conversationId)
        put("rebuild", rebuild)
        put("resume", resume)
        if (lastUser != null) put("lastUser", lastUser)
    }

    val json: String get() = Json.encodeToString(JsonObject.serializer(), toJsonObject())
}