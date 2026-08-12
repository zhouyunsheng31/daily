package com.livingdashboard.ui.browser

import android.graphics.Bitmap
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.ai.ActivePanelIdHolder
import com.livingdashboard.ai.ActiveWebViewHolder
import com.livingdashboard.ai.AgentEvent
import com.livingdashboard.ai.AgentMode
import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.CloudAgentService
import com.livingdashboard.ai.LocalAgentService
import com.livingdashboard.ai.RuntimeModeManager
import com.livingdashboard.ai.ThinkingLevel
import com.livingdashboard.browser.CookieManagerWrapper
import com.livingdashboard.browser.buildUrlFromInput
import com.livingdashboard.data.SearchEngine
import com.livingdashboard.data.entity.AiConversationEntity
import com.livingdashboard.data.entity.BookmarkEntity
import com.livingdashboard.data.entity.TabEntity
import com.livingdashboard.data.prefs.SettingsStore
import com.livingdashboard.data.prefs.UaMode
import com.livingdashboard.data.repository.AiConversationRepository
import com.livingdashboard.data.repository.BookmarkRepository
import com.livingdashboard.data.repository.HistoryRepository
import com.livingdashboard.data.repository.TabRepository
import com.livingdashboard.script.GmApiBridge
import com.livingdashboard.script.ScriptInjector
import com.livingdashboard.ui.canvas.UiChatMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 浏览器页 UI 状态（Spec 3.3.3）。
 *
 * @param tab 当前标签页实体（来自 Room）
 * @param currentUrl 当前页面 URL（WebView 回调更新）
 * @param currentTitle 当前页面标题（WebView 回调更新）
 * @param progress 加载进度（0-100，100=加载完成）
 * @param canGoBack WebView 是否可后退
 * @param canGoForward WebView 是否可前进
 * @param isBookmark 当前 URL 是否已收藏为书签
 * @param favicon 当前页面网站图标
 * @param tabCount 当前标签总数（BottomBar 徽章用）
 * @param errorMessage 错误信息（null=无错误）
 * @param searchEngine 当前搜索引擎（地址栏提交搜索词时用）
 * @param uaMode UA 模式（Bug-3 修复：由设置页驱动，不再硬编码）
 * @param javaScriptEnabled 是否启用 JavaScript（Bug-3 修复：由设置页驱动，不再硬编码）
 */
data class BrowserUiState(
    val tab: TabEntity? = null,
    val currentUrl: String = "",
    val currentTitle: String = "",
    val progress: Int = 100,
    val canGoBack: Boolean = false,
    val canGoForward: Boolean = false,
    val isBookmark: Boolean = false,
    val favicon: Bitmap? = null,
    val tabCount: Int = 0,
    val errorMessage: String? = null,
    val searchEngine: SearchEngine = SearchEngine.BAIDU,
    val uaMode: UaMode = UaMode.MOBILE,
    val javaScriptEnabled: Boolean = true
)

/**
 * 浏览器页 ViewModel（Spec 3.3.3 + 6.13 节 M3 AI 集成）。
 *
 * M3 新增（spec 6.13）：
 * - 注入 [LocalAgentService] / [CloudAgentService] / [RuntimeModeManager] /
 *   [AskUserDialogState] / [ActivePanelIdHolder] / [AiConversationRepository]
 * - 固定 [browserPanelId] = "browser_session" 与画布面板隔离
 * - init 从 Room 加载 browser_session 历史消息（m14 修复）
 * - [handleAgentEvent] 真实实现（m11 修复）
 * - [onCleared] 加 [disposeSession]（m14 修复）
 *
 * 注入：
 * - `TabRepository`：观察当前标签页 + 获取标签总数
 * - `HistoryRepository`：记录访问历史
 * - `BookmarkRepository`：判断当前 URL 是否已收藏
 * - `SettingsStore`：获取 UA 模式、JS 开关等设置
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@HiltViewModel
class BrowserViewModel @Inject constructor(
    private val tabRepository: TabRepository,
    private val historyRepository: HistoryRepository,
    private val bookmarkRepository: BookmarkRepository,
    private val settingsStore: SettingsStore,
    private val cookieManager: CookieManagerWrapper,
    private val savedStateHandle: SavedStateHandle,
    val activeWebViewHolder: ActiveWebViewHolder,
    // M3 6.13 新增：AI 相关依赖
    private val localAgentService: LocalAgentService,
    private val cloudAgentService: CloudAgentService,
    private val runtimeModeManager: RuntimeModeManager,
    val askUserDialogState: AskUserDialogState,
    private val activePanelIdHolder: ActivePanelIdHolder,
    private val aiConversationRepository: AiConversationRepository,
    // M4 新增（Spec 2.8 / v3 修复 M2 / v3 修复 N4）：脚本注入器 + GM API 桥接
    val scriptInjector: ScriptInjector,
    val gmApiBridge: GmApiBridge,
) : ViewModel() {

    /**
     * 从导航参数获取 tabId（AppNavGraph 中定义 composable("browser/{tabId}")）。
     */
    val tabId: String = checkNotNull(savedStateHandle.get<String>("tabId")) {
        "BrowserViewModel 缺少导航参数 tabId"
    }

    private val _uiState = MutableStateFlow(BrowserUiState())
    val uiState: StateFlow<BrowserUiState> = _uiState.asStateFlow()

    // ===== M3 6.13：AI 模式状态 =====

    private val _aiModeState = MutableStateFlow(BrowserAiModeState())
    val aiModeState: StateFlow<BrowserAiModeState> = _aiModeState.asStateFlow()

    private var agentJob: Job? = null

    /**
     * 浏览器 AI 对话固定 panelId（与画布面板隔离，spec 6.13）。
     *
     * 用固定 ID "browser_session" 确保：
     * - 浏览器 AI 对话与画布面板 AI 对话互不干扰（Session 隔离）
     * - App 重启后能从 Room 恢复 browser_session 的历史消息
     */
    private val browserPanelId: String = "browser_session"

    // 流式缓冲（与 CanvasHomeViewModel / AiWidgetViewModel 一致）
    private var pendingAssistantText = StringBuilder()
    private var pendingThinkingText = StringBuilder()

    init {
        // 用 combine 组合 5 个 Flow：tab + tabCount + searchEngine + uaMode + javaScriptEnabled
        viewModelScope.launch {
            combine(
                tabRepository.getById(tabId),
                tabRepository.getAll().map { tabs -> tabs.size },
                settingsStore.searchEngine,
                settingsStore.uaMode,
                settingsStore.javaScriptEnabled
            ) { tab, tabCount, engine, uaMode, jsEnabled ->
                _uiState.update { current ->
                    current.copy(
                        tab = tab,
                        currentUrl = if (current.currentUrl.isEmpty()) tab?.url ?: "" else current.currentUrl,
                        tabCount = tabCount,
                        searchEngine = engine,
                        uaMode = uaMode,
                        javaScriptEnabled = jsEnabled
                    )
                }
            }.collect { /* update 已在 transform 内完成 */ }
        }

        // m14：从 Room 加载 browser_session 历史消息
        viewModelScope.launch {
            aiConversationRepository.observeByPanel(browserPanelId).collect { entities ->
                // M2 同款守卫：仅当为空时才覆盖（避免双源更新冲突）
                if (_aiModeState.value.aiMessages.isEmpty()) {
                    _aiModeState.update { it.copy(aiMessages = entities.map { e -> e.toUiChatMessage() }) }
                }
            }
        }
    }

    // ===== 浏览器原有逻辑（保留不变） =====

    fun onUrlChange(newUrl: String) {
        _uiState.update { it.copy(currentUrl = newUrl) }
        viewModelScope.launch {
            val isBookmark = bookmarkRepository.findByUrl(newUrl) != null
            _uiState.update { it.copy(isBookmark = isBookmark) }
        }
        viewModelScope.launch {
            tabRepository.updateUrl(tabId, newUrl)
        }
    }

    fun onTitleChange(title: String) {
        _uiState.update { it.copy(currentTitle = title) }
        viewModelScope.launch {
            tabRepository.updateTitle(tabId, title)
            historyRepository.recordVisit(_uiState.value.currentUrl, title)
        }
    }

    fun onProgressChange(progress: Int) {
        _uiState.update { it.copy(progress = progress) }
    }

    fun onBackForwardStateChange(canGoBack: Boolean, canGoForward: Boolean) {
        _uiState.update { it.copy(canGoBack = canGoBack, canGoForward = canGoForward) }
    }

    fun onError(message: String) {
        _uiState.update { it.copy(errorMessage = message) }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun buildUrlFromInput(input: String): String {
        return buildUrlFromInput(input, _uiState.value.searchEngine)
    }

    fun addBookmark(url: String, title: String) {
        if (url.isEmpty()) return
        viewModelScope.launch {
            if (bookmarkRepository.findByUrl(url) != null) return@launch
            bookmarkRepository.insert(
                BookmarkEntity(
                    title = title.ifEmpty { url },
                    url = url
                )
            )
            _uiState.update { it.copy(isBookmark = true) }
        }
    }

    fun clearCookies() {
        cookieManager.removeAllCookies()
    }

    // ===== M3 6.13：AI 模式 API =====

    /** 上滑切换到 AI 输入框模式（spec 6.13） */
    fun expandAiMode() {
        _aiModeState.update { it.copy(aiMode = true, aiExpanded = true) }
    }

    /** 下滑切回按钮模式（spec 6.13），保留 aiWorking 状态 */
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
     * 流程与 CanvasHomeViewModel.onAiSend 一致，但用固定 [browserPanelId]。
     */
    fun onAiSend() {
        val message = _aiModeState.value.aiInputText.trim()
        if (message.isEmpty()) return
        _aiModeState.update { it.copy(aiInputText = "") }
        _aiModeState.update { it.copy(aiMessages = it.aiMessages + UiChatMessage("user", message)) }
        // M1 同款：cancel 前先 flush pending
        flushPendingMessages()
        agentJob?.cancel()
        agentJob = viewModelScope.launch {
            activePanelIdHolder.value.value = browserPanelId
            val service = pickService()
            service.sendMessage(browserPanelId, message, ThinkingLevel.STANDARD).collect { event ->
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
     * m11：真实实现 handleAgentEvent（参考 CanvasHomeViewModel）。
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
                        aiConversationRepository.appendMessage(browserPanelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                    }
                    if (pendingAssistantText.isNotEmpty()) {
                        aiConversationRepository.appendMessage(browserPanelId, "assistant", pendingAssistantText.toString(), turnIdx)
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
                    aiConversationRepository.appendMessage(browserPanelId, "error", "⚠ ${event.message}", turnIdx)
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
                aiConversationRepository.appendMessage(browserPanelId, "assistant_thinking", pendingThinkingText.toString(), turnIdx)
                pendingThinkingText = StringBuilder()
            }
            if (pendingAssistantText.isNotEmpty()) {
                aiConversationRepository.appendMessage(browserPanelId, "assistant", pendingAssistantText.toString(), turnIdx)
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
        val service = pickService()
        service.disposeSession(browserPanelId)
    }
}

/** AiConversationEntity → UiChatMessage 转换（spec 6.13，私有） */
private fun AiConversationEntity.toUiChatMessage(): UiChatMessage = UiChatMessage(
    role = role,
    content = content,
)
