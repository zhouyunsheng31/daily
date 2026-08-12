package com.livingdashboard.ai

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * 23 用例（Spec 8.1 节）：
 * - SSE 基础解析（data/[DONE]/keep-alive）：3
 * - 5 OpenAI 兼容 provider URL 构建分支：5
 * - OpenAI 兼容 Bearer + Anthropic x-api-key Header：3
 * - tool_calls 分片累积：3
 * - reasoning_content（DeepSeek）+ thinking（Qwen）：2
 * - 错误处理（4xx/5xx/超时/不完整 SSE）：4
 * - 取消：1
 * - Anthropic SSE 解析：2
 *
 * 用 MockWebServer（loopback 真实 HTTP）。runBlocking 收集 Flow。
 */
class LlmClientTest {

    private lateinit var server: MockWebServer

    @Before
    fun setup() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun newClient(readTimeoutMs: Long = 30_000): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    private fun defaultReq(provider: String = "stepfun"): LlmRequest = LlmRequest(
        provider = provider,
        model = "test-model",
        messages = listOf(LlmMessage(role = "user", content = "hi")),
    )

    private fun defaultConfig(provider: String, endpoint: String, apiKey: String = "test-key"): LlmClientConfig =
        LlmClientConfig(endpoint = endpoint, apiKey = apiKey, provider = provider, model = "test-model")

    private fun collect(client: LlmClient, req: LlmRequest, cfg: LlmClientConfig): List<LlmStreamEvent> =
        runBlocking { client.stream(req, cfg).toList() }

    // =========================================================================
    // 1. SSE 基础解析（data/[DONE]/keep-alive）：3 用例
    // =========================================================================

    @Test
    fun `parses single data line and DONE`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))

        // 期望：TextDelta("Hello") + Done
        assertEquals(2, events.size)
        assertTrue(events[0] is LlmStreamEvent.TextDelta)
        assertEquals("Hello", (events[0] as LlmStreamEvent.TextDelta).text)
        assertTrue(events[1] is LlmStreamEvent.Done)
    }

    @Test
    fun `parses multiple data lines and DONE`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n" +
                    "data: [\"final\"]\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))

        // 至少有 2 个 TextDelta + 1 个 Done
        val textDeltas = events.filterIsInstance<LlmStreamEvent.TextDelta>()
        assertTrue("expected >=2 text deltas, got ${textDeltas.size}", textDeltas.size >= 2)
        assertEquals("Hello", textDeltas[0].text)
        assertEquals(" world", textDeltas[1].text)
        assertTrue(events.last() is LlmStreamEvent.Done)
    }

    @Test
    fun `ignores keep-alive comment lines starting with colon`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                ": keep-alive comment\n" +
                    "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n" +
                    ": another comment\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))

        // 期望：1 个 TextDelta("x") + 1 个 Done，注释行被忽略
        val textDeltas = events.filterIsInstance<LlmStreamEvent.TextDelta>()
        assertEquals(1, textDeltas.size)
        assertEquals("x", textDeltas[0].text)
        assertTrue(events.last() is LlmStreamEvent.Done)
        // 不应有 Error
        assertTrue(events.none { it is LlmStreamEvent.Error })
    }

    // =========================================================================
    // 2. 5 OpenAI 兼容 provider URL 构建分支：5 用例
    //    - stepfun: endpoint 以 /chat/completions 结尾 → 直接用
    //    - openai: endpoint 以 /v1 结尾 → 追加 /chat/completions
    //    - deepseek: endpoint 以 /v2 结尾 → 追加 /chat/completions
    //    - qwen: endpoint 不带 / 结尾 → 追加 /v1/chat/completions
    //    - gemini: endpoint 带 / 结尾 → trimEnd 后追加 /v1/chat/completions
    // =========================================================================

    @Test
    fun `stepfun endpoint ending with chat_completions is used as-is`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "stepfun"),
            defaultConfig("stepfun", server.url("/v1/chat/completions").toString())
        )
        val recorded = server.takeRequest()
        // 路径应为 /v1/chat/completions（无重复追加）
        assertEquals("/v1/chat/completions", recorded.path)
    }

    @Test
    fun `openai endpoint ending with v1 appends chat_completions`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "openai"),
            defaultConfig("openai", server.url("/v1").toString())
        )
        val recorded = server.takeRequest()
        // 路径应为 /v1/chat/completions
        assertEquals("/v1/chat/completions", recorded.path)
    }

    @Test
    fun `deepseek endpoint ending with v2 appends chat_completions`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "deepseek"),
            defaultConfig("deepseek", server.url("/v2").toString())
        )
        val recorded = server.takeRequest()
        // 路径应为 /v2/chat/completions
        assertEquals("/v2/chat/completions", recorded.path)
    }

    @Test
    fun `qwen endpoint without trailing slash appends v1_chat_completions`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "qwen"),
            defaultConfig("qwen", server.url("/api").toString())
        )
        val recorded = server.takeRequest()
        // 路径应为 /api/v1/chat/completions
        assertEquals("/api/v1/chat/completions", recorded.path)
    }

    @Test
    fun `gemini endpoint with trailing slash trims then appends v1_chat_completions`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "gemini"),
            defaultConfig("gemini", server.url("/api/").toString())
        )
        val recorded = server.takeRequest()
        // 路径应为 /api/v1/chat/completions（trimEnd('/') 后追加）
        assertEquals("/api/v1/chat/completions", recorded.path)
    }

    // =========================================================================
    // 3. Header 差异（OpenAI 兼容 Bearer + Anthropic x-api-key）：3 用例
    // =========================================================================

    @Test
    fun `stepfun sends Authorization Bearer header`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "stepfun"),
            defaultConfig("stepfun", server.url("/v1").toString(), apiKey = "sk-step-xxx")
        )
        val recorded = server.takeRequest()
        assertEquals("Bearer sk-step-xxx", recorded.getHeader("Authorization"))
        // 不应有 x-api-key
        assertEquals(null, recorded.getHeader("x-api-key"))
    }

    @Test
    fun `anthropic sends x-api-key and anthropic-version headers without Bearer`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "event: message_stop\n" + "data: {\"type\":\"message_stop\"}\n\n"
            )
        )
        val client = LlmClient(newClient())
        collect(
            client,
            defaultReq(provider = "anthropic"),
            defaultConfig("anthropic", server.url("/v1").toString(), apiKey = "sk-ant-xxx")
        )
        val recorded = server.takeRequest()
        assertEquals("sk-ant-xxx", recorded.getHeader("x-api-key"))
        assertEquals("2023-06-01", recorded.getHeader("anthropic-version"))
        // 不应有 Authorization Bearer
        assertEquals(null, recorded.getHeader("Authorization"))
        // 路径应为 /v1/messages
        assertEquals("/v1/messages", recorded.path)
    }

    @Test
    fun `deepseek and qwen all use Bearer header for OpenAI compatible path`() {
        // 用 deepseek + qwen 各发一次请求，校验都走 Bearer Header
        for (provider in listOf("deepseek", "qwen")) {
            server.enqueue(
                MockResponse().setHeader("Content-Type", "text/event-stream").setBody("data: [DONE]\n\n")
            )
            val client = LlmClient(newClient())
            collect(
                client,
                defaultReq(provider = provider),
                defaultConfig(provider, server.url("/v1").toString(), apiKey = "sk-$provider")
            )
            val recorded = server.takeRequest()
            assertEquals("Bearer sk-$provider", recorded.getHeader("Authorization"))
            assertEquals(null, recorded.getHeader("x-api-key"))
        }
    }

    // =========================================================================
    // 4. tool_calls 分片累积：3 用例
    // =========================================================================

    @Test
    fun `single tool_call in single chunk`() {
        // 一个 chunk 完整返回 tool_call（id + name + arguments）
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"list_widgets\",\"arguments\":\"{}\"}}]}}]}\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        val toolDeltas = events.filterIsInstance<LlmStreamEvent.ToolCallDelta>()
        assertEquals(1, toolDeltas.size)
        assertEquals(0, toolDeltas[0].index)
        assertEquals("call_1", toolDeltas[0].id)
        assertEquals("list_widgets", toolDeltas[0].name)
        assertEquals("{}", toolDeltas[0].argsDelta)
        assertTrue(events.last() is LlmStreamEvent.Done)
    }

    @Test
    fun `single tool_call across multiple chunks accumulates arguments`() {
        // 第 1 个 chunk：id + name
        // 第 2-N 个 chunk：arguments 分片
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"storage_write\",\"arguments\":\"{\\\"key\\\":\\\"\"}}]}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"foo\"}}]}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\",\\\"value\\\":\\\"bar\\\"}\"}}]}}]}\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        val toolDeltas = events.filterIsInstance<LlmStreamEvent.ToolCallDelta>()
        // 期望 3 个 delta（每个 chunk 1 个）
        assertEquals(3, toolDeltas.size)
        // 累积后的完整 arguments：
        val accumulated = toolDeltas.joinToString("") { it.argsDelta ?: "" }
        assertEquals("""{"key":"foo","value":"bar"}""", accumulated)
        // 第 1 个 delta 含 id + name
        assertEquals("call_1", toolDeltas[0].id)
        assertEquals("storage_write", toolDeltas[0].name)
        // 后续 delta 的 id/name 为 null
        assertEquals(null, toolDeltas[1].id)
        assertEquals(null, toolDeltas[2].id)
    }

    @Test
    fun `multiple tool_calls with different indices are accumulated separately`() {
        // 两个 tool_call（index=0 和 index=1）交织返回
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"function\":{\"name\":\"list_widgets\",\"arguments\":\"{}\"}}]}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"call_b\",\"function\":{\"name\":\"storage_read\",\"arguments\":\"{}\"}}]}}]}\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        val toolDeltas = events.filterIsInstance<LlmStreamEvent.ToolCallDelta>()
        assertEquals(2, toolDeltas.size)
        // 按 index 分组
        val byIndex = toolDeltas.groupBy { it.index }
        assertEquals(setOf(0, 1), byIndex.keys)
        assertEquals("call_a", byIndex[0]!![0].id)
        assertEquals("list_widgets", byIndex[0]!![0].name)
        assertEquals("call_b", byIndex[1]!![0].id)
        assertEquals("storage_read", byIndex[1]!![0].name)
    }

    // =========================================================================
    // 5. reasoning_content（DeepSeek）+ thinking（Qwen）：2 用例
    // =========================================================================

    @Test
    fun `deepseek reasoning_content emits ThinkingDelta`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"thinking...\"}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(
            client,
            defaultReq(provider = "deepseek"),
            defaultConfig("deepseek", server.url("/v1").toString())
        )
        val thinkingDeltas = events.filterIsInstance<LlmStreamEvent.ThinkingDelta>()
        assertEquals(1, thinkingDeltas.size)
        assertEquals("thinking...", thinkingDeltas[0].text)
        val textDeltas = events.filterIsInstance<LlmStreamEvent.TextDelta>()
        assertEquals(1, textDeltas.size)
        assertEquals("answer", textDeltas[0].text)
    }

    @Test
    fun `qwen thinking field emits ThinkingDelta`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"thinking\":\"qwen-thought\"}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":{\"content\":\"reply\"}}]}\n\n" +
                    "data: [DONE]\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(
            client,
            defaultReq(provider = "qwen"),
            defaultConfig("qwen", server.url("/v1").toString())
        )
        val thinkingDeltas = events.filterIsInstance<LlmStreamEvent.ThinkingDelta>()
        assertEquals(1, thinkingDeltas.size)
        assertEquals("qwen-thought", thinkingDeltas[0].text)
        val textDeltas = events.filterIsInstance<LlmStreamEvent.TextDelta>()
        assertEquals(1, textDeltas.size)
        assertEquals("reply", textDeltas[0].text)
    }

    // =========================================================================
    // 6. 错误处理（4xx/5xx/超时/不完整 SSE）：4 用例
    // =========================================================================

    @Test
    fun `401 emits Error with api key message`() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"invalid api key"}"""))
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        val errors = events.filterIsInstance<LlmStreamEvent.Error>()
        assertEquals(1, errors.size)
        val msg = errors[0].throwable.message ?: ""
        assertTrue("expected API Key error message, got: $msg", msg.contains("API Key"))
    }

    @Test
    fun `500 emits Error with server error message`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("internal server error"))
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        val errors = events.filterIsInstance<LlmStreamEvent.Error>()
        assertEquals(1, errors.size)
        val msg = errors[0].throwable.message ?: ""
        assertTrue("expected '服务器错误' in message, got: $msg", msg.contains("服务器错误"))
    }

    @Test
    fun `read timeout emits Error`() {
        // body delay 5s，client readTimeout=500ms → 触发 readTimeout
        server.enqueue(
            MockResponse().setBodyDelay(5, TimeUnit.SECONDS).setBody("data: ...").setHeader("Content-Type", "text/event-stream")
        )
        val client = LlmClient(newClient(readTimeoutMs = 500))
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        val errors = events.filterIsInstance<LlmStreamEvent.Error>()
        assertEquals(1, errors.size)
    }

    @Test
    fun `incomplete SSE chunk does not emit Error and stream ends with Done`() {
        // data: {partial 之后流自然结束（无 [DONE]）
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n" +
                    "data: {\"choices\":[{\"delta\":"  // 不完整 JSON
            )
        )
        val client = LlmClient(newClient())
        val events = collect(client, defaultReq(), defaultConfig("stepfun", server.url("/v1").toString()))
        // 应该 emit 1 个 TextDelta("ok") + Done（不完整 chunk 被跳过，不 emit Error）
        val textDeltas = events.filterIsInstance<LlmStreamEvent.TextDelta>()
        assertEquals(1, textDeltas.size)
        assertEquals("ok", textDeltas[0].text)
        assertTrue("stream should end with Done", events.last() is LlmStreamEvent.Done)
        // 不应有 Error
        assertFalse("should not emit Error on incomplete chunk", events.any { it is LlmStreamEvent.Error })
    }

    // =========================================================================
    // 7. 取消：1 用例
    // =========================================================================

    @Test
    fun `cancelling collector cancels underlying OkHttp call`() = runBlocking {
        // body delay 5s，client readTimeout=30s（让 cancel 早于 timeout）
        server.enqueue(
            MockResponse().setBodyDelay(5, TimeUnit.SECONDS).setBody("data: ...").setHeader("Content-Type", "text/event-stream")
        )
        val client = LlmClient(newClient(readTimeoutMs = 30_000))
        val cfg = defaultConfig("stepfun", server.url("/v1").toString())

        val job = CoroutineScope(Dispatchers.IO).async {
            client.stream(defaultReq(), cfg).toList()
        }
        // 等待连接建立 + 读取开始
        delay(200)
        job.cancelAndJoin()
        // 验证 job 已取消（不抛异常）
        assertTrue("job should be cancelled", job.isCancelled)
        // takeRequest 不阻塞：请求已被发送
        val recorded = server.takeRequest()
        assertNotNull(recorded)
    }

    // =========================================================================
    // 8. Anthropic SSE 解析（event+data 双行）：2 用例
    // =========================================================================

    @Test
    fun `anthropic content_block_delta text_delta emits TextDelta`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "event: message_start\n" +
                    "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\"}}\n\n" +
                    "event: content_block_start\n" +
                    "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
                    "event: content_block_delta\n" +
                    "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n" +
                    "event: content_block_delta\n" +
                    "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n" +
                    "event: content_block_stop\n" +
                    "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n" +
                    "event: message_delta\n" +
                    "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\n" +
                    "event: message_stop\n" +
                    "data: {\"type\":\"message_stop\"}\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(
            client,
            defaultReq(provider = "anthropic"),
            defaultConfig("anthropic", server.url("/v1").toString())
        )
        val textDeltas = events.filterIsInstance<LlmStreamEvent.TextDelta>()
        assertEquals(2, textDeltas.size)
        assertEquals("Hello", textDeltas[0].text)
        assertEquals(" world", textDeltas[1].text)
        // 期望最后一个事件是 Done
        assertTrue(events.last() is LlmStreamEvent.Done)
        // finishReason 应映射为 "stop"（end_turn → stop）
        val done = events.last() as LlmStreamEvent.Done
        assertEquals("stop", done.finishReason)
    }

    @Test
    fun `anthropic tool_use content_block emits ToolCallDelta`() {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "event: content_block_start\n" +
                    "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"list_widgets\",\"input\":{}}}\n\n" +
                    "event: content_block_delta\n" +
                    "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n" +
                    "event: content_block_stop\n" +
                    "data: {\"type\":\"content_block_stop\",\"index\":1}\n\n" +
                    "event: message_stop\n" +
                    "data: {\"type\":\"message_stop\"}\n\n"
            )
        )
        val client = LlmClient(newClient())
        val events = collect(
            client,
            defaultReq(provider = "anthropic"),
            defaultConfig("anthropic", server.url("/v1").toString())
        )
        val toolDeltas = events.filterIsInstance<LlmStreamEvent.ToolCallDelta>()
        // 期望：content_block_start 提供 id+name，content_block_delta 提供 partial_json
        assertTrue("expected >=1 tool delta", toolDeltas.isNotEmpty())
        val first = toolDeltas[0]
        assertEquals(1, first.index)
        // id + name 应在 content_block_start 中已 emit
        val withId = toolDeltas.firstOrNull { it.id == "call_1" }
        assertNotNull("expected delta with id=call_1", withId)
        val withName = toolDeltas.firstOrNull { it.name == "list_widgets" }
        assertNotNull("expected delta with name=list_widgets", withName)
        // 至少一个 delta 含 argsDelta（input_json_delta）
        assertTrue(
            "expected at least one delta with argsDelta",
            toolDeltas.any { !it.argsDelta.isNullOrEmpty() }
        )
        // 期望 Done
        assertTrue(events.last() is LlmStreamEvent.Done)
    }
}
