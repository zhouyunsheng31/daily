package com.livingdashboard.ai

import com.livingdashboard.sync.ClientMessage
import com.livingdashboard.sync.WsClient
import com.livingdashboard.sync.WsState
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * CloudAgentService 单元测试（Spec 8.1 节，6 用例）。
 *
 * 用 MockK mock WsClient / PanelEventRouter。scope 用 backgroundScope（TestScope 提供）。
 *
 * 关键设计：
 * - mockWsClient.state 是 MutableStateFlow<WsState>，控制 CONNECTED/DISCONNECTED
 * - mockPanelEventRouter.getOrCreate(panelId) 返回测试用 Flow<AgentEvent>，模拟服务器下发的事件流
 * - 120s 超时用 advanceTimeBy(120_001) 推进虚拟时间触发 withTimeoutOrNull
 * - 用 backgroundScope.async 收集 sendMessage 返回的 Flow，再 advanceTimeBy 触发超时
 *
 * 用例：
 * 1. WS 不在线 → emit Error("服务器未连接...")
 * 2. WS 在线但 send 返回 false → emit Error("发送消息失败...")
 * 3. PanelEventRouter emit TextDelta → 转发为 AgentEvent.TextDelta
 * 4. PanelEventRouter emit TurnEnd → 转发为 AgentEvent.TurnEnd
 * 5. 120s 超时 → emit Error("服务器响应超时（120s）") + 发 DisposeSession
 * 6. testConnection 在 WS CONNECTED 时返回 true，DISCONNECTED 时返回 false
 */
class CloudAgentServiceTest {

    private val mockWsClient = mockk<WsClient>(relaxed = true)
    private val mockPanelEventRouter = mockk<PanelEventRouter>(relaxed = true)

    private fun makeService(scope: kotlinx.coroutines.CoroutineScope): CloudAgentService =
        CloudAgentService(mockWsClient, mockPanelEventRouter, scope)

    // =========================================================================
    // 1. WS 不在线 → emit Error
    // =========================================================================

    @Test
    fun `WS not connected emits Error with not-connected message`() = runTest {
        val wsState = MutableStateFlow(WsState.DISCONNECTED)
        every { mockWsClient.state } returns wsState

        val service = makeService(backgroundScope)
        val events = service.sendMessage("p1", "hi", ThinkingLevel.STANDARD).toList()

        assertEquals(1, events.size)
        val error = events[0]
        assertTrue("expected Error, got $error", error is AgentEvent.Error)
        val err = error as AgentEvent.Error
        assertTrue("expected message contains '服务器未连接', got '${err.message}'", err.message.contains("服务器未连接"))
        assertTrue("expected recoverable=true, got ${err.recoverable}", err.recoverable)
    }

    // =========================================================================
    // 2. WS 在线但 send 返回 false → emit Error
    // =========================================================================

    @Test
    fun `send failure emits Error with send-failed message`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        every { mockWsClient.state } returns wsState
        every { mockWsClient.send(any()) } returns false

        val service = makeService(backgroundScope)
        val events = service.sendMessage("p1", "hi", ThinkingLevel.STANDARD).toList()

        assertEquals(1, events.size)
        val err = events[0] as AgentEvent.Error
        assertTrue("expected message contains '发送消息失败', got '${err.message}'", err.message.contains("发送消息失败"))
        assertTrue(err.recoverable)
    }

    // =========================================================================
    // 3. PanelEventRouter emit TextDelta → 转发为 AgentEvent.TextDelta
    // =========================================================================

    @Test
    fun `PanelEventRouter TextDelta is forwarded as AgentEvent TextDelta`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        every { mockWsClient.state } returns wsState
        every { mockWsClient.send(any()) } returns true
        every { mockPanelEventRouter.getOrCreate("p1") } returns flowOf(
            AgentEvent.TextDelta("hello"),
            AgentEvent.TurnEnd("stop"),
        )

        val service = makeService(backgroundScope)
        val events = service.sendMessage("p1", "hi", ThinkingLevel.STANDARD).toList()

        // 期望转发 TextDelta + TurnEnd
        val textDeltas = events.filterIsInstance<AgentEvent.TextDelta>()
        assertEquals(1, textDeltas.size)
        assertEquals("hello", textDeltas[0].text)

        val turnEnds = events.filterIsInstance<AgentEvent.TurnEnd>()
        assertEquals(1, turnEnds.size)
        assertEquals("stop", turnEnds[0].finishReason)
    }

    // =========================================================================
    // 4. PanelEventRouter emit TurnEnd → 转发为 AgentEvent.TurnEnd（不再发 DisposeSession）
    // =========================================================================

    @Test
    fun `PanelEventRouter TurnEnd is forwarded and DisposeSession not sent`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        every { mockWsClient.state } returns wsState
        every { mockWsClient.send(any()) } returns true
        every { mockPanelEventRouter.getOrCreate("p1") } returns flowOf(
            AgentEvent.TurnEnd("stop"),
        )

        val service = makeService(backgroundScope)
        val events = service.sendMessage("p1", "hi", ThinkingLevel.STANDARD).toList()

        val turnEnds = events.filterIsInstance<AgentEvent.TurnEnd>()
        assertEquals(1, turnEnds.size)
        // TurnEnd 不应触发 DisposeSession（仅 Error/超时才发）
        verify(exactly = 0) {
            mockWsClient.send(match { it is ClientMessage.DisposeSession })
        }
    }

    // =========================================================================
    // 5. 120s 超时 → emit Error + 发 DisposeSession
    // =========================================================================

    @Test
    fun `120s timeout emits Error and sends DisposeSession`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        every { mockWsClient.state } returns wsState
        every { mockWsClient.send(any()) } returns true
        // getOrCreate 返回永不 emit 的 flow（一直挂起）
        every { mockPanelEventRouter.getOrCreate("p1") } returns flow { delay(Long.MAX_VALUE) }

        val service = makeService(backgroundScope)

        // 用 async 收集，避免 toList 阻塞
        val deferred = backgroundScope.async {
            service.sendMessage("p1", "hi", ThinkingLevel.STANDARD).toList()
        }
        // 推进虚拟时间超过 120s 触发 withTimeoutOrNull 超时
        advanceTimeBy(120_001)
        advanceUntilIdle()
        val events = deferred.await()

        val errors = events.filterIsInstance<AgentEvent.Error>()
        assertEquals("expected 1 Error on timeout, got ${events.size} events", 1, errors.size)
        assertTrue(
            "expected message contains '120s', got '${errors[0].message}'",
            errors[0].message.contains("120s"),
        )
        assertTrue(errors[0].recoverable)
        // 应发 DisposeSession
        verify(exactly = 1) {
            mockWsClient.send(match { it is ClientMessage.DisposeSession && it.panelId == "p1" })
        }
    }

    // =========================================================================
    // 6. testConnection 在 WS CONNECTED 时返回 true，DISCONNECTED 时返回 false
    // =========================================================================

    @Test
    fun `testConnection returns true when WS connected and false when disconnected`() = runTest {
        val wsState = MutableStateFlow(WsState.CONNECTED)
        every { mockWsClient.state } returns wsState
        val service = makeService(backgroundScope)

        val config = LlmProviderConfig(
            provider = "stepfun",
            apiKey = "test-key",
            endpoint = "https://api.stepfun.com/v1",
            model = "step-3.7-flash",
        )
        assertTrue("expected true when CONNECTED", service.testConnection(config))

        wsState.value = WsState.DISCONNECTED
        assertFalse("expected false when DISCONNECTED", service.testConnection(config))
    }
}
