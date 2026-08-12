package com.livingdashboard.ai

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.channels.BufferOverflow
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 按 panelId 路由 AgentEvent 流（Spec 6.1 节）。
 *
 * 维护 `Map<panelId, MutableSharedFlow<AgentEvent>>`：
 * - UI 按面板订阅 [getOrCreate] 返回的事件流
 * - CLOUD 模式下 [WsToolCallDispatcher] 和 [CloudAgentService] 通过 [dispatch] 按面板派发事件
 *
 * 实现要点：
 * - [MutableSharedFlow] 配置 `extraBufferCapacity = 64, onBufferOverflow = DROP_OLDEST`
 * - SharedFlow 无 replay，新订阅者收不到历史事件
 * - [dispatch] 用 `tryEmit`，避免阻塞
 * - [dispose] 从 map 移除 flow
 * - 线程安全：[ConcurrentHashMap]
 *
 * Hilt 注入：@Singleton（持有 panelId → SharedFlow 状态，App 级共享）。
 *
 * UI 订阅方式（m9 修复）：SharedFlow 不能直接 `collectAsStateWithLifecycle()` 不传 initialValue。
 * ViewModel 应自行 collect 并维护 `_uiMessages: StateFlow<List<UiChatMessage>>`，UI 订阅 StateFlow。
 */
@Singleton
class PanelEventRouter @Inject constructor() {
    private val flows = ConcurrentHashMap<String, MutableSharedFlow<AgentEvent>>()

    /**
     * 获取或创建指定面板的事件流（UI 订阅）。
     *
     * 返回 SharedFlow 的只读视图（[Flow]<[AgentEvent]>），新订阅者无 replay。
     */
    fun getOrCreate(panelId: String): Flow<AgentEvent> =
        getOrCreateFlow(panelId).asSharedFlow()

    /** 派发事件到指定面板的所有订阅者（用 tryEmit 避免阻塞） */
    fun dispatch(panelId: String, event: AgentEvent) {
        getOrCreateFlow(panelId).tryEmit(event)
    }

    /** 清理指定面板的事件流（面板删除时调） */
    fun dispose(panelId: String) {
        flows.remove(panelId)
    }

    /** 列出所有活跃面板 ID */
    fun activePanelIds(): Set<String> = flows.keys.toSet()

    /** 获取或创建底层 MutableSharedFlow（内部方法） */
    private fun getOrCreateFlow(panelId: String): MutableSharedFlow<AgentEvent> =
        flows.computeIfAbsent(panelId) {
            MutableSharedFlow(
                replay = 0,
                extraBufferCapacity = 64,
                onBufferOverflow = BufferOverflow.DROP_OLDEST,
            )
        }
}
