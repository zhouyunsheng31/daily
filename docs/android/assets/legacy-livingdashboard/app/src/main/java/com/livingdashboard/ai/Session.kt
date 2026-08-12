package com.livingdashboard.ai

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * LLM 工具调用（OpenAI 兼容 wire format 中的 function 子对象）。
 *
 * @param id 工具调用 ID（由 LLM 生成，tool_result 消息回传此 ID 配对）
 * @param name 工具名
 * @param arguments JSON 字符串（流式分片累积后的最终参数）
 */
data class ToolCall(
    val id: String,
    val name: String,
    val arguments: String,
)

/**
 * LLM 消息（OpenAI 兼容格式的 Kotlin 表示）。
 *
 * 字段采用 camelCase（Kotlin 惯例），[LlmClient] 在序列化为 wire format 时
 * 转换为 snake_case（tool_calls / tool_call_id / reasoning_content）。
 *
 * @param role "system" | "user" | "assistant" | "tool"
 * @param content 文本内容（system/user/assistant 有，tool 时为工具结果 JSON 字符串）
 * @param toolCalls role=assistant 时 LLM 返回的工具调用列表
 * @param toolCallId role=tool 时对应的 tool_call.id（配对要求）
 * @param reasoningContent 思考链内容（DeepSeek reasoning_content / Qwen thinking）
 */
data class LlmMessage(
    val role: String,
    val content: String? = null,
    val toolCalls: List<ToolCall>? = null,
    val toolCallId: String? = null,
    val reasoningContent: String? = null,
)

/**
 * 单面板对话上下文（inMemory，M8 不持久化）。
 *
 * C7 修复（Spec 6.17）：`_messages` 改用 [Mutex] 保护，避免 AIAssistantWidget 与
 * CanvasHomeViewModel 并发操作同一 Session 导致 `ConcurrentModificationException`。
 *
 * @param systemPrompt 系统提示词（含 skills + canvas/browser prompt）
 * @param tools 可用工具列表（用于构造 LlmRequest.tools；AgentLoop 内部用 toolRegistry 执行）
 */
class Session(
    val systemPrompt: String,
    val tools: List<ToolDefinition>,
) {
    private val mutex = Mutex()
    private val _messages = mutableListOf<LlmMessage>()

    /**
     * 当前消息列表（只读快照）。
     *
     * 注意：因 [mutex.withLock] 是 suspend 函数，此处为 suspend 函数而非属性 getter。
     * 调用方需在协程上下文中调用。
     */
    suspend fun messages(): List<LlmMessage> = mutex.withLock { _messages.toList() }

    init {
        // init 块在构造时执行，此时无其他协程访问，无需加锁
        _messages.add(LlmMessage(role = "system", content = systemPrompt))
    }

    /** 添加用户消息 */
    suspend fun addUserMessage(content: String) = mutex.withLock {
        _messages.add(LlmMessage(role = "user", content = content))
    }

    /** 添加 assistant 消息（含可选 tool_calls） */
    suspend fun addAssistantMessage(content: String?, toolCalls: List<ToolCall>?) = mutex.withLock {
        _messages.add(LlmMessage(role = "assistant", content = content, toolCalls = toolCalls))
    }

    /** 添加 tool 结果消息（与 assistant.tool_calls 配对） */
    suspend fun addToolResultMessage(toolCallId: String, content: String) = mutex.withLock {
        _messages.add(LlmMessage(role = "tool", content = content, toolCallId = toolCallId))
    }

    /**
     * 超过 keepRecent+1 条消息时裁剪（Spec 6.4 节 trim bug 修复版）。
     *
     * 修复点：
     * 1. 取 system + tail，不重复 system
     * 2. 跳过 tail 开头的 tool 消息（其对应 assistant.tool_calls 已被裁掉，
     *    保留会导致下一轮 LLM 报错 "tool message without matching tool_call"）
     *
     * @param keepRecent 保留的最近消息数（不含 system），默认 20
     */
    suspend fun trim(keepRecent: Int = 20) = mutex.withLock {
        if (_messages.size <= keepRecent + 1) return@withLock
        val system = _messages.first()
        val tail = _messages.takeLast(keepRecent).toMutableList()
        // 跳过 tail 开头的 tool 消息（避免破坏 tool_call/tool_result 配对）
        while (tail.isNotEmpty() && tail.first().role == "tool") {
            tail.removeAt(0)
        }
        _messages.clear()
        _messages.add(system)
        _messages.addAll(tail)
    }

    /** 清空消息（保留 system） */
    suspend fun clear() = mutex.withLock {
        _messages.clear()
        _messages.add(LlmMessage(role = "system", content = systemPrompt))
    }

    /**
     * M3 新增：替换 system prompt（保留后续消息）。
     *
     * 每次 sendMessage 时调，拼接页面上下文到 system prompt。
     */
    suspend fun updateSystemPrompt(newPrompt: String) = mutex.withLock {
        if (_messages.isNotEmpty() && _messages[0].role == "system") {
            _messages[0] = LlmMessage(role = "system", content = newPrompt)
        } else {
            _messages.add(0, LlmMessage(role = "system", content = newPrompt))
        }
    }

    /**
     * M3 新增：从历史消息恢复（不覆盖 system 消息）。
     *
     * C6 修复：history 中的 assistant 消息已由 AiConversationRepository.getRecentForSessionRestore
     * 从 DB args 字段反序列化重建 toolCalls，本方法直接加载 List<LlmMessage>。
     *
     * @param history 历史消息列表（不含 system，system 由构造时的 systemPrompt 提供）
     */
    suspend fun loadFromHistory(history: List<LlmMessage>) = mutex.withLock {
        _messages.clear()
        _messages.add(LlmMessage(role = "system", content = systemPrompt))
        _messages.addAll(history.filter { it.role != "system" })
    }
}
