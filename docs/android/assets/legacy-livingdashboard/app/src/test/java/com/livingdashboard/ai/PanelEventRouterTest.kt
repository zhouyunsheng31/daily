package com.livingdashboard.ai

import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PanelEventRouter 单元测试（Spec 8.1 节，6 用例）。
 *
 * 直接用真实 [PanelEventRouter] 实例测试，无需 mock。
 *
 * 关键设计：
 * - [getOrCreate] 返回 [kotlinx.coroutines.flow.Flow] 包装的 SharedFlow（asSharedFlow 每次创建新 wrapper），
 *   故用行为等价性（订阅后能否收到 dispatch 的事件）验证而非引用相等
 * - [dispatch] 用 tryEmit，subscriber 在 collect 后才能收到（replay=0，无历史事件）
 * - [dispose] 从 map 移除底层 MutableSharedFlow，旧订阅者不再收到新事件
 *
 * 用例：
 * 1. 同一 panelId 两次 getOrCreate 返回的 Flow 行为等价（共享底层 SharedFlow）
 * 2. 不同 panelId 的 Flow 隔离
 * 3. dispatch 只投递到对应 panelId 的订阅者
 * 4. dispose 后旧订阅者不再收到事件，新 getOrCreate 创建新底层 Flow
 * 5. activePanelIds 反映已创建/已销毁的面板
 * 6. replay=0：新订阅者收不到 dispose 之前 dispatch 的历史事件
 */
class PanelEventRouterTest {

    // =========================================================================
    // 1. 同一 panelId 两次 getOrCreate 行为等价（共享底层 SharedFlow）
    // =========================================================================

    @Test
    fun `getOrCreate for same panelId shares underlying SharedFlow`() = runTest(UnconfinedTestDispatcher()) {
        val router = PanelEventRouter()
        val flow1 = router.getOrCreate("p1")
        val flow2 = router.getOrCreate("p1")

        val events1 = mutableListOf<AgentEvent>()
        val events2 = mutableListOf<AgentEvent>()
        val job1 = backgroundScope.launch { flow1.collect { events1.add(it) } }
        val job2 = backgroundScope.launch { flow2.collect { events2.add(it) } }
        advanceUntilIdle()

        router.dispatch("p1", AgentEvent.TextDelta("hello"))
        advanceUntilIdle()

        // 两个 Flow 包装同一底层 SharedFlow，订阅者都应收到同一事件
        assertEquals(1, events1.size)
        assertEquals(1, events2.size)
        assertEquals("hello", (events1[0] as AgentEvent.TextDelta).text)
        assertEquals("hello", (events2[0] as AgentEvent.TextDelta).text)

        // activePanelIds 只有一个面板
        assertEquals(setOf("p1"), router.activePanelIds())
    }

    // =========================================================================
    // 2. 不同 panelId 的 Flow 隔离
    // =========================================================================

    @Test
    fun `getOrCreate for different panelIds returns isolated flows`() = runTest(UnconfinedTestDispatcher()) {
        val router = PanelEventRouter()
        router.getOrCreate("p1")
        router.getOrCreate("p2")

        assertEquals(setOf("p1", "p2"), router.activePanelIds())
    }

    // =========================================================================
    // 3. dispatch 只投递到对应 panelId 的订阅者
    // =========================================================================

    @Test
    fun `dispatch delivers event only to matching panel subscriber`() = runTest(UnconfinedTestDispatcher()) {
        val router = PanelEventRouter()
        val p1Events = mutableListOf<AgentEvent>()
        val p2Events = mutableListOf<AgentEvent>()

        val job1 = backgroundScope.launch {
            router.getOrCreate("p1").collect { p1Events.add(it) }
        }
        val job2 = backgroundScope.launch {
            router.getOrCreate("p2").collect { p2Events.add(it) }
        }
        advanceUntilIdle()

        router.dispatch("p1", AgentEvent.TextDelta("for-p1"))
        advanceUntilIdle()

        assertEquals(1, p1Events.size)
        assertEquals("for-p1", (p1Events[0] as AgentEvent.TextDelta).text)
        assertEquals(0, p2Events.size)

        router.dispatch("p2", AgentEvent.TurnEnd("stop"))
        advanceUntilIdle()

        assertEquals(1, p1Events.size)  // p1 仍只有 1 条
        assertEquals(1, p2Events.size)
        assertTrue(p2Events[0] is AgentEvent.TurnEnd)
    }

    // =========================================================================
    // 4. dispose 后旧订阅者不再收到事件，新 getOrCreate 创建新底层 Flow
    // =========================================================================

    @Test
    fun `dispose removes flow so old subscribers stop receiving new events`() = runTest(UnconfinedTestDispatcher()) {
        val router = PanelEventRouter()
        val oldFlow = router.getOrCreate("p1")
        val oldEvents = mutableListOf<AgentEvent>()
        val job = backgroundScope.launch { oldFlow.collect { oldEvents.add(it) } }
        advanceUntilIdle()

        router.dispatch("p1", AgentEvent.TextDelta("before-dispose"))
        advanceUntilIdle()
        assertEquals(1, oldEvents.size)

        router.dispose("p1")
        advanceUntilIdle()
        // dispose 立即从 map 移除底层 SharedFlow
        assertEquals("activePanelIds should be empty right after dispose", emptySet<String>(), router.activePanelIds())

        // dispatch 会通过 computeIfAbsent 重新创建 flow，但旧订阅者的 oldFlow
        // 仍引用 dispose 前的旧 SharedFlow，故收不到新事件
        router.dispatch("p1", AgentEvent.TextDelta("after-dispose"))
        advanceUntilIdle()

        // 旧订阅者不应收到 dispose 之后的 dispatch
        assertEquals("old subscriber should not receive post-dispose event", 1, oldEvents.size)
        // dispatch 重新创建了 "p1" 的 flow，故 activePanelIds 又包含 "p1"
        assertEquals(setOf("p1"), router.activePanelIds())
    }

    // =========================================================================
    // 5. activePanelIds 反映已创建/已销毁的面板
    // =========================================================================

    @Test
    fun `activePanelIds tracks created and disposed panels`() = runTest(UnconfinedTestDispatcher()) {
        val router = PanelEventRouter()
        assertTrue("expected empty initially, got ${router.activePanelIds()}", router.activePanelIds().isEmpty())

        router.getOrCreate("p1")
        router.getOrCreate("p2")
        assertEquals(setOf("p1", "p2"), router.activePanelIds())

        router.dispose("p1")
        assertEquals(setOf("p2"), router.activePanelIds())

        router.dispose("p2")
        assertTrue(router.activePanelIds().isEmpty())
    }

    // =========================================================================
    // 6. replay=0：新订阅者收不到 dispose 之前 dispatch 的历史事件
    // =========================================================================

    @Test
    fun `new subscriber does not receive previously dispatched events`() = runTest(UnconfinedTestDispatcher()) {
        val router = PanelEventRouter()
        // dispatch 前无订阅者
        router.dispatch("p1", AgentEvent.TextDelta("old"))
        advanceUntilIdle()

        val events = mutableListOf<AgentEvent>()
        val job = backgroundScope.launch {
            router.getOrCreate("p1").collect { events.add(it) }
        }
        advanceUntilIdle()

        // 订阅后再 dispatch
        router.dispatch("p1", AgentEvent.TextDelta("new"))
        advanceUntilIdle()

        // 只应收到 "new"（replay=0，无历史事件回放）
        assertEquals(1, events.size)
        assertEquals("new", (events[0] as AgentEvent.TextDelta).text)
        assertNotEquals("old", (events[0] as AgentEvent.TextDelta).text)
    }
}
