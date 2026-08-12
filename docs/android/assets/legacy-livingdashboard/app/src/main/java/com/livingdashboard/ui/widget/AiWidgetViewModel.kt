package com.livingdashboard.ui.widget

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.ai.ActivePanelIdHolder
import com.livingdashboard.ai.AgentEvent
import com.livingdashboard.ai.AgentMode
import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.CloudAgentService
import com.livingdashboard.ai.LocalAgentService
import com.livingdashboard.ai.RuntimeModeManager
import com.livingdashboard.ai.ThinkingLevel
import com.livingdashboard.data.entity.AiConversationEntity
import com.livingdashboard.data.repository.AiConversationRepository
import com.livingdashboard.ui.canvas.UiChatMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * AIAssistantWidget 的 ViewModel（Spec 6.12 节）。
 *
 * 每个画布面板内的 AIAssistantWidget 实例独立持有一个 [AiWidgetViewModel]，
 * 通过 [initialize] 绑定 panelId 后与 [CanvasHomeViewModel] 共享同一 panelId 的
 * Agent session（LocalAgentService / CloudAgentService 按 panelId 隔离 Session）。
 *
 * 与 [com.livingdashboard.ui.canvas.CanvasHomeViewModel] 的区别：
 * - CanvasHomeViewModel 服务画布主页顶部 AI 输入框（单一 panelId = currentPanelId）
 * - AiWidgetViewModel 服务面板内嵌的 AI 助手组件（panelId 由 WidgetRenderParams 传入）
 *
 * 持久化（Spec 6.8）：
 * - [initialize] 时订阅 [AiConversationRepository.observeByPanel] 恢复历史消息
 * - [handleAgentEvent] 在 TurnEnd 批量写入 pending 文本（避免 TextDelta 多次 IO）
 * - [flushPendingMessages] 在 cancel 前 flush（M1 修复，避免连发消息丢失未完成回复）
 *
 * @param localAgentService 本地 Agent 服务（LOCAL 模式）
 * @param cloudAgentService 云端 Agent 服务（CLOUD 模式，M3 新增）
 * @param runtimeModeManager 运行时模式管理器（CLOUD/LOCAL/AUTO + 离线降级）
 * @param askUserDialogState AskUser Dialog 状态持有者（工具 ask_user 触发时弹 Dialog）
 * @param activePanelIdHolder 活跃面板 ID 持有者（供工具知道操作哪个面板）
 * @param aiConversationRepository AI 对话持久化 Repository
 */
@HiltViewModel
class AiWidgetViewModel @Inject constructor(
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,
) : ViewModel() {

    private val _uiMessages = MutableStateFlow<List<UiChatMessage>>(emptyList())
    val uiMessages: StateFlow<List<UiChatMessage>> = _uiMessages.asStateFlow()

    private val _inputText = MutableStateFlow("")
    val inputText: StateFlow<String> = _inputText.asStateFlow()

    private var agentJob: Job? = null
    private var currentPanelId: String? = null

    // 流式缓冲（与 CanvasHomeViewModel 一致）
    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()

    /**
     * 绑定 panelId 并订阅该面板的 AI 对话历史（Spec 6.12）。
     *
     * M2 修复：仅当 UI 消息列表为空时才用 entities 覆盖（避免双源更新冲突）。
     * 不主动清空 [_uiMessages]，让 Room flow 自然推送。
     *
     * @param panelId 所属面板 ID（来自 WidgetRenderParams.panelId）
     */
    fun initialize(panelId: String) {
        if (panelId.isEmpty()) return
        if (currentPanelId == panelId) return
        currentPanelId = panelId
        agentJob?.cancel()
        // M2 修复：仅当 UI 消息列表为空时才用 entities 覆盖（避免双源更新冲突）
        // 不主动清空 _uiMessages.value，让 Room flow 自然推送
        viewModelScope.launch {
            aiConversationRepository.observeByPanel(panelId).collect { entities ->
                // M2 守卫：仅当为空时才覆盖
                if (_uiMessages.value.isEmpty()) {
                    _uiMessages.value = entities.map { it.toUiChatMessage() }
                }
            }
        }
    }

    fun onInputTextChange(text: String) { _inputText.value = text }

    /**
     * 发送 AI 消息（Spec 6.12）。
     *
     * 流程与 [com.livingdashboard.ui.canvas.CanvasHomeViewModel.onAiSend] 一致，
     * 但 panelId 来自 [currentPanelId]（由 [initialize] 设置）。
     */
    fun onSend() {
        val message = _inputText.value.trim()
        Log.i("AiWidgetVM", "onSend called, inputText='${_inputText.value}', message='$message', panelId=$currentPanelId")
        if (message.isEmpty()) {
            Log.i("AiWidgetVM", "onSend: message is empty, returning early")
            return
        }
        _inputText.value = ""
        _uiMessages.update { it + UiChatMessage("user", message) }

        // M1 修复：cancel 前先 flush pending（与 CanvasHomeViewModel 一致）
        flushPendingMessages(currentPanelId)
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            val panelId = currentPanelId ?: return@launch
            activePanelIdHolder.value.value = panelId
            val service = pickService()
            service.sendMessage(panelId, message, ThinkingLevel.STANDARD).collect { event ->
                handleAgentEvent(event, panelId)
            }
        }
    }

    /**
     * m18：根据 effectiveMode 选 service（AUTO 已被 RuntimeModeManager 解析）。
     */
    private fun pickService() = when (runtimeModeManager.state.value.effectiveMode) {
        AgentMode.CLOUD -> cloudAgentService
        else -> localAgentService  // LOCAL + 兜底
    }

    /**
     * m12：真实实现 handleAgentEvent（参考 CanvasHomeViewModel）。
     *
     * 流式缓冲 pendingAssistantText / pendingThinkingText，TurnEnd 时批量持久化。
     */
    private fun handleAgentEvent(event: AgentEvent, panelId: String) {
        when (event) {
            is AgentEvent.TurnStart -> {
                pendingAssistantText = StringBuilder()
                pendingThinkingText = StringBuilder()
            }
            is AgentEvent.TextDelta -> {
                pendingAssistantText.append(event.text)
                _uiMessages.update { current ->
                    if (current.isNotEmpty() && current.last().role == "assistant") {
                        current.dropLast(1) + current.last().copy(content = pendingAssistantText.toString())
                    } else {
                        current + UiChatMessage("assistant", pendingAssistantText.toString())
                    }
                }
            }
            is AgentEvent.ThinkingDelta -> {
                pendingThinkingText.append(event.text)
                _uiMessages.update { current ->
                    if (current.isNotEmpty() && current.last().role == "assistant_thinking") {
                        current.dropLast(1) + current.last().copy(content = pendingThinkingText.toString())
                    } else {
                        current + UiChatMessage("assistant_thinking", pendingThinkingText.toString())
                    }
                }
            }
            is AgentEvent.ToolCallStart -> {
                _uiMessages.update { it + UiChatMessage("tool_call", "🔧 ${event.toolName}") }
            }
            is AgentEvent.ToolCallEnd -> {
                val status = if (event.success) "✅ 完成" else "❌ 失败: ${event.result.take(100)}"
                _uiMessages.update { it + UiChatMessage("tool_result", status) }
            }
            is AgentEvent.TurnEnd -> {
                // 批量持久化（m10：turnIndex 按用户消息计数）
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    if (pendingThinkingText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx)
                    }
                }
            }
            is AgentEvent.Error -> {
                _uiMessages.update { it + UiChatMessage("error", "⚠ ${event.message}") }
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    aiConversationRepository.appendMessage(panelId, "error", "⚠ ${event.message}", turnIdx)
                }
            }
        }
    }

    /**
     * M1 修复：把 pending 文本持久化到 DB（cancel 前调用）。
     */
    private fun flushPendingMessages(panelId: String?) {
        if (panelId == null) return
        if (pendingAssistantText.isEmpty() && pendingThinkingText.isEmpty()) return
        viewModelScope.launch {
            val turnIdx = _uiMessages.value.count { it.role == "user" }
            if (pendingThinkingText.isNotEmpty()) {
                aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx)
                pendingAssistantText = StringBuilder()
            }
        }
    }

    /**
     * m13：onCleared 时主动调 disposeSession（释放 LocalAgentService sessions + 服务器 session）。
     *
     * 注意：与 CanvasHomeViewModel 共享 session 时，重复 dispose 是幂等的
     *（ConcurrentHashMap.remove + 服务器 dispose_session 都是幂等）。
     */
    override fun onCleared() {
        super.onCleared()
        agentJob?.cancel()
        currentPanelId?.let { panelId ->
            val service = pickService()
            service.disposeSession(panelId)
        }
    }
}

/**
 * 把 [AiConversationEntity] 转为 [UiChatMessage]（Spec 6.12 / 6.18 共用）。
 *
 * tool_call / tool_result / error / assistant_thinking / assistant / user 全部映射为
 * UiChatMessage，UI 层按 role 分发渲染。
 */
private fun AiConversationEntity.toUiChatMessage(): UiChatMessage = UiChatMessage(
    role = role,
    content = content,
)
