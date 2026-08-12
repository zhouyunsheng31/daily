package com.livingdashboard.ui.canvas

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.AgentEvent
import com.livingdashboard.ai.AgentMode
import com.livingdashboard.ai.CloudAgentService
import com.livingdashboard.ai.LocalAgentService
import com.livingdashboard.ai.RuntimeModeManager
import com.livingdashboard.ai.RuntimeModeState
import com.livingdashboard.ai.ThinkingLevel
import com.livingdashboard.ai.ToolCall
import com.livingdashboard.ai.ActivePanelIdHolder
import com.livingdashboard.data.entity.AiConversationEntity
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.data.repository.AiConversationRepository
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 收藏组件数据项（Spec 6.2）。
 */
data class FavoriteItem(
    val widgetId: String,
    val name: String,
    val iconRes: Int,
    val type: WidgetType
)

/**
 * UI 聊天消息（Spec 6.11.2 节，替代 M2 占位的 AiPlaceholderMessage）。
 *
 * role 取值：
 * - "user"：用户消息
 * - "assistant"：AI 文本回复（流式累积）
 * - "assistant_thinking"：AI 思考链（折叠显示）
 * - "tool_call"：工具调用开始
 * - "tool_result"：工具调用结果
 * - "error"：错误信息
 *
 * @param role 消息角色
 * @param content 消息内容
 * @param isComplete 是否完成（false=流式累积中，UI 显示加载态）
 */
data class UiChatMessage(
    val role: String,
    val content: String,
    val isComplete: Boolean = true,
)

/**
 * 画布主页 ViewModel，Spec 6.2 + 6.11.2 + 6.18 节。
 *
 * M3 改动（spec 6.18）：
 * - 注入 [CloudAgentService] + [AiConversationRepository]
 * - init 用 flatMapLatest 订阅 observeByPanel（M3 修复：避免内层 collect 不取消）
 * - onAiSend 用 effectiveMode 路由 CLOUD/LOCAL（m18 修复：删除 AUTO 分支）
 * - cancel 前先 flushPendingMessages（M1 修复：避免 pending 丢失）
 * - handleAgentEvent 流式缓冲 + TurnEnd 批量持久化
 * - turnIndex 按用户消息计数（m10 修复）
 *
 * @param canvasRepository 画布 Repository（Hilt 注入）
 * @param localAgentService 本地 Agent 服务（LOCAL 模式）
 * @param cloudAgentService 云端 Agent 服务（CLOUD 模式，M3 新增）
 * @param runtimeModeManager 运行时模式管理器（CLOUD/LOCAL/AUTO + 离线降级）
 * @param askUserDialogState AskUser Dialog 状态持有者
 * @param activePanelIdHolder 活跃面板 ID 持有者
 * @param aiConversationRepository AI 对话持久化 Repository（M3 新增）
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CanvasHomeViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository,
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,
) : ViewModel() {

    /** AI 输入框文本 */
    private val _aiInputText = MutableStateFlow("")
    val aiInputText: StateFlow<String> = _aiInputText.asStateFlow()

    /** v4 #10：AI 输入框展开状态 */
    private val _aiExpanded = MutableStateFlow(false)
    val aiExpanded: StateFlow<Boolean> = _aiExpanded.asStateFlow()

    /** UI 消息列表 */
    private val _uiMessages = MutableStateFlow<List<UiChatMessage>>(emptyList())
    val uiMessages: StateFlow<List<UiChatMessage>> = _uiMessages.asStateFlow()

    /** 当前思考等级 */
    private val _currentThinkingLevel = MutableStateFlow(ThinkingLevel.STANDARD)
    val currentThinkingLevel: StateFlow<ThinkingLevel> = _currentThinkingLevel.asStateFlow()

    /** 当前选中的 Agent 模式 */
    val currentAgentMode: StateFlow<AgentMode> = runtimeModeManager.selectedMode

    /** 运行时模式完整状态（含 effectiveMode + isOfflineDowngraded） */
    val runtimeMode: StateFlow<RuntimeModeState> = runtimeModeManager.state

    /** agent 循环 Job */
    private var agentJob: Job? = null

    /**
     * 流式缓冲（spec 6.18）：
     * - pendingAssistantText：AI 文本回复累积
     * - pendingThinkingText：AI 思考链累积
     * - pendingToolCalls：工具调用记录（ToolCall），TurnEnd 时持久化到 assistant 消息 args 字段
     */
    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()
    private var pendingToolCalls = mutableListOf<ToolCall>()

    /**
     * NC9 修复：当前面板 ID，供 onEnterCanvas 导航用 + onAiSend 取 panelId。
     */
    val currentPanelId: StateFlow<String?> = canvasRepository.observePanels()
        .map { panels ->
            panels.firstOrNull { it.type != PanelType.AGGREGATE }?.id
                ?: panels.firstOrNull()?.id
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /**
     * M3 修复（spec 6.18）：用 flatMapLatest 替代嵌套 collect，避免内层 collect 不取消
     * 导致 N 个 collector 并发写 _uiMessages。
     *
     * 当 currentPanelId 变化时，自动取消上一个 panelId 的 observeByPanel 订阅，
     * 切换到新 panelId 的订阅。
     */
    init {
        viewModelScope.launch {
            currentPanelId.filterNotNull().flatMapLatest { panelId ->
                aiConversationRepository.observeByPanel(panelId)
            }.collect { entities ->
                // M2 同款守卫：仅当 UI 消息列表为空时才覆盖（避免双源更新冲突）
                if (_uiMessages.value.isEmpty()) {
                    _uiMessages.value = entities.map { it.toUiChatMessage() }
                }
            }
        }
    }

    /** 收藏组件列表 */
    val favorites: StateFlow<List<FavoriteItem>> = canvasRepository.observeFavorites()
        .combine(canvasRepository.observeAggregateWidgets()) { favEntries, widgets ->
            favEntries.mapNotNull { entry ->
                val widget = widgets.find { it.id == entry.widgetId }
                if (widget != null) {
                    FavoriteItem(
                        widgetId = widget.id,
                        name = widgetDisplayName(widget.type),
                        iconRes = widgetIconRes(widget.type),
                        type = widget.type
                    )
                } else null
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun onAiInputTextChange(text: String) {
        _aiInputText.value = text
    }

    fun expandAi() {
        _aiExpanded.value = true
    }

    fun collapseAi() {
        _aiExpanded.value = false
    }

    fun onThinkingLevelChange(level: ThinkingLevel) {
        _currentThinkingLevel.value = level
    }

    fun onAgentModeChange(mode: AgentMode) {
        runtimeModeManager.setMode(mode)
    }

    /**
     * M3：发送 AI 消息（Spec 6.18 节）。
     *
     * 流程：
     * 1. 取输入文本（trim），空则跳过
     * 2. 清空输入框 + 追加用户消息到 UI
     * 3. 持久化用户消息到 Room
     * 4. M1 修复：cancel 前先 flushPendingMessages（避免 pending 丢失）
     * 5. 取消上一个 agent Job
     * 6. 设置 activePanelIdHolder.value = panelId
     * 7. m18：根据 effectiveMode 路由 CLOUD/LOCAL（AUTO 已被 RuntimeModeManager 解析）
     * 8. service.sendMessage.collect { handleAgentEvent(event, panelId) }
     */
    fun onAiSend() {
        Log.i("CanvasHomeVM", "onAiSend called, inputText='${_aiInputText.value}', panelId=${currentPanelId.value}")
        val message = _aiInputText.value.trim()
        if (message.isEmpty()) {
            Log.i("CanvasHomeVM", "onAiSend: message is empty, returning early")
            return
        }
        Log.i("CanvasHomeVM", "onAiSend: sending message=$message, panelId=${currentPanelId.value}")
        _aiInputText.value = ""
        _uiMessages.update { it + UiChatMessage(role = "user", content = message) }

        // m10：turnIndex 按用户消息计数
        val turnIdx = _uiMessages.value.count { it.role == "user" }

        // 持久化用户消息
        viewModelScope.launch {
            aiConversationRepository.appendMessage(
                panelId = currentPanelId.value ?: return@launch,
                role = "user",
                content = message,
                turnIndex = turnIdx,
            )
        }

        // M1 修复：cancel 前先 flush pending（避免 pendingAssistantText/pendingThinkingText 丢失）
        flushPendingMessages(currentPanelId.value)

        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            val panelId = currentPanelId.value ?: run {
                Log.e("CanvasHomeVM", "onAiSend: currentPanelId is null!")
                _uiMessages.update { it + UiChatMessage(role = "error", content = "⚠ 无可用面板") }
                return@launch
            }
            activePanelIdHolder.value.value = panelId

            // m18：删除 AUTO 分支（effectiveMode 已解析）
            val service = when (runtimeModeManager.state.value.effectiveMode) {
                AgentMode.CLOUD -> cloudAgentService
                else -> localAgentService  // LOCAL + 兜底
            }
            Log.i("CanvasHomeVM", "onAiSend: effectiveMode=${runtimeModeManager.state.value.effectiveMode}, service=${service::class.simpleName}")

            service.sendMessage(panelId, message, _currentThinkingLevel.value).collect { event ->
                handleAgentEvent(event, panelId)
            }
        }
    }

    /**
     * 处理 AgentEvent（spec 6.18）：流式缓冲 + TurnEnd 批量持久化。
     */
    private fun handleAgentEvent(event: AgentEvent, panelId: String) {
        when (event) {
            is AgentEvent.TurnStart -> {
                pendingAssistantText = StringBuilder()
                pendingThinkingText = StringBuilder()
                pendingToolCalls.clear()
            }
            is AgentEvent.TextDelta -> {
                pendingAssistantText.append(event.text)
                _uiMessages.update { msgs ->
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant") {
                        msgs.dropLast(1) + last.copy(content = pendingAssistantText.toString(), isComplete = false)
                    } else {
                        msgs + UiChatMessage(role = "assistant", content = pendingAssistantText.toString(), isComplete = false)
                    }
                }
            }
            is AgentEvent.ThinkingDelta -> {
                pendingThinkingText.append(event.text)
                _uiMessages.update { msgs ->
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant_thinking") {
                        msgs.dropLast(1) + last.copy(content = pendingThinkingText.toString())
                    } else {
                        msgs + UiChatMessage(role = "assistant_thinking", content = pendingThinkingText.toString())
                    }
                }
            }
            is AgentEvent.ToolCallStart -> {
                pendingToolCalls.add(ToolCall(id = event.callId, name = event.toolName, arguments = event.args.toString()))
                _uiMessages.update {
                    it + UiChatMessage(role = "tool_call", content = "🔧 ${event.toolName}", isComplete = true)
                }
            }
            is AgentEvent.ToolCallEnd -> {
                val content = if (event.success) "✅ 完成" else "❌ 失败: ${event.result.take(100)}"
                _uiMessages.update {
                    it + UiChatMessage(role = "tool_result", content = content, isComplete = true)
                }
            }
            is AgentEvent.TurnEnd -> {
                // 标记最后一条 assistant 消息 isComplete=true
                _uiMessages.update { msgs ->
                    val last = msgs.lastOrNull()
                    if (last?.role == "assistant" && !last.isComplete) {
                        msgs.dropLast(1) + last.copy(isComplete = true)
                    } else msgs
                }
                // 批量持久化（m10：turnIndex 按用户消息计数）
                viewModelScope.launch {
                    val turnIdx = _uiMessages.value.count { it.role == "user" }
                    if (pendingThinkingText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        // C6 修复：持久化 assistant 消息时把 pendingToolCalls 序列化后传给 args
                        val toolCallsArgs = aiConversationRepository.serializeToolCalls(pendingToolCalls)
                        aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx, args = toolCallsArgs)
                    }
                    pendingToolCalls.forEach { tc ->
                        aiConversationRepository.appendMessage(panelId, "tool_call", "🔧 ${tc.name}", turnIdx, toolCallId = tc.id, toolName = tc.name)
                    }
                }
            }
            is AgentEvent.Error -> {
                _uiMessages.update {
                    it + UiChatMessage(role = "error", content = "⚠ ${event.message}", isComplete = true)
                }
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
        if (pendingAssistantText.isEmpty() && pendingThinkingText.isEmpty() && pendingToolCalls.isEmpty()) return
        viewModelScope.launch {
            val turnIdx = _uiMessages.value.count { it.role == "user" }
            if (pendingThinkingText.isNotEmpty()) {
                aiConversationRepository.appendMessage(panelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                // C6 修复：flush 时同样把 pendingToolCalls 序列化后传给 args
                val toolCallsArgs = aiConversationRepository.serializeToolCalls(pendingToolCalls)
                aiConversationRepository.appendMessage(panelId, "assistant", pendingAssistantText.toString(), turnIdx, args = toolCallsArgs)
                pendingAssistantText = StringBuilder()
            }
            pendingToolCalls.forEach { tc ->
                aiConversationRepository.appendMessage(panelId, "tool_call", "🔧 ${tc.name}", turnIdx, toolCallId = tc.id, toolName = tc.name)
            }
            pendingToolCalls.clear()
        }
    }

    /**
     * 面板删除时调 disposeSession 释放资源。
     */
    fun onPanelDeleted(panelId: String) {
        if (currentPanelId.value == panelId) {
            agentJob?.cancel()
        }
        // M3：按当前模式选 service dispose
        val service = when (runtimeModeManager.state.value.effectiveMode) {
            AgentMode.CLOUD -> cloudAgentService
            else -> localAgentService
        }
        service.disposeSession(panelId)
        if (activePanelIdHolder.value.value == panelId) {
            activePanelIdHolder.value.value = null
        }
    }

    /**
     * M3：ViewModel 销毁时释放当前面板的 agent Session（spec 6.18）。
     *
     * 加 flushPendingMessages（M1 修复）+ pickService().disposeSession。
     */
    override fun onCleared() {
        super.onCleared()
        flushPendingMessages(currentPanelId.value)
        agentJob?.cancel()
        currentPanelId.value?.let { panelId ->
            val service = when (runtimeModeManager.state.value.effectiveMode) {
                AgentMode.CLOUD -> cloudAgentService
                else -> localAgentService
            }
            service.disposeSession(panelId)
        }
    }

    /**
     * v4 #3 / v5 #3：CanvasHomeScreen 长按收藏组件取消收藏。
     */
    fun toggleFavorite(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.toggleFavorite(widgetId)
        }
    }

    /**
     * 添加组件：在当前面板创建 widget + widget_position 记录，并自动收藏
     * 使其立即显示在主页收藏网格中。
     *
     * @param type 组件类型
     */
    fun addWidget(type: WidgetType) {
        viewModelScope.launch {
            val panelId = currentPanelId.value ?: return@launch
            val title = widgetDisplayName(type)
            val widget = canvasRepository.createWidget(
                panelId = panelId,
                type = type,
                state = defaultStateForType(type),
                width = 300f,
                height = 200f,
                title = title
            )
            canvasRepository.updatePosition(panelId, widget.id, 100f, 100f)
            // 自动收藏：新组件立即出现在主页收藏网格
            canvasRepository.toggleFavorite(widget.id)
        }
    }

    private fun defaultStateForType(type: WidgetType): Map<String, Any> = when (type) {
        WidgetType.WEBVIEW -> mapOf("url" to "")
        WidgetType.HTML_CANVAS -> mapOf(
            "html" to "<div style='padding:16px;font-family:sans-serif;color:#999;'>HTML 画布组件 - 等待 AI 写入内容</div>",
            "title" to widgetDisplayName(type),
            "createdAt" to System.currentTimeMillis()
        )
        WidgetType.FREE_HTML -> mapOf("html" to "")
        else -> emptyMap()
    }

    // ===== Widget 元数据辅助函数 =====

    private fun widgetDisplayName(type: WidgetType): String = when (type) {
        WidgetType.AI_ASSISTANT -> "AI 助手"
        WidgetType.WEBVIEW -> "网页"
        WidgetType.CALCULATOR -> "计算器"
        WidgetType.FOCUS_TIMER -> "专注计时"
        WidgetType.HTML_CANVAS -> "HTML 画布"
        WidgetType.FREE_HTML -> "自由 HTML"
    }

    private fun widgetIconRes(type: WidgetType): Int = when (type) {
        WidgetType.AI_ASSISTANT -> android.R.drawable.ic_menu_help
        WidgetType.WEBVIEW -> android.R.drawable.ic_menu_view
        WidgetType.CALCULATOR -> android.R.drawable.ic_menu_sort_by_size
        WidgetType.FOCUS_TIMER -> android.R.drawable.ic_menu_recent_history
        WidgetType.HTML_CANVAS -> android.R.drawable.ic_menu_edit
        WidgetType.FREE_HTML -> android.R.drawable.ic_menu_gallery
    }
}

/** AiConversationEntity → UiChatMessage 转换（spec 6.18，私有） */
private fun AiConversationEntity.toUiChatMessage(): UiChatMessage = UiChatMessage(
    role = role,
    content = content,
)
