package com.livingdashboard.ai

import com.livingdashboard.sync.WsClient
import com.livingdashboard.sync.WsState
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 5 用例：AUTO+在线→CLOUD, AUTO+离线→LOCAL, LOCAL 强制, CLOUD+离线→LOCAL, cooldown 防抖动。
 * 用 MockK mock WsClient，TestScope + 虚拟时间控制。
 */
class RuntimeModeManagerTest {

    private fun makeManager(
        wsStateFlow: MutableStateFlow<WsState>,
        scope: CoroutineScope
    ): RuntimeModeManager {
        val wsClient = mockk<WsClient>()
        every { wsClient.state } returns wsStateFlow
        return RuntimeModeManager(wsClient, scope)
    }

    @Test
    fun `AUTO plus online yields CLOUD`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        val manager = makeManager(wsState, backgroundScope)

        // 等待 debounce(2000) + stateIn 初始值稳定
        advanceTimeBy(2100)

        assertEquals(AgentMode.AUTO, manager.state.value.mode)
        assertEquals(true, manager.state.value.isServerOnline)
        assertEquals(AgentMode.CLOUD, manager.state.value.effectiveMode)
        assertEquals(false, manager.state.value.isOfflineDowngraded)
    }

    @Test
    fun `AUTO plus offline yields LOCAL`() = runTest {
        val wsState = MutableStateFlow(WsState.DISCONNECTED)
        val manager = makeManager(wsState, backgroundScope)

        advanceTimeBy(2100)

        assertEquals(AgentMode.AUTO, manager.state.value.mode)
        assertEquals(false, manager.state.value.isServerOnline)
        assertEquals(AgentMode.LOCAL, manager.state.value.effectiveMode)
        assertEquals(true, manager.state.value.isOfflineDowngraded)
    }

    @Test
    fun `LOCAL mode forces LOCAL regardless of ws state`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        val manager = makeManager(wsState, backgroundScope)

        // 先让初始 AUTO+CONNECTED 稳定
        advanceTimeBy(2100)
        assertEquals(AgentMode.CLOUD, manager.state.value.effectiveMode)

        // 切换到 LOCAL 模式（selectedMode 变化不经过 debounce，combine 立即重新计算）
        manager.setMode(AgentMode.LOCAL)

        // _selectedMode 变了 → combine 立即触发（因为 wsState 没变，debounce 上游不发新值，
        // 但 combine 监听两个 flow，_selectedMode 变了也触发 combine）
        // 注意：combine 在任一上游变化时都会重新计算，_selectedMode 不经过 debounce
        // effectiveMode 应立即变为 LOCAL
        // 但 effectiveMode 的更新依赖 debounce(wsClient.state) 发射，
        // 而 wsState 没变 → debounce 不会重新发射 → combine 不会重新计算
        // 所以需要让 debounce 重新发射：等一个 debounce 周期
        advanceTimeBy(2100)

        assertEquals(AgentMode.LOCAL, manager.state.value.mode)
        assertEquals(AgentMode.LOCAL, manager.state.value.effectiveMode)
        assertEquals(false, manager.state.value.isOfflineDowngraded)

        // 即使后续 ws 状态变化，LOCAL 模式仍然 LOCAL
        wsState.value = WsState.DISCONNECTED
        advanceTimeBy(2100)
        assertEquals(AgentMode.LOCAL, manager.state.value.effectiveMode)
    }

    @Test
    fun `CLOUD plus offline degrades to LOCAL`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        val manager = makeManager(wsState, backgroundScope)

        // 初始 AUTO+CONNECTED → CLOUD
        advanceTimeBy(2100)
        assertEquals(AgentMode.CLOUD, manager.state.value.effectiveMode)

        // 切换到 CLOUD 模式
        manager.setMode(AgentMode.CLOUD)
        // 等 debounce 重新发射（wsState 没变，但 _selectedMode 变了 → combine 重新计算需要 debounce 上游也发射）
        advanceTimeBy(2100)
        assertEquals(AgentMode.CLOUD, manager.state.value.mode)
        assertEquals(AgentMode.CLOUD, manager.state.value.effectiveMode)
        assertEquals(false, manager.state.value.isOfflineDowngraded)

        // 断线
        wsState.value = WsState.DISCONNECTED
        // 等 debounce(2000) 过去
        advanceTimeBy(2100)

        assertEquals(AgentMode.CLOUD, manager.state.value.mode)
        assertEquals(AgentMode.LOCAL, manager.state.value.effectiveMode)
        assertEquals(true, manager.state.value.isOfflineDowngraded)
    }

    @Test
    fun `cooldown debounces rapid ws state changes`() = runTest {
        val wsState = MutableStateFlow(WsState.DISCONNECTED)
        val manager = makeManager(wsState, backgroundScope)

        // 先让初始 DISCONNECTED 稳定 → effective LOCAL
        advanceTimeBy(2100)
        assertEquals(AgentMode.LOCAL, manager.state.value.effectiveMode)

        // 在 debounce 窗口（2s）内反复切换 ws 状态（5 次变化，若无 debounce effectiveMode 会变 5 次）
        wsState.value = WsState.CONNECTED
        wsState.value = WsState.DISCONNECTED
        wsState.value = WsState.CONNECTED
        wsState.value = WsState.DISCONNECTED
        wsState.value = WsState.CONNECTED  // 最后一个值 = CONNECTED

        // 推进时间 < 2s，debounce 尚未触发，effectiveMode 应仍为 LOCAL（0 次变化）
        advanceTimeBy(1000)
        assertEquals(AgentMode.LOCAL, manager.state.value.effectiveMode)

        // 推进时间超过 debounce 窗口（从最后一次变化起算 2s）
        advanceTimeBy(1500)  // 总计 2.5s > 2s

        // debounce 发射最后一个值 CONNECTED → effective 变为 CLOUD（仅 1 次变化）
        assertEquals(AgentMode.CLOUD, manager.state.value.effectiveMode)
        assertEquals(true, manager.state.value.isServerOnline)
    }
}
