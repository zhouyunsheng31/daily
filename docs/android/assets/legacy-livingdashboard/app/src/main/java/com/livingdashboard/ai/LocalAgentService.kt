package com.livingdashboard.ai

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/**
 * 本地 Agent 服务（Spec 6.4 节）。
 *
 * 整合 [LlmClient] + [AgentLoop] + [ToolRegistry] + [Session] + [SkillLoader] +
 * [PageContextProvider]，对外暴露 [sendMessage]（返回 Flow<AgentEvent>，UI 流式收集）。
 *
 * 实现 [AgentService] 接口，由 AgentService 路由层（CanvasHomeViewModel）根据
 * [RuntimeModeManager.state.value.effectiveMode] 决定走 Local 还是 Cloud。
 *
 * C7 修复：`sessions` 改用 [ConcurrentHashMap]（M8 原为普通 HashMap，多 ViewModel 并发访问不安全）。
 *
 * 代码 C2 修复：`buildSystemPrompt()` 拆为非 suspend 部分（基础 + skills，by lazy 缓存）
 * + suspend 部分（页面上下文，每次 sendMessage 时取）。[PageContextProvider.getCurrentContext]
 * 是 suspend，不在 `buildSystemPrompt()` 内调用，而是 sendMessage flow 内调用后拼接到
 * `cachedSystemPrompt`。
 *
 * Session 缓存：
 * - skills + systemPrompt 在首次使用时 lazy 加载（避免 App 启动扫 assets 阻塞）
 * - sessions Map 按 panelId 隔离，每面板独立上下文
 * - [disposeSession] 在面板删除 / ViewModel onCleared 时调用
 *
 * @param llmClient LLM 流式客户端（注入单例，testConnection 复用）
 * @param agentLoop Agent 核心循环
 * @param toolRegistry 工具注册表
 * @param apiKeyStore API Key 加密存储
 * @param skillLoader 本地 skills 加载器（扫 assets/pi/skills/）
 * @param runtimeModeManager 运行时模式管理器（CLOUD/LOCAL/AUTO + 离线降级）
 * @param okHttpClient OkHttpClient（保留参数，与 Spec 一致；testConnection 用 llmClient 内部持有的 client）
 * @param pageContextProvider M3 新增：页面上下文提供者（注入活跃 WebView 上下文到 system prompt）
 */
class LocalAgentService(
    private val llmClient: LlmClient,
    private val agentLoop: AgentLoop,
    private val toolRegistry: ToolRegistry,
    private val apiKeyStore: ApiKeyStore,
    private val skillLoader: SkillLoader,
    private val runtimeModeManager: RuntimeModeManager,
    @Suppress("unused") private val okHttpClient: okhttp3.OkHttpClient,
    private val pageContextProvider: PageContextProvider,
) : AgentService {

    /** C7 修复：panelId -> Session（每面板独立上下文，线程安全） */
    private val sessions = ConcurrentHashMap<String, Session>()

    /** 已加载的 skills（首次访问时扫描 assets，缓存避免重复 IO） */
    private val cachedSkills by lazy { skillLoader.loadAll() }

    /** 拼好的 system prompt（base + skills 附录，首次访问时构建） */
    private val cachedSystemPrompt by lazy { buildSystemPrompt() }

    /**
     * 发送消息到指定面板的本地 agent（Spec 6.4 节）。
     *
     * 流程：
     * 1. 取 activeProvider + config：任一为空 emit Error（可恢复，UI 提示去配置）
     * 2. getOrPut Session(panelId)：首次发消息时构建 systemPrompt + tools
     * 3. 代码 C2：取页面上下文（suspend）拼接成动态 system prompt，调 session.updateSystemPrompt
     * 4. 构建 [LlmClientConfig]（含 model，从 config 取）
     * 5. 调 [AgentLoop.run] 返回 Flow，collect 后透传给 UI
     * 6. 流结束后调 session.trim(keepRecent=20) 控制上下文长度
     */
    override fun sendMessage(
        panelId: String,
        userMessage: String,
        thinkingLevel: ThinkingLevel,
    ): Flow<AgentEvent> = flow {
        // 1. 取 active provider + config
        val activeProvider = apiKeyStore.getActiveProvider() ?: run {
            Log.e("LocalAgentService", "sendMessage: no active provider configured")
            emit(AgentEvent.Error("未配置 active provider，请到设置 → AI 配置中切换", true))
            return@flow
        }
        val config = apiKeyStore.getConfig(activeProvider) ?: run {
            Log.e("LocalAgentService", "sendMessage: no config for provider=$activeProvider")
            emit(AgentEvent.Error("未配置 API Key，请到设置 → AI 配置中配置", true))
            return@flow
        }
        Log.d("LocalAgentService", "sendMessage: provider=$activeProvider, endpoint=${config.endpoint}, model=${config.model}, panelId=$panelId")

        // 2. getOrPut Session（C7：computeIfAbsent 线程安全，首次发消息时构建）
        val session = sessions.computeIfAbsent(panelId) {
            Session(
                systemPrompt = cachedSystemPrompt,
                tools = toolRegistry.listDefinitions(),
            )
        }

        // 3. 代码 C2：取页面上下文（suspend），拼接成动态 system prompt
        val pageContext = pageContextProvider.getCurrentContext()
        val dynamicSystemPrompt = if (pageContext != null) {
            buildString {
                append(cachedSystemPrompt)
                append("\n\n## 当前浏览器上下文\n")
                append("- URL: ${pageContext.url}\n")
                if (pageContext.title.isNotBlank()) append("- 标题: ${pageContext.title}\n")
                append("用户可能基于此页面提问或要求操作。\n")
            }
        } else {
            cachedSystemPrompt
        }
        session.updateSystemPrompt(dynamicSystemPrompt)

        // 4. 构建 LlmClientConfig（含 model 字段，AgentLoop.run 内部用它构建 LlmRequest）
        val llmConfig = LlmClientConfig(
            endpoint = config.endpoint,
            apiKey = config.apiKey,
            provider = config.provider,
            model = config.model,
        )

        // 5. 启动 agent 循环，透传事件给 UI
        agentLoop.run(session, userMessage, thinkingLevel, llmConfig).collect { event ->
            emit(event)
        }

        // 6. 流结束后裁剪上下文（防 token 超限）
        session.trim(keepRecent = 20)
    }

    /**
     * 销毁指定面板的 Session（Spec 行 1394）。
     *
     * 调用时机：
     * - CanvasHomeViewModel.onPanelDeleted：面板删除时
     * - CanvasHomeViewModel.onCleared：ViewModel 销毁时
     */
    override fun disposeSession(panelId: String) {
        sessions.remove(panelId)
    }

    /**
     * 测试连接（Spec 行 1399-1411）。
     *
     * 用给定配置调一次 LLM（max_tokens=16），收到首个 [LlmStreamEvent.TextDelta] 即认为成功。
     * 用 [Dispatchers.IO] 切到 IO 线程，避免阻塞调用方（通常在 ViewModel 协程中调用）。
     */
    override suspend fun testConnection(config: LlmProviderConfig): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = LlmRequest(
                provider = config.provider,
                model = config.model,
                messages = listOf(LlmMessage(role = "user", content = "ping")),
                maxTokens = 16,
            )
            val llmConfig = LlmClientConfig(
                endpoint = config.endpoint,
                apiKey = config.apiKey,
                provider = config.provider,
                model = config.model,
            )
            llmClient.stream(request, llmConfig).firstOrNull { it is LlmStreamEvent.TextDelta } != null
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 构建完整 system prompt（Spec 行 1413-1416）。
     *
     * = SYSTEM_PROMPT_BASE + skillLoader.buildSystemPromptAppendix(cachedSkills)
     *
     * 非suspend：仅构建基础 system prompt（不含页面上下文，页面上下文在 sendMessage flow 内动态拼接）。
     */
    private fun buildSystemPrompt(): String = buildString {
        append(SYSTEM_PROMPT_BASE)
        append(skillLoader.buildSystemPromptAppendix(cachedSkills))
    }

    companion object {
        /**
         * 基础系统提示词（Spec 行 1419-1426）。
         */
        private val SYSTEM_PROMPT_BASE = """
            你是 Living Dashboard 移动端的 AI 助手。你可以通过工具操作画布组件、读写本地存储、操作浏览器。
            - 用户在画布主页与你对话
            - 每个面板的对话独立
            - 你可以创建/更新/删除 HTML 组件
            - 你可以操作当前活跃的浏览器（执行 JS、导航）
            - 回答要简洁、专业、友好
        """.trimIndent()
    }
}
