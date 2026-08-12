package com.livingdashboard.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.browser.CookieManagerWrapper
import com.livingdashboard.data.SearchEngine
import com.livingdashboard.data.prefs.SettingsStore
import com.livingdashboard.data.prefs.UaMode
import com.livingdashboard.data.repository.BookmarkRepository
import com.livingdashboard.data.repository.HistoryRepository
import com.livingdashboard.sync.DeviceAuth
import com.livingdashboard.sync.ServerConfig
import com.livingdashboard.sync.ServerMessage
import com.livingdashboard.sync.WsClient
import com.livingdashboard.sync.WsState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 设置页 ViewModel（Spec 3.3.9 节，NC1 修复）。
 *
 * 注入：
 * - `SettingsStore`：读写设置项（主题色、搜索引擎、UA、JS、背景图、Logo、显示常用网站）
 * - `WsClient`：获取 WS 连接状态 + 收集最近消息（调试信息分组）
 * - `DeviceAuth`：获取设备 ID（调试信息分组）
 * - `ServerConfig`：获取服务器地址（调试信息分组）
 * - `CookieManagerWrapper`：清除 Cookie（数据管理分组）
 * - `HistoryRepository`：清除历史（数据管理分组）
 * - `BookmarkRepository`：清除书签（数据管理分组）
 *
 * NC1 修复：使用 M0 真实 API：
 * - `wsClient.state`（不是 connectionState）
 * - `wsClient.messages`（SharedFlow<ServerMessage>）
 * - `deviceAuth.getDeviceId()`
 * - `serverConfig.getDisplayUrl()`
 * - `wsClient.disconnect() + connect()`（没有 reconnect）
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsStore: SettingsStore,
    private val wsClient: WsClient,
    private val deviceAuth: DeviceAuth,
    private val serverConfig: ServerConfig,
    private val cookieManagerWrapper: CookieManagerWrapper,
    private val historyRepository: HistoryRepository,
    private val bookmarkRepository: BookmarkRepository
) : ViewModel() {

    // ===== 设置项 Flow（转成 StateFlow 供 Composable 订阅） =====

    /** 主题色索引（-1=跟随系统 dynamicColor，0..5=预设主题色） */
    val themeColorIndex: StateFlow<Int> = settingsStore.themeColorIndex
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), -1)

    /** 搜索引擎 */
    val searchEngine: StateFlow<SearchEngine> = settingsStore.searchEngine
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchEngine.BAIDU)

    /** UA 模式 */
    val uaMode: StateFlow<UaMode> = settingsStore.uaMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UaMode.MOBILE)

    /** 是否启用 JavaScript */
    val javaScriptEnabled: StateFlow<Boolean> = settingsStore.javaScriptEnabled
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    /** 是否显示常用网站 */
    val showHomeShortcuts: StateFlow<Boolean> = settingsStore.showHomeShortcuts
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    /** 主页背景图 URI（null=无背景） */
    val backgroundUri: StateFlow<String?> = settingsStore.homeBackgroundUri
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 主页 Logo URI（null=用默认 ic_logo） */
    val logoUri: StateFlow<String?> = settingsStore.homeLogoUri
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** 是否启用全允许模式（所有工具调用自动执行，不询问） */
    val allowAllTools: StateFlow<Boolean> = settingsStore.allowAllTools
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    // ===== 调试信息（M0 WS 信息迁移到此，C4） =====

    /** WS 连接状态（直接暴露 M0 的 WsState） */
    val wsConnectionState: StateFlow<WsState> = wsClient.state

    /** 设备 ID（DeviceAuth.getDeviceId() 是同步函数，首次会生成并持久化） */
    val deviceId: String = deviceAuth.getDeviceId()

    /** 服务器地址（ServerConfig.getDisplayUrl() 返回 BuildConfig.WS_URL） */
    val serverUrl: String = serverConfig.getDisplayUrl()

    /**
     * 最近 WS 消息（保留最近 20 条用于调试）。
     *
     * M0 的 messages 是 SharedFlow<ServerMessage>（无 replay），
     * 在 ViewModel 中转成可读字符串列表。
     */
    private val _recentMessages = MutableStateFlow<List<String>>(emptyList())
    val recentMessages: StateFlow<List<String>> = _recentMessages.asStateFlow()

    init {
        // 收集 SharedFlow，把 ServerMessage 转成可读字符串
        viewModelScope.launch {
            wsClient.messages.collect { msg ->
                val readable = formatServerMessage(msg)
                _recentMessages.update { current ->
                    (current + readable).takeLast(20)
                }
            }
        }
    }

    /**
     * 把 ServerMessage 转成可读字符串（调试用）。
     *
     * 与 M0 HomeScreen 的 messageKind + messageSummary 保持一致的可读性。
     */
    private fun formatServerMessage(msg: ServerMessage): String {
        return when (msg) {
            is ServerMessage.ToolCall -> "ToolCall(tool=${msg.tool}, requestId=${msg.requestId})" +
                (msg.targetDeviceId?.let { ", target=$it" } ?: "")
            is ServerMessage.PiEvent -> "PiEvent(event=${msg.event})"
            is ServerMessage.SessionReady -> "SessionReady(sessionId=${msg.sessionId})"
            is ServerMessage.Error -> "Error(message=${msg.message})"
            is ServerMessage.Pong -> "Pong"
            is ServerMessage.Change -> "Change(type=${msg.changeType})" +
                (msg.sourceDeviceId?.let { ", source=$it" } ?: "")
            is ServerMessage.AskUser -> "AskUser(requestId=${msg.requestId}, prompt=${msg.prompt})"
        }
    }

    // ===== 设置项 setter（suspend，供 Composable 在协程中调用） =====

    suspend fun setThemeColor(index: Int) = settingsStore.setThemeColor(index)
    suspend fun setSearchEngine(engine: SearchEngine) = settingsStore.setSearchEngine(engine)
    suspend fun setUaMode(mode: UaMode) = settingsStore.setUaMode(mode)
    suspend fun setJsEnabled(enabled: Boolean) = settingsStore.setJavaScriptEnabled(enabled)
    suspend fun setShowHomeShortcuts(show: Boolean) = settingsStore.setShowHomeShortcuts(show)
    suspend fun setBackgroundUri(uri: String?) = settingsStore.setHomeBackgroundUri(uri)
    suspend fun setLogoUri(uri: String?) = settingsStore.setHomeLogoUri(uri)
    suspend fun setAllowAllTools(enabled: Boolean) = settingsStore.setAllowAllTools(enabled)

    // ===== 数据管理操作 =====

    /**
     * 重新连接 WS。
     *
     * M0 的 WsClient 没有 reconnect() 方法，用 disconnect() + connect() 组合实现。
     * disconnect() 会调用 scope.cancel()，connect() 内部会重建 scope（见 WsClient.kt L69-71）。
     * delay 100ms 给 disconnect 完成时间。
     */
    suspend fun reconnectWs() {
        wsClient.disconnect()
        delay(100)
        wsClient.connect()
    }

    /** 清除所有 Cookie */
    suspend fun clearCookies() {
        cookieManagerWrapper.removeAllCookies()
    }

    /** 清空所有历史记录 */
    suspend fun clearHistory() {
        historyRepository.deleteAll()
    }

    /**
     * 清空所有书签。
     *
     * 注意：BookmarkRepository 没有 deleteAll 方法（Spec 3.1.5 未提供），
     * 用 getAll().first() 获取当前所有书签后逐个删除。
     */
    suspend fun clearBookmarks() {
        val bookmarks = bookmarkRepository.getAll().first()
        bookmarks.forEach { bookmarkRepository.delete(it) }
    }
}
