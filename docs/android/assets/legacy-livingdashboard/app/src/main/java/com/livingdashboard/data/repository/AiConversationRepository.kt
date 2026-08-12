package com.livingdashboard.data.repository

import com.livingdashboard.ai.LlmMessage
import com.livingdashboard.ai.ToolCall
import com.livingdashboard.data.dao.AiConversationDao
import com.livingdashboard.data.entity.AiConversationEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import javax.inject.Inject

/**
 * AI 对话 Repository（Spec 6.8 节）。
 *
 * 包装 [AiConversationDao]，对外提供 suspend 写入 + Flow 订阅 + Session 恢复能力。
 *
 * C6 修复要点：
 * - assistant 消息的 tool_calls 用 args 字段持久化（JSON 序列化后的 toolCalls 数组）
 * - loadFromHistory 时从 args 反序列化 toolCalls，重建 LlmMessage.toolCalls
 * - tool_result 角色不进 LLM 上下文（仅 UI 展示），避免 "tool message without matching tool_call" 错误
 *
 * 注：spec 原文用 `WsJson.encodeToString(ListSerializer(ToolCall.serializer()), toolCalls)`，
 * 但 [ToolCall]（定义在 ai/Session.kt）未标注 @Serializable，且本任务不允许修改 Session.kt。
 * 这里用等价的手动 JSON 序列化实现，存储格式与 spec 一致（JSON 数组，每元素含 id/name/arguments）。
 */
class AiConversationRepository @Inject constructor(
    private val dao: AiConversationDao,
) {
    fun observeByPanel(panelId: String): Flow<List<AiConversationEntity>> = dao.observeByPanel(panelId)

    /**
     * 追加一条对话记录。
     *
     * @param panelId 面板 ID
     * @param role user / assistant / assistant_thinking / tool_call / tool_result / error
     * @param content 文本内容
     * @param turnIndex 第几轮 LLM 调用
     * @param toolCallId role=tool_result 时关联的 tool call id
     * @param toolName role=tool_call / tool_result 时的工具名
     * @param args C6 新增：role=tool_call 时传 JSON 序列化后的 toolCalls 数组
     */
    suspend fun appendMessage(
        panelId: String, role: String, content: String, turnIndex: Int,
        toolCallId: String? = null, toolName: String? = null,
        args: String? = null,
    ) {
        dao.insert(
            AiConversationEntity(
                id = 0,  // autoGenerate，由 Room 分配
                panelId = panelId,
                role = role,
                content = content,
                toolCallId = toolCallId,
                toolName = toolName,
                args = args,
                turnIndex = turnIndex,
                createdAt = System.currentTimeMillis(),
            )
        )
    }

    suspend fun deleteByPanel(panelId: String) = dao.deleteByPanel(panelId)

    /**
     * C6 + 代码 C3 修复：
     * - 过滤掉 tool_result 角色（不进 LlmMessage 列表）
     * - assistant 消息的 tool_calls 用 args 字段持久化，loadFromHistory 时从 args 反序列化 toolCalls 数组
     * - tool_result 角色仅 UI 展示用，不进 LLM 上下文（避免 tool message without matching tool_call 错误）
     *
     * 设计权衡：tool_result 不进 LLM 上下文意味着重启后 AI 不知道工具调用结果。
     * 但保留 assistant.tool_calls 让 AI 知道"我之前调过工具 X"，避免重复调用。
     * 完整工具结果保留在 DB 中供 UI 展示。
     */
    suspend fun getRecentForSessionRestore(panelId: String, limit: Int = 20): List<LlmMessage> {
        val entities = dao.getRecent(panelId, limit)
        return entities.mapNotNull { e ->
            when (e.role) {
                "user" -> LlmMessage(role = "user", content = e.content)
                "assistant" -> {
                    // C6：从 args 反序列化 toolCalls 数组（若有）
                    val toolCalls = e.args?.let { parseToolCalls(it) }
                    LlmMessage(role = "assistant", content = e.content, toolCalls = toolCalls)
                }
                // 代码 C3：tool_result 不进 LLM 上下文（仅 UI 展示）
                "tool_result", "tool_call", "assistant_thinking", "error" -> null
                else -> null
            }
        }
    }

    /** C6：把 List<ToolCall> 序列化为 JSON 字符串存到 args 字段 */
    fun serializeToolCalls(toolCalls: List<ToolCall>): String {
        val array = buildJsonArray {
            toolCalls.forEach { tc ->
                addJsonObject {
                    put("id", tc.id)
                    put("name", tc.name)
                    put("arguments", tc.arguments)
                }
            }
        }
        return array.toString()
    }

    /** C6：从 args JSON 反序列化 toolCalls 数组 */
    private fun parseToolCalls(argsJson: String): List<ToolCall>? = try {
        val array = Json.parseToJsonElement(argsJson).jsonArray
        array.map { el ->
            val obj = el.jsonObject
            ToolCall(
                id = obj["id"]?.jsonPrimitive?.contentOrNull ?: "",
                name = obj["name"]?.jsonPrimitive?.contentOrNull ?: "",
                arguments = obj["arguments"]?.jsonPrimitive?.contentOrNull ?: "",
            )
        }
    } catch (e: Exception) {
        null
    }
}
