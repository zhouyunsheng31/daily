package com.livingdashboard.ai

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 8 用例（Spec 8.1 节）：
 * - addUserMessage / addAssistantMessage / addToolResultMessage：3 用例
 * - trim 触发裁剪：1 用例
 * - trim 不触发裁剪：1 用例
 * - trim 跳过开头 tool 消息：1 用例
 * - clear 后只剩 system：1 用例
 * - systemPrompt 初始化：1 用例
 *
 * 纯 JVM 测试，不需要 Robolectric。
 */
class SessionTest {

    private fun emptyTools(): List<ToolDefinition> = emptyList()

    private fun makeSession(systemPrompt: String = "You are helpful."): Session =
        Session(systemPrompt = systemPrompt, tools = emptyTools())

    // ==================== add*Message ====================

    @Test
    fun `addUserMessage appends user message`() = runTest {
        val session = makeSession()
        session.addUserMessage("hello")
        val msgs = session.messages()
        assertEquals(2, msgs.size)
        assertEquals("system", msgs[0].role)
        assertEquals("You are helpful.", msgs[0].content)
        assertEquals("user", msgs[1].role)
        assertEquals("hello", msgs[1].content)
        assertNull(msgs[1].toolCalls)
        assertNull(msgs[1].toolCallId)
    }

    @Test
    fun `addAssistantMessage appends assistant with toolCalls`() = runTest {
        val session = makeSession()
        val toolCalls = listOf(
            ToolCall(id = "call_1", name = "list_widgets", arguments = "{}"),
        )
        session.addAssistantMessage(content = "ok", toolCalls = toolCalls)
        val msgs = session.messages()
        assertEquals(2, msgs.size)
        assertEquals("assistant", msgs[1].role)
        assertEquals("ok", msgs[1].content)
        assertEquals(1, msgs[1].toolCalls?.size)
        assertEquals("call_1", msgs[1].toolCalls!![0].id)
        assertEquals("list_widgets", msgs[1].toolCalls!![0].name)
    }

    @Test
    fun `addToolResultMessage appends tool message with toolCallId`() = runTest {
        val session = makeSession()
        session.addToolResultMessage(toolCallId = "call_1", content = """{"ok":true}""")
        val msgs = session.messages()
        assertEquals(2, msgs.size)
        assertEquals("tool", msgs[1].role)
        assertEquals("call_1", msgs[1].toolCallId)
        assertEquals("""{"ok":true}""", msgs[1].content)
    }

    // ==================== trim ====================

    @Test
    fun `trim triggers when messages exceed keepRecent plus one`() = runTest {
        val session = makeSession()
        // 1 system + 25 user = 26 条，keepRecent=20 → 触发裁剪
        repeat(25) { session.addUserMessage("msg $it") }
        assertEquals(26, session.messages().size)

        session.trim(keepRecent = 20)

        // 裁剪后：1 system + 20 user = 21 条
        assertEquals(21, session.messages().size)
        assertEquals("system", session.messages()[0].role)
        // tail 取最后 20 条：msg 5..24
        assertEquals("msg 5", session.messages()[1].content)
        assertEquals("msg 24", session.messages()[20].content)
    }

    @Test
    fun `trim does not trigger when messages within keepRecent plus one`() = runTest {
        val session = makeSession()
        // 1 system + 10 user = 11 条，keepRecent=20 → 不触发
        repeat(10) { session.addUserMessage("msg $it") }
        val before = session.messages().size

        session.trim(keepRecent = 20)

        assertEquals(before, session.messages().size)
        // 内容不变
        assertEquals("msg 0", session.messages()[1].content)
        assertEquals("msg 9", session.messages()[10].content)
    }

    @Test
    fun `trim skips leading tool messages in tail to preserve tool_call pairing`() = runTest {
        val session = makeSession()
        // 构造场景：1 system + 1 assistant(call_A) + 1 tool(call_A) + 19 user = 22 条
        // takeLast(20) 取最后 20 条：[tool(call_A), user*19] —— 头部是 tool 消息
        // 若不跳过，会裁掉对应 assistant.tool_calls，留下孤立的 tool 消息
        // 导致下一轮 LLM 报错 "tool message without matching tool_call"
        session.addAssistantMessage(
            content = null,
            toolCalls = listOf(ToolCall(id = "call_A", name = "list_widgets", arguments = "{}")),
        )
        session.addToolResultMessage(toolCallId = "call_A", content = """{"widgets":[]}""")
        repeat(19) { session.addUserMessage("user $it") }
        assertEquals(22, session.messages().size)

        session.trim(keepRecent = 20)

        // 期望：跳过 tail 头部的 tool 消息，结果为 1 system + 19 user = 20 条
        assertEquals(20, session.messages().size)
        assertEquals("system", session.messages()[0].role)
        // 第一条非 system 应该是 user，不是孤立的 tool
        assertEquals("user", session.messages()[1].role)
        // 不应再有 role=tool 的消息（孤立的 tool 已被跳过）
        assertFalse(session.messages().any { it.role == "tool" })
    }

    // ==================== clear ====================

    @Test
    fun `clear leaves only system message`() = runTest {
        val session = makeSession(systemPrompt = "You are helpful.")
        session.addUserMessage("hello")
        session.addAssistantMessage(content = "hi", toolCalls = null)
        session.addToolResultMessage(toolCallId = "x", content = "{}")
        assertEquals(4, session.messages().size)

        session.clear()

        assertEquals(1, session.messages().size)
        assertEquals("system", session.messages()[0].role)
        assertEquals("You are helpful.", session.messages()[0].content)
    }

    // ==================== systemPrompt init ====================

    @Test
    fun `session initializes with system message containing systemPrompt`() = runTest {
        val session = Session(systemPrompt = "Custom prompt.", tools = emptyTools())
        assertEquals(1, session.messages().size)
        assertEquals("system", session.messages()[0].role)
        assertEquals("Custom prompt.", session.messages()[0].content)
        // tools 字段保存原值
        assertTrue(session.tools.isEmpty())
    }
}
