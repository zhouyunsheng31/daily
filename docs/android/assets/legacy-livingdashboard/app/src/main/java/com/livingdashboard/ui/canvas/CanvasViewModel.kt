package com.livingdashboard.ui.canvas

import androidx.compose.ui.geometry.Offset
import androidx.lifecycle.SavedStateHandle
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
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.entity.WidgetPositionEntity
import com.livingdashboard.data.repository.AiConversationRepository
import com.livingdashboard.data.repository.CanvasRepository
import com.livingdashboard.data.entity.AiConversationEntity
import com.livingdashboard.ui.browser.BrowserAiModeState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 画布页 ViewModel，Spec 6.4 节。
 *
 * 职责：
 * - 持有当前画布变换（缩放 + 平移），由 CanvasScreen 双指手势更新
 * - 提供 observeWidgets(panelId) / observePositions(panelId) 数据流
 * - 处理组件位置移动（moveWidget）
 * - 处理组件状态变更（updateWidgetState）
 * - 处理收藏切换（toggleFavorite）
 * - 提供组件菜单状态（menuWidgetId，由 UI 监听弹出 ModalBottomSheet）
 *
 * NC5 修复：用 StateFlow 缓存收藏 widgetId 集合，避免主线程 runBlocking 查询。
 * NC12 修复：聚合面板 ID 通过 Flow 自动感知，不手动缓存。
 *
 * v4 #4：observeWidgets 修复聚合面板查询漏洞——聚合面板无自己的 widgets 记录，
 * 当 panelId == 聚合面板 ID 时走 observeAggregateWidgets()（JOIN widget_positions + widgets）。
 *
 * @param canvasRepository 画布 Repository（Hilt 注入）
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CanvasViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository,
    private val savedStateHandle: SavedStateHandle,
    // M3 6.13 新增：AI 相关依赖（与 BrowserViewModel 一致）
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,
) : ViewModel() {

    /**
     * 从导航参数获取 panelId（AppNavGraph 中定义 composable("canvas/{panelId}")）。
     * AI 消息发送到此 panelId（Session 隔离粒度）。
     *
     * 聚合面板路由 "aggregate" 无 panelId 参数，此处用空串兜底避免崩溃。
     * AggregatePanelScreen 会从 aggregatePanelId 获取真实 ID 后传给 CanvasScreen。
     */
    val panelId: String = savedStateHandle.get<String>("panelId") ?: ""

    /**
     * 有效面板 ID（用于 AI 消息发送等操作）。
     * 默认为 panelId，但聚合面板场景下会被 AggregatePanelScreen 覆盖为真实 ID。
     */
    private val _effectivePanelId = MutableStateFlow(panelId)
    val effectivePanelId: StateFlow<String> = _effectivePanelId.asStateFlow()

    fun updateEffectivePanelId(id: String) {
        if (id.isNotEmpty()) _effectivePanelId.value = id
    }

    /** 当前画布变换（缩放 + 平移），由 CanvasScreen 双指手势更新 */
    private val _transform = MutableStateFlow(CanvasTransform.INITIAL)
    val transform: StateFlow<CanvasTransform> = _transform.asStateFlow()

    /** NC5 修复：用 StateFlow 缓存收藏 widgetId 集合，避免主线程 runBlocking */
    private val _favoriteWidgetIds = MutableStateFlow<Set<String>>(emptySet())
    val favoriteWidgetIds: StateFlow<Set<String>> = _favoriteWidgetIds.asStateFlow()

    /** NC12 修复：聚合面板 ID（AggregatePanelScreen 用），通过 Flow 自动感知 */
    val aggregatePanelId: StateFlow<String?> = canvasRepository.observePanels()
        .map { panels -> panels.firstOrNull { it.type == PanelType.AGGREGATE }?.id }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    // ===== M3 6.13：AI 模式状态（与 BrowserViewModel 一致） =====

    private val _aiModeState = MutableStateFlow(BrowserAiModeState())
    val aiModeState: StateFlow<BrowserAiModeState> = _aiModeState.asStateFlow()

    private var agentJob: Job? = null

    // 流式缓冲（与 CanvasHomeViewModel / BrowserViewModel 一致）
    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()

    init {
        // NC5：启动时订阅 favorites 流，更新缓存
        viewModelScope.launch {
            canvasRepository.observeFavorites().collect { favorites ->
                _favoriteWidgetIds.value = favorites.map { it.widgetId }.toSet()
            }
        }
        // m14：从 Room 加载本面板历史 AI 消息（聚合面板场景下 effectivePanelId 会被更新）
        // 用 flatMapLatest 监听 effectivePanelId 变化，更新后自动重新订阅
        viewModelScope.launch {
            effectivePanelId.flatMapLatest { id ->
                if (id.isNotEmpty()) aiConversationRepository.observeByPanel(id) else emptyFlow()
            }.collect { entities ->
                // M2 同款守卫：仅当为空时才覆盖（避免双源更新冲突）
                if (_aiModeState.value.aiMessages.isEmpty()) {
                    _aiModeState.update { it.copy(aiMessages = entities.map { e -> e.toUiChatMessage() }) }
                }
            }
        }
    }

    /**
     * v4 #4：observeWidgets 修复聚合面板查询漏洞。
     *
     * 聚合面板在 widgets 表中没有自己的记录（不复制组件数据），
     * 直接调用 canvasRepository.observeWidgets(panelId) 会返回空列表。
     *
     * 修复：用 flatMapLatest 监听 aggregatePanelId 变化，当 panelId == 聚合面板 ID 时
     * 走 observeAggregateWidgets()（JOIN widget_positions + widgets），
     * 否则走普通 observeWidgets(panelId)。
     *
     * @param panelId 面板 ID
     * @return 组件列表 Flow
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeWidgets(panelId: String): Flow<List<WidgetEntity>> {
        return aggregatePanelId.flatMapLatest { aggId ->
            if (panelId == aggId) {
                canvasRepository.observeAggregateWidgets()
            } else {
                canvasRepository.observeWidgets(panelId)
            }
        }
    }

    /**
     * 观察面板下所有组件位置（按 zIndex 排序）。
     *
     * @param panelId 面板 ID
     * @return 位置列表 Flow
     */
    fun observePositions(panelId: String): Flow<List<WidgetPositionEntity>> =
        canvasRepository.observePositions(panelId)

    /**
     * 双指缩放/平移手势处理。
     *
     * 以手势中心点为缩放锚点，保证双指中心位置的画布坐标在缩放前后保持不变。
     *
     * @param centroid 手势中心点（屏幕坐标）
     * @param pan 平移增量（屏幕坐标）
     * @param zoom 缩放增量（乘法系数）
     */
    fun onCanvasGesture(centroid: Offset, pan: Offset, zoom: Float) {
        val current = _transform.value
        val newZoom = CanvasEngine.clampZoom(current.zoom * zoom)

        // 以手势中心点为缩放锚点
        val newX = centroid.x - (centroid.x - current.x) * (newZoom / current.zoom) + pan.x
        val newY = centroid.y - (centroid.y - current.y) * (newZoom / current.zoom) + pan.y

        _transform.value = CanvasTransform(x = newX, y = newY, zoom = newZoom)
    }

    /** 重置画布变换到初始状态 */
    fun resetTransform() {
        _transform.value = CanvasTransform.INITIAL
    }

    /** 缩放到指定级别（自动钳制到 [MIN_ZOOM, MAX_ZOOM]） */
    fun setZoom(zoom: Float) {
        val clamped = CanvasEngine.clampZoom(zoom)
        _transform.value = _transform.value.copy(zoom = clamped)
    }

    /**
     * v4 #13：T8 缩放按钮实现（底部栏缩小/放大按钮调用）。
     *
     * zoomOut：缩小到 0.7 倍，不低于 0.1。
     */
    fun zoomOut() {
        _transform.value = _transform.value.copy(
            zoom = (_transform.value.zoom * 0.8f).coerceIn(0.1f, 2.0f)
        )
    }

    /**
     * v4 #13：T8 缩放按钮实现。
     *
     * zoomIn：放大到 1.4 倍，不超过 2.0。
     */
    fun zoomIn() {
        _transform.value = _transform.value.copy(
            zoom = (_transform.value.zoom * 1.25f).coerceIn(0.1f, 2.0f)
        )
    }

    /**
     * 移动组件位置（拖拽结束提交，画布坐标增量）。
     *
     * @param panelId 面板 ID
     * @param widgetId 组件 ID
     * @param dx 画布坐标 X 增量
     * @param dy 画布坐标 Y 增量
     */
    fun moveWidget(panelId: String, widgetId: String, dx: Float, dy: Float) {
        viewModelScope.launch {
            val pos = canvasRepository.observePositions(panelId).first()
                .find { it.widgetId == widgetId }
            if (pos != null) {
                canvasRepository.updatePosition(panelId, widgetId, pos.x + dx, pos.y + dy)
            }
        }
    }

    /**
     * 持久化组件状态变更（同步到原面板，D7 真实引用）。
     *
     * @param widgetId 组件 ID
     * @param state 新状态
     */
    fun updateWidgetState(widgetId: String, state: Map<String, Any>) {
        viewModelScope.launch {
            canvasRepository.updateWidgetState(widgetId, state)
        }
    }

    /**
     * 切换收藏状态（v4 #1：D7 真实引用）。
     *
     * @param widgetId 组件 ID
     */
    fun toggleFavorite(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.toggleFavorite(widgetId)
        }
    }

    /**
     * NC5 修复：从 StateFlow 读取，非阻塞。
     *
     * @param widgetId 组件 ID
     * @return 是否已收藏
     */
    fun isFavorite(widgetId: String): Boolean = widgetId in _favoriteWidgetIds.value

    // ===== NC6/T10：组件菜单状态 =====

    /** 当前要弹出菜单的组件 ID（null 表示无菜单） */
    private val _menuWidgetId = MutableStateFlow<String?>(null)
    val menuWidgetId: StateFlow<String?> = _menuWidgetId.asStateFlow()

    /** 显示组件菜单（收藏/删除） */
    fun showWidgetMenu(widgetId: String) {
        _menuWidgetId.value = widgetId
    }

    /** 关闭组件菜单 */
    fun dismissWidgetMenu() {
        _menuWidgetId.value = null
    }

    /**
     * 删除组件（同时清理所有面板的位置 + 收藏记录）。
     *
     * @param widgetId 组件 ID
     */
    fun deleteWidget(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.deleteWidget(widgetId)
            _menuWidgetId.value = null
        }
    }

    /** 更新组件标题 */
    fun updateWidgetTitle(widgetId: String, title: String) {
        viewModelScope.launch {
            canvasRepository.updateWidgetTitle(widgetId, title)
            _menuWidgetId.value = null
        }
    }

    /** 更新组件尺寸 */
    fun updateWidgetSize(widgetId: String, size: WidgetSize) {
        viewModelScope.launch {
            canvasRepository.updateWidgetSize(widgetId, size.width, size.height)
            _menuWidgetId.value = null
        }
    }

    /** 复制组件（相同类型 + 相同内容，新标题加"(副本)"） */
    fun duplicateWidget(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.duplicateWidget(widgetId)
            _menuWidgetId.value = null
        }
    }

    // ===== M3 6.13：AI 模式 API（与 BrowserViewModel 一致，panelId 用本面板 ID） =====

    /** 左滑切换到 AI 输入框模式（spec 6.13） */
    fun expandAiMode() {
        _aiModeState.update { it.copy(aiMode = true, aiExpanded = true) }
    }

    /** 右滑切回按钮模式（spec 6.13），保留 aiWorking 状态 */
    fun collapseAiMode() {
        _aiModeState.update { it.copy(aiMode = false, aiExpanded = false) }
    }

    /** 收起 AI 对话浮层（保留 aiMode 状态由 BottomBar 控制） */
    fun collapseAi() {
        _aiModeState.update { it.copy(aiExpanded = false) }
    }

    /** 点击工作态 pill 展开对话面板（设计稿状态 3/3） */
    fun expandAiPanel() {
        _aiModeState.update { it.copy(aiExpanded = true) }
    }

    fun onAiInputTextChange(text: String) {
        _aiModeState.update { it.copy(aiInputText = text) }
    }

    /**
     * 发送 AI 消息（spec 6.13）。
     *
     * 流程与 BrowserViewModel.onAiSend 一致，但用本面板 [effectivePanelId]。
     */
    fun onAiSend() {
        val message = _aiModeState.value.aiInputText.trim()
        val currentPanelId = effectivePanelId.value
        if (message.isEmpty() || currentPanelId.isEmpty()) return
        _aiModeState.update { it.copy(aiInputText = "") }
        _aiModeState.update { it.copy(aiMessages = it.aiMessages + UiChatMessage("user", message)) }
        // M1 同款：cancel 前先 flush pending
        flushPendingMessages()
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            activePanelIdHolder.value.value = currentPanelId
            val service = pickService()
            service.sendMessage(currentPanelId, message, ThinkingLevel.STANDARD).collect { event ->
                handleAgentEvent(event)
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
     * m11：真实实现 handleAgentEvent（参考 BrowserViewModel / CanvasHomeViewModel）。
     */
    private fun handleAgentEvent(event: AgentEvent) {
        when (event) {
            is AgentEvent.TurnStart -> {
                pendingAssistantText = StringBuilder()
                pendingThinkingText = StringBuilder()
                // AI 工作态：开始处理
                _aiModeState.update { it.copy(aiWorking = true, aiWorkingStatusText = "AI 正在思考...") }
            }
            is AgentEvent.TextDelta -> {
                pendingAssistantText.append(event.text)
                _aiModeState.update { state ->
                    val msgs = state.aiMessages.toMutableList()
                    if (msgs.isNotEmpty() && msgs.last().role == "assistant") {
                        msgs[msgs.lastIndex] = msgs.last().copy(content = pendingAssistantText.toString())
                    } else {
                        msgs.add(UiChatMessage("assistant", pendingAssistantText.toString()))
                    }
                    state.copy(aiMessages = msgs)
                }
            }
            is AgentEvent.ThinkingDelta -> {
                pendingThinkingText.append(event.text)
                _aiModeState.update { state ->
                    val msgs = state.aiMessages.toMutableList()
                    if (msgs.isNotEmpty() && msgs.last().role == "assistant_thinking") {
                        msgs[msgs.lastIndex] = msgs.last().copy(content = pendingThinkingText.toString())
                    } else {
                        msgs.add(UiChatMessage("assistant_thinking", pendingThinkingText.toString()))
                    }
                    state.copy(aiMessages = msgs)
                }
            }
            is AgentEvent.ToolCallStart -> {
                _aiModeState.update { state ->
                    state.copy(
                        aiMessages = state.aiMessages + UiChatMessage("tool_call", "🔧 ${event.toolName}"),
                        aiWorking = true,
                        aiWorkingStatusText = "AI 正在使用 ${event.toolName}...",
                    )
                }
            }
            is AgentEvent.ToolCallEnd -> {
                val status = if (event.success) "✅ 完成" else "❌ 失败: ${event.result.take(100)}"
                _aiModeState.update { state ->
                    state.copy(aiMessages = state.aiMessages + UiChatMessage("tool_result", status))
                }
            }
            is AgentEvent.TurnEnd -> {
                // AI 工作态：结束
                _aiModeState.update { it.copy(aiWorking = false, aiWorkingStatusText = "") }
                // 批量持久化（m10：turnIndex 按用户消息计数）
                viewModelScope.launch {
                    val turnIdx = _aiModeState.value.aiMessages.count { it.role == "user" }
                    if (pendingThinkingText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(effectivePanelId.value, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(effectivePanelId.value, "assistant", pendingAssistantText.toString(), turnIdx)
                    }
                }
            }
            is AgentEvent.Error -> {
                // AI 工作态：错误时结束
                _aiModeState.update { state ->
                    state.copy(
                        aiMessages = state.aiMessages + UiChatMessage("error", "⚠ ${event.message}"),
                        aiWorking = false,
                        aiWorkingStatusText = "",
                    )
                }
                viewModelScope.launch {
                    val turnIdx = _aiModeState.value.aiMessages.count { it.role == "user" }
                    aiConversationRepository.appendMessage(effectivePanelId.value, "error", "⚠ ${event.message}", turnIdx)
                }
            }
        }
    }

    /**
     * M1 修复：把 pending 文本持久化到 DB（cancel 前调用）。
     */
    private fun flushPendingMessages() {
        if (pendingAssistantText.isEmpty() && pendingThinkingText.isEmpty()) return
        viewModelScope.launch {
            val turnIdx = _aiModeState.value.aiMessages.count { it.role == "user" }
            if (pendingThinkingText.isNotEmpty()) {
                aiConversationRepository.appendMessage(effectivePanelId.value, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                aiConversationRepository.appendMessage(effectivePanelId.value, "assistant", pendingAssistantText.toString(), turnIdx)
                pendingAssistantText = StringBuilder()
            }
        }
    }

    /**
     * m14：onCleared 时主动调 disposeSession（释放 LocalAgentService sessions + 服务器 session）。
     */
    override fun onCleared() {
        super.onCleared()
        agentJob?.cancel()
        if (effectivePanelId.value.isNotEmpty()) {
            val service = pickService()
            service.disposeSession(effectivePanelId.value)
        }
    }
}

/** AiConversationEntity → UiChatMessage 转换（spec 6.13，私有） */
private fun AiConversationEntity.toUiChatMessage(): UiChatMessage = UiChatMessage(
    role = role,
    content = content,
)

/**
 * 组件尺寸预设（菜单"调整大小"用）。
 *
 * - [SMALL]：小（200×150）
 * - [MEDIUM]：中（300×200，默认）
 * - [LARGE]：大（400×300）
 */
enum class WidgetSize(val width: Float, val height: Float) {
    SMALL(200f, 150f),
    MEDIUM(300f, 200f),
    LARGE(400f, 300f)
}
