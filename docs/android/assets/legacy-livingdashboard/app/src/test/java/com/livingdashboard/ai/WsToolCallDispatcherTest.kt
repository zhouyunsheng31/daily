package com.livingdashboard.ai

import com.livingdashboard.sync.ClientMessage
import com.livingdashboard.sync.DeviceAuth
import com.livingdashboard.sync.ServerMessage
import com.livingdashboard.sync.WsClient
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WsToolCallDispatcher 单元测试（Spec 8.1 节，7 用例）。
 *
 * 用 MockK mock WsClient / DeviceAuth / PanelEventRouter / AskUserDialogState。
 * ToolRegistry 用真实实例 + 注册假工具（避免 mockk mock 内部 ConcurrentHashMap）。
 *
 * 关键设计：
 * - 通过向 mockWsClient.messages（MutableSharedFlow）emit ServerMessage 来触发 handleToolCall/handlePiEvent
 * - 用 backgroundScope（TestScope 提供，跑在 UnconfinedTestDispatcher 上）作为 dispatcher.scope
 * - 30s 超时用 advanceTimeBy(31_000) 推进虚拟时间触发
 *
 * 用例：
 * 1. targetDeviceId == myDeviceId → 执行工具 → 回传 ToolResult + dispatch ToolCallStart/End
 * 2. targetDeviceId != myDeviceId → 跳过（不执行、不回传、不 dispatch）
 * 3. targetDeviceId == null（广播）→ 执行工具
 * 4. 工具执行 30s 超时 → ToolResult.error("tool timeout after 30s")
 * 5. 工具执行抛异常 → ToolResult.error(异常 message) + dispatch ToolCallEnd(success=false)
 * 6. PiEvent text_delta → dispatch TextDelta
 * 7. PiEvent turn_end → dispatch TurnEnd
 */
class WsToolCallDispatcherTest {

    private val mockWsClient = mockk<WsClient>(relaxed = true)
    private val mockDeviceAuth = mockk<DeviceAuth>()
    private val mockPanelEventRouter = mockk<PanelEventRouter>(relaxed = true)
    private val mockAskUserDialogState = mockk<AskUserDialogState>(relaxed = true)
    private val messages = MutableSharedFlow<ServerMessage>(
        extraBufferCapacity = 64,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )

    private fun makeDispatcher(scope: CoroutineScope, registry: ToolRegistry): WsToolCallDispatcher {
        every { mockWsClient.messages } returns messages.asSharedFlow()
        every { mockDeviceAuth.getDeviceId() } returns "dev1"
        return WsToolCallDispatcher(
            wsClient = mockWsClient,
            toolRegistry = registry,
            deviceAuth = mockDeviceAuth,
            panelEventRouter = mockPanelEventRouter,
            askUserDialogState = mockAskUserDialogState,
            scope = scope,
        )
    }

    private fun noopTool(name: String = "noop"): Tool = object : Tool {
        override val definition = ToolDefinition(
            name = name,
            description = "no operation",
            parameters = buildJsonObject { put("type", "object") },
        )
        override suspend fun execute(args: JsonObject): ToolResult =
            ToolResult.success(buildJsonObject { put("ok", true) })
    }

    private fun boomTool(name: String = "boom"): Tool = object : Tool {
        override val definition = ToolDefinition(
            name = name,
            description = "always throws",
            parameters = buildJsonObject { put("type", "object") },
        )
        override suspend fun execute(args: JsonObject): ToolResult =
            throw RuntimeException("boom-bang")
    }

    // =========================================================================
    // 1. targetDeviceId == myDeviceId → 执行工具 → 回传 ToolResult + dispatch
    // =========================================================================

    @Test
    fun `targetDeviceId matching myDeviceId executes tool and sends ToolResult`() = runTest(UnconfinedTestDispatcher()) {
        val registry = ToolRegistry().apply { register(noopTool("browser_navigate")) }
        val dispatcher = makeDispatcher(backgroundScope, registry)
        dispatcher.start()

        val sentMessages = mutableListOf<ClientMessage>()
        every { mockWsClient.send(any()) } answers {
            sentMessages.add(firstArg()); true
        }

        messages.tryEmit(ServerMessage.ToolCall(
            requestId = "r1",
            tool = "browser_navigate",
            params = JsonObject(emptyMap()),
            targetDeviceId = "dev1",
            panelId = "p1",
        ))
        advanceUntilIdle()

        // 验证回传 ToolResult（成功）
        val toolResults = sentMessages.filterIsInstance<ClientMessage.ToolResult>()
        assertTrue("expected 1 ToolResult, got ${sentMessages.size} messages", toolResults.size == 1)
        assertTrue(toolResults[0].success)
        assertTrue("requestId should be r1", toolResults[0].requestId == "r1")

        // 验证 dispatch ToolCallStart + ToolCallEnd
        verify(exactly = 1) {
            mockPanelEventRouter.dispatch("p1", match { it is AgentEvent.ToolCallStart })
        }
        verify(exactly = 1) {
            mockPanelEventRouter.dispatch("p1", match { it is AgentEvent.ToolCallEnd && it.success })
        }
    }

    // =========================================================================
    // 2. targetDeviceId != myDeviceId → 跳过
    // =========================================================================

    @Test
    fun `targetDeviceId different from myDeviceId skips execution`() = runTest(UnconfinedTestDispatcher()) {
        val registry = ToolRegistry().apply { register(noopTool("browser_navigate")) }
        val dispatcher = makeDispatcher(backgroundScope, registry)
        dispatcher.start()

        val sentMessages = mutableListOf<ClientMessage>()
        every { mockWsClient.send(any()) } answers {
            sentMessages.add(firstArg()); true
        }

        messages.tryEmit(ServerMessage.ToolCall(
            requestId = "r1",
            tool = "browser_navigate",
            params = JsonObject(emptyMap()),
            targetDeviceId = "other_device",
            panelId = "p1",
        ))
        advanceUntilIdle()

        // 不应执行工具，不应回传任何消息，不应 dispatch 任何事件
        assertTrue("expected 0 sent messages, got ${sentMessages.size}", sentMessages.isEmpty())
        verify(exactly = 0) { mockPanelEventRouter.dispatch(any(), any()) }
    }

    // =========================================================================
    // 3. targetDeviceId == null（广播）→ 执行工具
    // =========================================================================

    @Test
    fun `null targetDeviceId executes tool as broadcast`() = runTest(UnconfinedTestDispatcher()) {
        val registry = ToolRegistry().apply { register(noopTool("noop")) }
        val dispatcher = makeDispatcher(backgroundScope, registry)
        dispatcher.start()

        val sentMessages = mutableListOf<ClientMessage>()
        every { mockWsClient.send(any()) } answers {
            sentMessages.add(firstArg()); true
        }

        messages.tryEmit(ServerMessage.ToolCall(
            requestId = "r2",
            tool = "noop",
            params = JsonObject(emptyMap()),
            targetDeviceId = null,
            panelId = "p1",
        ))
        advanceUntilIdle()

        val toolResults = sentMessages.filterIsInstance<ClientMessage.ToolResult>()
        assertTrue("expected 1 ToolResult for broadcast", toolResults.size == 1)
        assertTrue(toolResults[0].success)
    }

    // =========================================================================
    // 4. 工具执行 30s 超时 → ToolResult.error("tool timeout after 30s")
    // =========================================================================

    @Test
    fun `tool execution timeout returns ToolResult error with timeout message`() = runTest(UnconfinedTestDispatcher()) {
        // 注册一个会挂起很久的工具
        val slowTool = object : Tool {
            override val definition = ToolDefinition(
                name = "slow_tool",
                description = "suspends forever",
                parameters = buildJsonObject { put("type", "object") },
            )
            override suspend fun execute(args: JsonObject): ToolResult {
                delay(Long.MAX_VALUE)
                error("unreachable")
            }
        }
        val registry = ToolRegistry().apply { register(slowTool) }
        val dispatcher = makeDispatcher(backgroundScope, registry)
        dispatcher.start()

        val sentMessages = mutableListOf<ClientMessage>()
        every { mockWsClient.send(any()) } answers {
            sentMessages.add(firstArg()); true
        }

        messages.tryEmit(ServerMessage.ToolCall(
            requestId = "r3",
            tool = "slow_tool",
            params = JsonObject(emptyMap()),
            targetDeviceId = "dev1",
            panelId = "p1",
        ))
        // 推进虚拟时间超过 30s 超时
        advanceTimeBy(31_000)
        advanceUntilIdle()

        val toolResults = sentMessages.filterIsInstance<ClientMessage.ToolResult>()
        assertTrue("expected 1 ToolResult on timeout", toolResults.size == 1)
        assertFalse("expected success=false on timeout", toolResults[0].success)
        val error = toolResults[0].error
        assertTrue("expected 'timeout' in error, got: $error", error?.contains("timeout") == true)
        // 超时后仍应 dispatch ToolCallEnd
        verify(exactly = 1) {
            mockPanelEventRouter.dispatch("p1", match { it is AgentEvent.ToolCallEnd && !it.success })
        }
    }

    // =========================================================================
    // 5. 工具执行抛异常 → ToolResult.error(异常 message) + dispatch ToolCallEnd(success=false)
    // =========================================================================

    @Test
    fun `tool execution exception returns ToolResult error with exception message`() = runTest(UnconfinedTestDispatcher()) {
        val registry = ToolRegistry().apply { register(boomTool("boom_tool")) }
        val dispatcher = makeDispatcher(backgroundScope, registry)
        dispatcher.start()

        val sentMessages = mutableListOf<ClientMessage>()
        every { mockWsClient.send(any()) } answers {
            sentMessages.add(firstArg()); true
        }

        messages.tryEmit(ServerMessage.ToolCall(
            requestId = "r4",
            tool = "boom_tool",
            params = JsonObject(emptyMap()),
            targetDeviceId = "dev1",
            panelId = "p1",
        ))
        advanceUntilIdle()

        val toolResults = sentMessages.filterIsInstance<ClientMessage.ToolResult>()
        assertTrue("expected 1 ToolResult", toolResults.size == 1)
        assertFalse("expected success=false on exception", toolResults[0].success)
        assertTrue(
            "expected 'boom-bang' in error, got: ${toolResults[0].error}",
            toolResults[0].error?.contains("boom-bang") == true,
        )
        verify(exactly = 1) {
            mockPanelEventRouter.dispatch("p1", match { it is AgentEvent.ToolCallEnd && !it.success })
        }
    }

    // =========================================================================
    // 6. PiEvent text_delta → dispatch TextDelta
    // =========================================================================

    @Test
    fun `PiEvent text_delta dispatches TextDelta to PanelEventRouter`() = runTest(UnconfinedTestDispatcher()) {
        val dispatcher = makeDispatcher(backgroundScope, ToolRegistry())
        dispatcher.start()

        val data = buildJsonObject { put("text", "hello world") }
        messages.tryEmit(ServerMessage.PiEvent(
            event = "text_delta",
            data = data,
            panelId = "p1",
        ))
        advanceUntilIdle()

        verify(exactly = 1) {
            mockPanelEventRouter.dispatch("p1", match {
                it is AgentEvent.TextDelta && it.text == "hello world"
            })
        }
    }

    // =========================================================================
    // 7. PiEvent turn_end → dispatch TurnEnd
    // =========================================================================

    @Test
    fun `PiEvent turn_end dispatches TurnEnd to PanelEventRouter`() = runTest(UnconfinedTestDispatcher()) {
        val dispatcher = makeDispatcher(backgroundScope, ToolRegistry())
        dispatcher.start()

        val data = buildJsonObject { put("finishReason", "stop") }
        messages.tryEmit(ServerMessage.PiEvent(
            event = "turn_end",
            data = data,
            panelId = "p1",
        ))
        advanceUntilIdle()

        verify(exactly = 1) {
            mockPanelEventRouter.dispatch("p1", match {
                it is AgentEvent.TurnEnd && it.finishReason == "stop"
            })
        }
    }
}
