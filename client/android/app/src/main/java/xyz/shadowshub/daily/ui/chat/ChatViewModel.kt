package xyz.shadowshub.daily.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import xyz.shadowshub.core.agent.AgentChatSource
import xyz.shadowshub.core.chat.ChatEvent
import xyz.shadowshub.core.chat.ChatMessage
import xyz.shadowshub.core.chat.ChatStreamRequest
import xyz.shadowshub.core.network.WebosRepository
import xyz.shadowshub.daily.data.SessionStore

/** 对话 UI 消息（含渲染状态） */
data class UiMessage(
    val id: Long,
    val role: String, // user | assistant
    val content: String,
    val thinking: String = "",
    val toolChips: List<ToolChip> = emptyList(),
    val streaming: Boolean = false,
)

data class ToolChip(val tool: String, val state: String) // state: running | ok | fail

data class ChatUiState(
    val sessionReady: Boolean = false,
    val sessionError: String? = null,
    val messages: List<UiMessage> = emptyList(),
    val streaming: Boolean = false,
    val busyWaiting: Boolean = false,
    val busyMessage: String? = null,
    val lastUsage: String? = null,
    val error: String? = null,
    val connected: Boolean = false,
)

/**
 * M0-2 对话状态机：游客会话 → chat/stream SSE 全事件渲染 → 断网 resume 重连。
 * 事件处理对齐 shared/webos-contracts WebOsChatEvent（2026-08-15 核实）。
 */
class ChatViewModel(
    private val repository: WebosRepository,
    private val sessionStore: SessionStore,
    private val agentSource: AgentChatSource? = null,
) : ViewModel() {

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private var streamJob: Job? = null
    private var messageId = 0L
    private var lastUserContent: String? = null
    private var conversationId = "default"
    private val thinkingLevel = "medium"

    init {
        initSession()
    }

    fun initSession() {
        viewModelScope.launch {
            _state.value = _state.value.copy(sessionError = null)
            val ok = repository.initSession(sessionStore.deviceId())
            if (ok) {
                _state.value = _state.value.copy(sessionReady = true, connected = true)
            } else {
                _state.value = _state.value.copy(sessionError = "无法连接服务器，请检查网络后重试")
            }
        }
    }

    /** 发送消息 */
    fun send(text: String) {
        val content = text.trim()
        if (content.isEmpty() || _state.value.streaming) return
        lastUserContent = content
        val userMsg = UiMessage(id = nextId(), role = "user", content = content)
        val assistantMsg = UiMessage(id = nextId(), role = "assistant", content = "", streaming = true)
        _state.value = _state.value.copy(
            messages = _state.value.messages + listOf(userMsg, assistantMsg),
            streaming = true,
            error = null,
        )
        if (agentSource != null) startLocalTurn() else startStream(resume = false)
    }

    /** 停止当前流（取消 SSE；通知服务端 abort 该会话的 pi 任务，上下文保留——
 *  否则 AI 继续在后台跑，下一条消息会撞 busy 重放旧任务内容） */
    fun stop() {
        streamJob?.cancel()
        streamJob = null
        _state.value = _state.value.copy(
            streaming = false,
            connected = false,
            busyWaiting = false,
        )
        markLastAssistantStreaming(false)
        // 2026-08-23：通知服务端终止该会话正在运行的 prompt（best-effort，失败
        // 不阻断——服务端任务跑完后仍保留上下文，用户可继续对话）
        viewModelScope.launch {
            repository.cancelChat(conversationId)
        }
    }

    /** 重连（断网/失败后手动触发）：resume 模式恢复后台任务事件流 */
    fun resume() {
        if (_state.value.streaming) return
        _state.value = _state.value.copy(error = null, connected = true)
        startStream(resume = true)
    }

    /** 本地 Agent 回合（D15 端侧 pi）：事件词汇与 SSE 完全一致，无断网 resume 概念 */
    private fun startLocalTurn() {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            val src = agentSource ?: return@launch
            var done = false
            runCatching {
                src.turn(conversationId, lastUserContent ?: "", thinkingLevel).collect { event ->
                    when (event) {
                        is ChatEvent.Delta -> appendDelta(event.content)
                        is ChatEvent.Thinking -> appendThinking(event.content)
                        is ChatEvent.ToolStart -> updateLastToolChip(event.tool, "running")
                        is ChatEvent.ToolUpdate -> { /* 占位：忽略过程增量 */ }
                        is ChatEvent.ToolEnd -> updateLastToolChip(event.tool, if (event.ok) "ok" else "fail")
                        is ChatEvent.AppCreated -> { /* M1 处理 */ }
                        is ChatEvent.InteractiveHtml -> { /* M1 处理 */ }
                        is ChatEvent.BusyWaiting -> _state.value = _state.value.copy(busyWaiting = true, busyMessage = event.message)
                        is ChatEvent.BackgroundProgress -> { /* M1 处理 */ }
                        is ChatEvent.Done -> {
                            done = true
                            // 本地 BYOK 无平台计费：显示 tokens 用量
                            finishStream(event.usage?.let { "${it.totalTokens} tokens" })
                        }
                        is ChatEvent.Error -> {
                            failStream("${event.code}: ${event.message}")
                        }
                        is ChatEvent.NoTask -> finishStream(null)
                        is ChatEvent.KeepAlive -> _state.value = _state.value.copy(connected = true)
                        else -> { /* 未知事件忽略 */ }
                    }
                }
            }.onFailure { e ->
                if (!done) failStream("本地 Agent 错误: ${e.message}")
            }
        }
    }

    private fun startStream(resume: Boolean) {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            val history = _state.value.messages
                .filter { it.role != "assistant" || it.content.isNotEmpty() }
                .map { ChatMessage(role = it.role, content = it.content) }
            val req = ChatStreamRequest(
                messages = history,
                thinking = thinkingLevel,
                conversationId = conversationId,
                resume = resume,
                lastUser = lastUserContent,
            )
            var resumeAttempt = 0
            var done = false

            repository.stream(req).collect { event ->
                when (event) {
                    is ChatEvent.Delta -> appendDelta(event.content)
                    is ChatEvent.Thinking -> appendThinking(event.content)
                    is ChatEvent.ToolStart -> updateLastToolChip(event.tool, "running")
                    is ChatEvent.ToolUpdate -> { /* M0-2 占位：忽略过程增量 */ }
                    is ChatEvent.ToolEnd -> updateLastToolChip(event.tool, if (event.ok) "ok" else "fail")
                    is ChatEvent.AppCreated -> { /* M0-3 处理 */ }
                    is ChatEvent.InteractiveHtml -> { /* M1 处理 */ }
                    is ChatEvent.BusyWaiting -> _state.value = _state.value.copy(busyWaiting = true, busyMessage = event.message)
                    is ChatEvent.BackgroundProgress -> { /* M1 处理 */ }
                    is ChatEvent.Done -> {
                        done = true
                        finishStream(event.usage?.let {
                            "¥${it.actualMinor / 100.0} · ${it.totalTokens} tokens" +
                                (it.remainingCredits?.let { r -> " · 余 $r 积分" } ?: "")
                        })
                    }
                    is ChatEvent.Error -> {
                        if (event.code == "SSE_DISCONNECTED" && !done) {
                            // 断线：自动 resume 一次（直接重建流，不经 resume() 的 streaming 守卫）
                            if (resumeAttempt < 1) {
                                resumeAttempt++
                                delay(800)
                                _state.value = _state.value.copy(error = null)
                                startStream(resume = true)
                                return@collect
                            }
                        }
                        failStream("${event.code}: ${event.message}")
                    }
                    is ChatEvent.NoTask -> finishStream(null)
                    is ChatEvent.KeepAlive -> _state.value = _state.value.copy(connected = true)
                    else -> { /* 未知事件忽略 */ }
                }
            }
            if (!done && streamJob?.isActive == true) {
                failStream("连接已断开")
            }
        }
    }

    private fun appendDelta(delta: String) {
        val msgs = _state.value.messages.toMutableList()
        val i = msgs.indexOfLast { it.role == "assistant" && it.streaming }
        if (i >= 0) msgs[i] = msgs[i].copy(content = msgs[i].content + delta)
        _state.value = _state.value.copy(messages = msgs, connected = true)
    }

    private fun appendThinking(delta: String) {
        val msgs = _state.value.messages.toMutableList()
        val i = msgs.indexOfLast { it.role == "assistant" && it.streaming }
        if (i >= 0) msgs[i] = msgs[i].copy(thinking = msgs[i].thinking + delta)
        _state.value = _state.value.copy(messages = msgs)
    }

    private fun updateLastToolChip(tool: String, state: String) {
        val msgs = _state.value.messages.toMutableList()
        val i = msgs.indexOfLast { it.role == "assistant" && it.streaming }
        if (i >= 0) {
            val chips = msgs[i].toolChips.toMutableList()
            val existing = chips.indexOfFirst { it.tool == tool }
            if (existing >= 0) chips[existing] = ToolChip(tool, state) else chips.add(ToolChip(tool, state))
            msgs[i] = msgs[i].copy(toolChips = chips)
        }
        _state.value = _state.value.copy(messages = msgs)
    }

    private fun finishStream(usage: String?) {
        markLastAssistantStreaming(false)
        _state.value = _state.value.copy(
            streaming = false,
            busyWaiting = false,
            connected = false,
            lastUsage = usage ?: _state.value.lastUsage,
            error = null,
        )
        streamJob = null
    }

    private fun failStream(message: String) {
        markLastAssistantStreaming(false)
        _state.value = _state.value.copy(
            streaming = false,
            busyWaiting = false,
            connected = false,
            error = message,
        )
        streamJob = null
    }

    private fun markLastAssistantStreaming(streaming: Boolean) {
        val msgs = _state.value.messages.toMutableList()
        val i = msgs.indexOfLast { it.role == "assistant" && it.streaming }
        if (i >= 0) msgs[i] = msgs[i].copy(streaming = streaming)
        _state.value = _state.value.copy(messages = msgs)
    }

    private fun nextId(): Long = ++messageId
}