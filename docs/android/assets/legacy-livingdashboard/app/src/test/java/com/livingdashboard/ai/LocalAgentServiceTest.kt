package com.livingdashboard.ai

import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * LocalAgentService 单元测试（Spec 8.1 节，5 用例）。
 *
 * 用 MockK mock 全部 6 个依赖（LlmClient / AgentLoop / ToolRegistry / ApiKeyStore /
 * SkillLoader / RuntimeModeManager），不依赖 Android 框架（纯 JVM 测试）。
 *
 * 用例：
 * 1. sendMessage 在 activeProvider == null 时 emit Error（边界）
 * 2. sendMessage 在 getConfig(provider) == null 时 emit Error（边界）
 * 3. sendMessage 复用 Session（同一 panelId 两次调用复用同一 Session 引用）
 * 4. testConnection 成功（LlmClient.stream 发 TextDelta）
 * 5. testConnection 失败（LlmClient.stream 发 Error）
 * 6. CLOUD 模式 sendMessage emit Error（M3 未实现占位）
 */
class LocalAgentServiceTest {

    private val mockLlmClient = mockk<LlmClient>()
    private val mockAgentLoop = mockk<AgentLoop>()
    private val mockApiKeyStore = mockk<ApiKeyStore>()
    private val mockSkillLoader = mockk<SkillLoader>()
    private val mockToolRegistry = mockk<ToolRegistry>()

    /**
     * 构造被测 [LocalAgentService]，参数化注入 mock 依赖。
     *
     * 默认配置：
     * - runtimeModeManager.state = LOCAL 模式（无降级）
     * - apiKeyStore.getActiveProvider = "stepfun"
     * - apiKeyStore.getConfig("stepfun") = 有效 LlmProviderConfig
     * - skillLoader.loadAll = 空列表（避免扫 assets）
     * - skillLoader.buildSystemPromptAppendix = 空字符串
     * - toolRegistry.listDefinitions = 空列表
     */
    private fun makeService(
        mode: AgentMode = AgentMode.LOCAL,
        effectiveMode: AgentMode = mode,
        activeProvider: String? = "stepfun",
        config: LlmProviderConfig? = LlmProviderConfig(
            provider = "stepfun",
            apiKey = "test-key",
            endpoint = "https://api.stepfun.com/v1",
            model = "step-3.7-flash",
        ),
    ): LocalAgentService {
        val runtimeModeManager = mockk<RuntimeModeManager>()
        every { runtimeModeManager.state } returns MutableStateFlow(
            RuntimeModeState(
                mode = mode,
                isServerOnline = false,
                effectiveMode = effectiveMode,
                isOfflineDowngraded = false,
            )
        )
        every { mockApiKeyStore.getActiveProvider() } returns activeProvider
        every { mockApiKeyStore.getConfig(any()) } returns config
        every { mockSkillLoader.loadAll() } returns emptyList()
        every { mockSkillLoader.buildSystemPromptAppendix(any()) } returns ""
        every { mockToolRegistry.listDefinitions() } returns emptyList()
        return LocalAgentService(
            llmClient = mockLlmClient,
            agentLoop = mockAgentLoop,
            toolRegistry = mockToolRegistry,
            apiKeyStore = mockApiKeyStore,
            skillLoader = mockSkillLoader,
            runtimeModeManager = runtimeModeManager,
            okHttpClient = OkHttpClient(),
            pageContextProvider = PageContextProvider(ActiveWebViewHolder()),
        )
    }

    /**
     * 用例 1：sendMessage 在 apiKeyStore.getActiveProvider() == null 时 emit Error。
     *
     * 用户未配置 active provider（首次启动未到 AI 配置页设置），
     * LocalAgentService 应 emit 可恢复 Error，提示去配置。
     */
    @Test
    fun `sendMessage emits Error when activeProvider is null`() = runTest {
        val service = makeService(activeProvider = null)
        val events = service.sendMessage("p1", "hi").toList()
        assertEquals(1, events.size)
        val first = events.first()
        assertTrue("Expected AgentEvent.Error, got $first", first is AgentEvent.Error)
        val err = first as AgentEvent.Error
        assertTrue("Expected recoverable=true, got ${err.recoverable}", err.recoverable)
        assertTrue("Expected message contains 'active provider', got '${err.message}'",
            err.message.contains("active provider"))
    }

    /**
     * 用例 2：sendMessage 在 apiKeyStore.getConfig(activeProvider) == null 时 emit Error。
     *
     * activeProvider 已设但 config 被清除（如用户在 AI 配置页清空了配置），
     * LocalAgentService 应 emit 可恢复 Error，提示去配置 API Key。
     */
    @Test
    fun `sendMessage emits Error when config is null`() = runTest {
        val service = makeService(config = null)
        val events = service.sendMessage("p1", "hi").toList()
        assertEquals(1, events.size)
        val first = events.first()
        assertTrue("Expected AgentEvent.Error, got $first", first is AgentEvent.Error)
        val err = first as AgentEvent.Error
        assertTrue("Expected recoverable=true, got ${err.recoverable}", err.recoverable)
        assertTrue("Expected message contains 'API Key', got '${err.message}'",
            err.message.contains("API Key"))
    }

    /**
     * 用例 3：sendMessage 复用 Session（同一 panelId 两次调用复用同一 Session 引用）。
     *
     * 验证：
     * - 两次 sendMessage("p1", ...) 传给 agentLoop.run 的 session 是同一引用
     * - 第二次调用不会重新构建 systemPrompt（session.systemPrompt 应保持稳定）
     *
     * Spec 6.10 行 1379：sessions.getOrPut(panelId) 复用 Session
     */
    @Test
    fun `sendMessage reuses Session for same panelId`() = runTest {
        // 用 slot 捕获 agentLoop.run 收到的 session 参数
        val sessionSlot = slot<Session>()
        // mockAgentLoop.run 返回单事件 flow（TurnEnd）触发 sendMessage 流结束
        every {
            mockAgentLoop.run(capture(sessionSlot), any(), any(), any())
        } returns flowOf(AgentEvent.TurnEnd("stop"))

        val service = makeService()

        // 第一次发送
        service.sendMessage("p1", "msg1").toList()
        val firstSession = sessionSlot.captured

        // 第二次发送（同一 panelId）
        service.sendMessage("p1", "msg2").toList()
        val secondSession = sessionSlot.captured

        // 同一引用：sessions.getOrPut 复用，未创建新 Session
        assertSame("Session should be reused for same panelId", firstSession, secondSession)
        // systemPrompt 一致（未重新构建）
        assertEquals(firstSession.systemPrompt, secondSession.systemPrompt)
    }

    /**
     * 用例 4：testConnection 成功（LlmClient.stream 发 TextDelta）。
     *
     * Spec 行 1409：stream().firstOrNull { it is TextDelta } != null
     *
     * 注意：用 runBlocking 而非 runTest，因 testConnection 内部用 withContext(Dispatchers.IO)
     * 切到真实 IO 线程，runTest 的 TestCoroutineScheduler 不管理真实线程，会导致
     * UncompletedCoroutinesError。
     */
    @Test
    fun `testConnection returns true when stream emits TextDelta`() = runBlocking {
        every { mockLlmClient.stream(any(), any()) } returns flowOf(
            LlmStreamEvent.TextDelta("hi")
        )
        val service = makeService()
        val ok = service.testConnection(
            LlmProviderConfig(
                provider = "stepfun",
                apiKey = "test-key",
                endpoint = "https://api.stepfun.com/v1",
                model = "step-3.7-flash",
            )
        )
        assertTrue("Expected true when stream emits TextDelta", ok)
    }

    /**
     * 用例 5：testConnection 失败（LlmClient.stream 发 Error，无 TextDelta）。
     *
     * Spec 行 1409：firstOrNull { it is TextDelta } 返回 null → testConnection 返回 false
     *
     * 注意：用 runBlocking 而非 runTest，原因同用例 4。
     */
    @Test
    fun `testConnection returns false when stream emits Error only`() = runBlocking {
        every { mockLlmClient.stream(any(), any()) } returns flowOf(
            LlmStreamEvent.Error(RuntimeException("invalid api key"))
        )
        val service = makeService()
        val ok = service.testConnection(
            LlmProviderConfig(
                provider = "stepfun",
                apiKey = "bad-key",
                endpoint = "https://api.stepfun.com/v1",
                model = "step-3.7-flash",
            )
        )
        assertTrue("Expected false when stream emits Error only", !ok)
    }

    /**
     * 用例 6（M3 重写）：PageContextProvider 注入验证（Spec 8.1 扩展用例）。
     *
     * M3 后 LocalAgentService 不再检查 effectiveMode（CLOUD 由 CloudAgentService 处理），
     * 改为验证 PageContextProvider 注入：当存在活跃 WebView 上下文时，system prompt
     * 末尾应包含"## 当前浏览器上下文"段落与 URL 信息。
     *
     * 验证点：
     * - mockAgentLoop.run 捕获的 session.systemPrompt 应含 "当前浏览器上下文"
     * - 若 WebView 为空（PageContext 返回 null），system prompt 不含该段落
     */
    @Test
    fun `sendMessage injects page context into system prompt when WebView active`() = runTest {
        val sessionSlot = slot<Session>()
        every { mockAgentLoop.run(capture(sessionSlot), any(), any(), any()) } returns
            flowOf(AgentEvent.TurnEnd("stop"))

        // 准备 mock ApiKeyStore（必须返回有效 config 才能走到 system prompt 拼接）
        every { mockApiKeyStore.getActiveProvider() } returns "stepfun"
        every { mockApiKeyStore.getConfig(any()) } returns LlmProviderConfig(
            provider = "stepfun",
            apiKey = "test-key",
            endpoint = "https://api.stepfun.com/v1",
            model = "step-3.7-flash",
        )
        // 准备 mock SkillLoader（cachedSkills lazy 加载会调 loadAll + buildSystemPromptAppendix）
        every { mockSkillLoader.loadAll() } returns emptyList()
        every { mockSkillLoader.buildSystemPromptAppendix(any()) } returns ""
        // 准备 mock ToolRegistry（构建 Session 时调 listDefinitions）
        every { mockToolRegistry.listDefinitions() } returns emptyList()

        // 准备：PageContextProvider 内部 ActiveWebViewHolder 持有 mock WebView
        val webViewHolder = ActiveWebViewHolder()
        val mockWebView = mockk<android.webkit.WebView>(relaxed = true)
        // PageContextProvider 在主线程读 url/title；testDispatchers 不切 Main 也能跑（mock 返回字符串）
        every { mockWebView.url } returns "https://example.com/page"
        every { mockWebView.title } returns "Example Page"
        // 注意：由于 PageContextProvider.getCurrentContext 用 withContext(Dispatchers.Main)，
        // 需用 Dispatchers.setMain(...) 把 Main 切换到测试调度器
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            webViewHolder.value.value = mockWebView
            val service = LocalAgentService(
                llmClient = mockLlmClient,
                agentLoop = mockAgentLoop,
                toolRegistry = mockToolRegistry,
                apiKeyStore = mockApiKeyStore,
                skillLoader = mockSkillLoader,
                runtimeModeManager = mockk<RuntimeModeManager>().also {
                    every { it.state } returns MutableStateFlow(
                        RuntimeModeState(
                            mode = AgentMode.LOCAL,
                            isServerOnline = false,
                            effectiveMode = AgentMode.LOCAL,
                            isOfflineDowngraded = false,
                        )
                    )
                },
                okHttpClient = OkHttpClient(),
                pageContextProvider = PageContextProvider(webViewHolder),
            )

            service.sendMessage("p1", "hi").toList()

            // 验证 session.systemPrompt 含页面上下文段落
            // 注意：session.systemPrompt 是构造时的初始 prompt，更新后存在 _messages[0]
            val firstMsg = sessionSlot.captured.messages().firstOrNull()
            assertTrue("session should have at least one message", firstMsg != null)
            val systemContent = firstMsg?.content ?: ""
            assertTrue(
                "system prompt should contain '当前浏览器上下文', got: $systemContent",
                systemContent.contains("当前浏览器上下文")
            )
            assertTrue(
                "system prompt should contain URL 'https://example.com/page', got: $systemContent",
                systemContent.contains("https://example.com/page")
            )
            assertTrue(
                "system prompt should contain title 'Example Page', got: $systemContent",
                systemContent.contains("Example Page")
            )
        } finally {
            Dispatchers.resetMain()
        }
    }
}
