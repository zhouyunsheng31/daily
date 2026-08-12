package com.livingdashboard.ai

import com.livingdashboard.sync.WsClient
import com.livingdashboard.sync.WsState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn

enum class AgentMode(val label: String) {
    CLOUD("云端"),    // 服务器 Pi Agent（M3 未实现，占位）
    LOCAL("本地"),    // 单机轻 Agent（M8）
    AUTO("自动"),     // 在线用云端，离线降级到本地
}

data class RuntimeModeState(
    val mode: AgentMode,
    val isServerOnline: Boolean,    // WsClient.state == CONNECTED
    val effectiveMode: AgentMode,   // 实际生效的模式（AUTO 时根据在线状态计算）
    val isOfflineDowngraded: Boolean,  // 是否触发了离线降级
)

class RuntimeModeManager(
    private val wsClient: WsClient,  // 已有，提供 state: StateFlow<WsState>
    private val coroutineScope: CoroutineScope,  // 由 Application 注入 @Singleton CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
) {
    private val _selectedMode = MutableStateFlow(AgentMode.LOCAL)
    val selectedMode: StateFlow<AgentMode> = _selectedMode.asStateFlow()

    /** 实际运行时状态（AUTO 模式自动降级） */
    val state: StateFlow<RuntimeModeState> = combine(
        _selectedMode,
        // 防 WS 状态抖动：WS 弱网时频繁在线/离线切换会导致 UI 抖动，加 2 秒 debounce 确保稳定后再切换 effectiveMode
        wsClient.state.debounce(2000),
    ) { mode, wsState ->
        val isOnline = wsState == WsState.CONNECTED
        val effective = when (mode) {
            AgentMode.CLOUD -> if (isOnline) AgentMode.CLOUD else AgentMode.LOCAL  // 云端不可用降级
            AgentMode.LOCAL -> AgentMode.LOCAL
            AgentMode.AUTO -> if (isOnline) AgentMode.CLOUD else AgentMode.LOCAL
        }
        RuntimeModeState(
            mode = mode,
            isServerOnline = isOnline,
            effectiveMode = effective,
            isOfflineDowngraded = (mode == AgentMode.CLOUD || mode == AgentMode.AUTO) && !isOnline,
        )
    }.stateIn(coroutineScope, SharingStarted.Eagerly, RuntimeModeState(AgentMode.LOCAL, false, AgentMode.LOCAL, false))

    fun setMode(mode: AgentMode) { _selectedMode.value = mode }
}
