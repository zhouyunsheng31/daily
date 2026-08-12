package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * AI 对话历史 Entity（Spec 6.8 / Room M3）。
 *
 * 表名 "ai_conversations"。
 *
 * 按 panelId 持久化 AI 对话消息，App 重启后从 Room 恢复历史消息。
 *
 * 字段：
 * - [id]：自增主键（Long）
 * - [panelId]：所属面板 ID（与 CanvasHomeViewModel.currentPanelId 一致；浏览器用 "browser_session"）
 * - [role]：消息角色（user / assistant / assistant_thinking / tool_call / tool_result / error）
 * - [content]：消息内容（文本）
 * - [turnIndex]：对话轮次索引（按用户消息计数，同一轮的 assistant/thinking/tool_call 共享同一 turnIndex）
 * - [args]：assistant 消息附带的工具调用 JSON 字符串（由 AiConversationRepository.serializeToolCalls 序列化）
 * - [toolCallId]：tool_call 消息的工具调用 ID（与 LLM 配对）
 * - [toolName]：tool_call 消息的工具名
 * - [createdAt]：创建时间戳（毫秒）
 *
 * 索引：
 * - `(panel_id, created_at)`：用于 observeByPanel 排序 + 查询
 *
 * 调用方：
 * - [com.livingdashboard.ui.canvas.CanvasHomeViewModel]（observeByPanel + appendMessage）
 * - [com.livingdashboard.ui.browser.BrowserViewModel]（observeByPanel + appendMessage）
 * - [com.livingdashboard.ui.widget.AiWidgetViewModel]（observeByPanel + appendMessage）
 * - [com.livingdashboard.data.repository.AiConversationRepository]
 */
@Entity(
    tableName = "ai_conversations",
    indices = [
        Index(value = ["panel_id", "created_at"]),
    ]
)
data class AiConversationEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,

    @ColumnInfo(name = "panel_id")
    val panelId: String,

    @ColumnInfo(name = "role")
    val role: String,

    @ColumnInfo(name = "content")
    val content: String,

    @ColumnInfo(name = "turn_index")
    val turnIndex: Int = 0,

    @ColumnInfo(name = "args")
    val args: String? = null,

    @ColumnInfo(name = "tool_call_id")
    val toolCallId: String? = null,

    @ColumnInfo(name = "tool_name")
    val toolName: String? = null,

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
)
