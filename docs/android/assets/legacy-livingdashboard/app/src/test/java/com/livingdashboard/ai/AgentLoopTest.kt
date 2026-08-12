package com.livingdashboard.ai

import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 10 用例（Spec 8.1 节）：
 * - 无工具单轮 + 单工具单轮 + 多工具多轮：3
 * - tool_calls 分片累积：1
 * - tool_result 拼回 session：1
 * - 最大轮次限制（第 11 轮 emit Error）：1
 * - LlmStreamError 传播：1
 * - 工具执行失败 → ToolResult.error → 继续下一轮：1
 * - 流被取消时 session 不写脏数据：1
 * - TurnStart 事件：1
 *
 * 用 MockK mock LlmClient（具体类，mockk 支持 final class mock）。
 * ToolRegistry 用真实实例 + 注册假工具，避免 mockk mock 内部 ConcurrentHashMap 状态。
 */
class AgentLoopTest {

    private val cfg = LlmClientConfig(
        endpoint = "http://localhost/v1",
        apiKey = "test-key",
        provider = "stepfun",
        model = "test-model",
    )

    private fun emptySession(): Session = Session(systemPrompt = "system prompt", tools = emptyList())

    private fun noopTool(name: String = "noop"): Tool = object : Tool {
        override val definition = ToolDefinition(
            name = name,
            description = "no operation",
            parameters = buildJsonObject { put("type", "object") },
        )
        override suspend fun execute(args: JsonObject): ToolResult =
            ToolResult.success(buildJsonObject { put("ok", true) })
    }

    private suspend fun collect(loop: AgentLoop, session: Session, userMessage: String): List<AgentEvent> =
        loop.run(session, userMessage, ThinkingLevel.STANDARD, cfg).toList()

    // =========================================================================
    // 1. 无工具单轮 + 单工具单轮 + 多工具多轮：3 用例
    // =========================================================================

    @Test
    fun `no tool calls single turn emits TurnStart TextDelta TurnEnd`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returns flowOf(
            LlmStreamEvent.TextDelta("Hello"),
            LlmStreamEvent.TextDelta("!"),
            LlmStreamEvent.Done("stop", null),
        )
        val loop = AgentLoop(llmClient, ToolRegistry())
        val session = emptySession()

        val events = collect(loop, session, "hi")

        // 期望事件序列：TurnStart, TextDelta("Hello"), TextDelta("!"), TurnEnd("stop")
        assertEquals(AgentEvent.TurnStart, events[0])
        assertTrue(events[1] is AgentEvent.TextDelta)
        assertEquals("Hello", (events[1] as AgentEvent.TextDelta).text)
        assertTrue(events[2] is AgentEvent.TextDelta)
        assertEquals("!", (events[2] as AgentEvent.TextDelta).text)
        assertTrue(events[3] is AgentEvent.TurnEnd)
        assertEquals("stop", (events[3] as AgentEvent.TurnEnd).finishReason)

        // session 状态：system + user + assistant
        assertEquals(3, session.messages().size)
        assertEquals("user", session.messages()[1].role)
        assertEquals("hi", session.messages()[1].content)
        assertEquals("assistant", session.messages()[2].role)
        assertEquals("Hello!", session.messages()[2].content)
    }

    @Test
    fun `single tool call then text response completes in two turns`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returnsMany listOf(
            // 第 1 轮：tool_call
            flowOf(
                LlmStreamEvent.ToolCallDelta(0, "call_1", "noop", "{}"),
                LlmStreamEvent.Done("tool_calls", null),
            ),
            // 第 2 轮：纯文本
            flowOf(
                LlmStreamEvent.TextDelta("done"),
                LlmStreamEvent.Done("stop", null),
            ),
        )
        val registry = ToolRegistry().apply { register(noopTool()) }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        val events = collect(loop, session, "do something")

        // 期望事件序列：
        // 第 1 轮：TurnStart, ToolCallStart, ToolCallEnd
        // 第 2 轮：TurnStart, TextDelta("done"), TurnEnd
        val turnStarts = events.filterIsInstance<AgentEvent.TurnStart>()
        assertEquals(2, turnStarts.size)

        val toolStarts = events.filterIsInstance<AgentEvent.ToolCallStart>()
        assertEquals(1, toolStarts.size)
        assertEquals("call_1", toolStarts[0].callId)
        assertEquals("noop", toolStarts[0].toolName)

        val toolEnds = events.filterIsInstance<AgentEvent.ToolCallEnd>()
        assertEquals(1, toolEnds.size)
        assertEquals("call_1", toolEnds[0].callId)
        assertTrue(toolEnds[0].success)

        val textDeltas = events.filterIsInstance<AgentEvent.TextDelta>()
        assertEquals(1, textDeltas.size)
        assertEquals("done", textDeltas[0].text)

        assertTrue(events.last() is AgentEvent.TurnEnd)
    }

    @Test
    fun `multiple tool calls in one turn all execute`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returnsMany listOf(
            // 第 1 轮：两个 tool_call
            flowOf(
                LlmStreamEvent.ToolCallDelta(0, "call_a", "noop_a", "{}"),
                LlmStreamEvent.ToolCallDelta(1, "call_b", "noop_b", "{}"),
                LlmStreamEvent.Done("tool_calls", null),
            ),
            // 第 2 轮：纯文本
            flowOf(
                LlmStreamEvent.TextDelta("all done"),
                LlmStreamEvent.Done("stop", null),
            ),
        )
        val registry = ToolRegistry().apply {
            register(noopTool("noop_a"))
            register(noopTool("noop_b"))
        }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        val events = collect(loop, session, "do two things")

        val toolStarts = events.filterIsInstance<AgentEvent.ToolCallStart>()
        assertEquals(2, toolStarts.size)
        val toolEnds = events.filterIsInstance<AgentEvent.ToolCallEnd>()
        assertEquals(2, toolEnds.size)
        // 校验两个 tool 的 callId 不同
        val callIds = toolStarts.map { it.callId }.toSet()
        assertEquals(2, callIds.size)
        assertTrue("call_a" in callIds)
        assertTrue("call_b" in callIds)
        // 两个 tool 名称不同
        val toolNames = toolStarts.map { it.toolName }.toSet()
        assertEquals(setOf("noop_a", "noop_b"), toolNames)
    }

    // =========================================================================
    // 2. tool_calls 分片累积：1 用例
    // =========================================================================

    @Test
    fun `tool call arguments are accumulated across multiple chunks`() = runTest {
        val llmClient = mockk<LlmClient>()
        // 跨 3 个 chunk 返回 tool_call arguments：{"key":"foo"}
        every { llmClient.stream(any(), any()) } returnsMany listOf(
            flowOf(
                // chunk 1: id + name + arguments 起始片段（内容需为 {"key":" 8 字符；
                // 因 Kotlin raw string 是 lazy 匹配，""" + 内容 + """ 中若内容
                // 以 " 结尾会与闭合 """ 形成 """" 被提前关闭，故改用普通字符串字面量）
                LlmStreamEvent.ToolCallDelta(0, "call_1", "noop", "{\"key\":\""),
                // chunk 2: arguments 中间片段
                LlmStreamEvent.ToolCallDelta(0, null, null, "foo"),
                // chunk 3: arguments 结束片段
                LlmStreamEvent.ToolCallDelta(0, null, null, """"}"""),
                LlmStreamEvent.Done("tool_calls", null),
            ),
            flowOf(LlmStreamEvent.Done("stop", null)),  // 第 2 轮立即结束（避免 max iterations）
        )
        val registry = ToolRegistry().apply { register(noopTool()) }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        val events = collect(loop, session, "go")

        val toolStart = events.filterIsInstance<AgentEvent.ToolCallStart>().single()
        // 累积后的 args 应可解析为 {"key":"foo"}
        val args = toolStart.args
        // JsonElement.toString() 对 JsonPrimitive("foo") 返回 "\"foo\""，需去引号
        val keyValue = args["key"]?.toString()?.trim('"')
        assertEquals("foo", keyValue)
    }

    // =========================================================================
    // 3. tool_result 拼回 session：1 用例
    // =========================================================================

    @Test
    fun `tool result is appended to session as role=tool message`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returnsMany listOf(
            flowOf(
                LlmStreamEvent.ToolCallDelta(0, "call_X", "noop", "{}"),
                LlmStreamEvent.Done("tool_calls", null),
            ),
            flowOf(LlmStreamEvent.Done("stop", null)),
        )
        val registry = ToolRegistry().apply { register(noopTool()) }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        collect(loop, session, "go")

        // session 应含：system, user, assistant(toolCalls), tool(result), assistant(empty/null)
        val msgs = session.messages()
        assertEquals(5, msgs.size)
        assertEquals("system", msgs[0].role)
        assertEquals("user", msgs[1].role)
        assertEquals("assistant", msgs[2].role)
        assertNotNull("assistant should have toolCalls", msgs[2].toolCalls)
        assertEquals("call_X", msgs[2].toolCalls!![0].id)
        assertEquals("tool", msgs[3].role)
        assertEquals("call_X", msgs[3].toolCallId)
        // tool 消息 content 应包含工具返回的 JSON
        val toolContent = msgs[3].content ?: ""
        assertTrue("tool content should contain ok=true, got: $toolContent", toolContent.contains("\"ok\":true"))
        assertEquals("assistant", msgs[4].role)
    }

    // =========================================================================
    // 4. 最大轮次限制：1 用例
    // =========================================================================

    @Test
    fun `exceeding max iterations emits Error max iterations exceeded`() = runBlocking {
        // M3 修复：Session 改用 Mutex 保护后，runTest 的虚拟时间调度器与 Mutex.withLock
        // 配合时会出现 UncompletedCoroutinesError（10 轮 × 多次 withLock 挂起恢复）。
        // 改用 runBlocking 在真实线程上跑，避免虚拟调度器与 Mutex 交互问题。
        val llmClient = mockk<LlmClient>()
        // 每次都返回 tool_call → 永不结束
        every { llmClient.stream(any(), any()) } returns flowOf(
            LlmStreamEvent.ToolCallDelta(0, "call_iter", "noop", "{}"),
            LlmStreamEvent.Done("tool_calls", null),
        )
        val registry = ToolRegistry().apply { register(noopTool()) }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        val events = collect(loop, session, "loop forever")

        // 期望：10 轮工具调用 + 1 个 Error("max iterations exceeded")
        val turnStarts = events.filterIsInstance<AgentEvent.TurnStart>()
        val toolStarts = events.filterIsInstance<AgentEvent.ToolCallStart>()
        val toolEnds = events.filterIsInstance<AgentEvent.ToolCallEnd>()
        val errors = events.filterIsInstance<AgentEvent.Error>()

        assertEquals("expected 10 TurnStart events", 10, turnStarts.size)
        assertEquals("expected 10 ToolCallStart events", 10, toolStarts.size)
        assertEquals("expected 10 ToolCallEnd events", 10, toolEnds.size)
        assertEquals("expected 1 Error event", 1, errors.size)
        assertEquals("max iterations exceeded", errors[0].message)
        // 不应有 TurnEnd
        assertEquals(0, events.filterIsInstance<AgentEvent.TurnEnd>().size)
    }

    // =========================================================================
    // 5. LlmStreamError 传播：1 用例
    // =========================================================================

    @Test
    fun `llm stream error propagates as AgentEvent Error and aborts loop`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returns flowOf(
            LlmStreamEvent.TextDelta("partial"),  // 已 emit 的部分文本
            LlmStreamEvent.Error(RuntimeException("network down")),
        )
        val loop = AgentLoop(llmClient, ToolRegistry())
        val session = emptySession()

        val events = collect(loop, session, "go")

        // 期望：TurnStart, TextDelta("partial"), Error
        assertTrue(events[0] is AgentEvent.TurnStart)
        assertTrue(events[1] is AgentEvent.TextDelta)
        assertEquals("partial", (events[1] as AgentEvent.TextDelta).text)
        assertTrue(events[2] is AgentEvent.Error)
        assertEquals("network down", (events[2] as AgentEvent.Error).message)

        // session 应含 system + user（assistant 未写入，因为 Error 中断了）
        // 注：AgentLoop 在 collect 结束后才 addAssistantMessage。Error 时 return@flow，
        // 不会执行 addAssistantMessage。所以 session 不含 assistant。
        val roles = session.messages().map { it.role }
        assertTrue("assistant should not be added on stream error, got: $roles",
            !roles.contains("assistant"))
    }

    // =========================================================================
    // 6. 工具执行失败 → ToolResult.error → 继续下一轮：1 用例
    // =========================================================================

    @Test
    fun `tool execution failure returns ToolResult error and continues next turn`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returnsMany listOf(
            // 第 1 轮：tool_call("boom_tool")
            flowOf(
                LlmStreamEvent.ToolCallDelta(0, "call_1", "boom_tool", "{}"),
                LlmStreamEvent.Done("tool_calls", null),
            ),
            // 第 2 轮：纯文本
            flowOf(
                LlmStreamEvent.TextDelta("recovered"),
                LlmStreamEvent.Done("stop", null),
            ),
        )
        // 注册一个会抛异常的 tool
        val registry = ToolRegistry().apply {
            register(object : Tool {
                override val definition = ToolDefinition(
                    name = "boom_tool",
                    description = "",
                    parameters = buildJsonObject { put("type", "object") },
                )
                override suspend fun execute(args: JsonObject): ToolResult =
                    throw RuntimeException("boom-bang")
            })
        }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        val events = collect(loop, session, "go")

        // 期望：第 1 轮 ToolCallEnd(success=false) + 第 2 轮 TurnEnd
        val toolEnds = events.filterIsInstance<AgentEvent.ToolCallEnd>()
        assertEquals(1, toolEnds.size)
        assertFalse("tool should fail", toolEnds[0].success)

        // 第 2 轮应继续到 TurnEnd
        assertTrue("expected TurnEnd at last", events.last() is AgentEvent.TurnEnd)

        // session 应含 tool 结果消息（content 含 error 信息）
        val toolMsg = session.messages().firstOrNull { it.role == "tool" }
        assertNotNull("expected tool message in session", toolMsg)
        val toolContent = toolMsg!!.content ?: ""
        assertTrue("tool content should contain boom-bang, got: $toolContent",
            toolContent.contains("boom-bang"))
    }

    // =========================================================================
    // 7. 流被取消时 session 不写脏数据：1 用例
    // =========================================================================

    @Test
    fun `cancelling collector does not write incomplete assistant message to session`() = runBlocking {
        val llmClient = mockk<LlmClient>()
        // 模拟慢响应：emit 部分文本后永不结束
        val slowStream: Flow<LlmStreamEvent> = flow {
            emit(LlmStreamEvent.TextDelta("partial"))
            delay(Long.MAX_VALUE)  // 永不结束
        }
        every { llmClient.stream(any(), any()) } returns slowStream
        val loop = AgentLoop(llmClient, ToolRegistry())
        val session = emptySession()

        val scope = CoroutineScope(Dispatchers.Default)
        val job = scope.async {
            loop.run(session, "go", ThinkingLevel.STANDARD, cfg).toList()
        }
        delay(300)  // 等待部分文本 emit
        job.cancelAndJoin()

        // session 应只含 system + user（assistant 未写入）
        val roles = session.messages().map { it.role }
        assertEquals(listOf("system", "user"), roles)
    }

    // =========================================================================
    // 8. TurnStart 事件：1 用例
    // =========================================================================

    @Test
    fun `TurnStart emitted at start of each turn`() = runTest {
        val llmClient = mockk<LlmClient>()
        every { llmClient.stream(any(), any()) } returnsMany listOf(
            // 第 1 轮：tool_call → 第 2 轮
            flowOf(
                LlmStreamEvent.ToolCallDelta(0, "call_1", "noop", "{}"),
                LlmStreamEvent.Done("tool_calls", null),
            ),
            // 第 2 轮：纯文本
            flowOf(
                LlmStreamEvent.TextDelta("final"),
                LlmStreamEvent.Done("stop", null),
            ),
        )
        val registry = ToolRegistry().apply { register(noopTool()) }
        val loop = AgentLoop(llmClient, registry)
        val session = emptySession()

        val events = collect(loop, session, "go")

        // 期望 2 轮，每轮开头一个 TurnStart
        val turnStartIndices = events.mapIndexedNotNull { idx, e ->
            if (e is AgentEvent.TurnStart) idx else null
        }
        assertEquals(2, turnStartIndices.size)
        // 第 1 个 TurnStart 应在事件序列开头
        assertEquals(0, turnStartIndices[0])
        // 第 2 个 TurnStart 应在第 1 轮的 ToolCallEnd 之后
        val firstToolEndIdx = events.indexOfFirst { it is AgentEvent.ToolCallEnd }
        assertTrue(
            "second TurnStart should come after first ToolCallEnd",
            turnStartIndices[1] > firstToolEndIdx
        )
    }
}
