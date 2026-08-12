package com.livingdashboard.di

import android.content.Context
import android.webkit.WebView
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.livingdashboard.ai.ActiveNavigatorHolder
import com.livingdashboard.ai.ActivePanelIdHolder
import com.livingdashboard.ai.ActiveWebViewHolder
import com.livingdashboard.ai.AgentLoop
import com.livingdashboard.ai.ApiKeyStore
import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.KvStorage
import com.livingdashboard.ai.LlmClient
import com.livingdashboard.ai.LocalAgentService
import com.livingdashboard.ai.PageContextProvider
import com.livingdashboard.ai.RuntimeModeManager
import com.livingdashboard.ai.SkillLoader
import com.livingdashboard.ai.ToolRegistry
import com.livingdashboard.ai.tools.AskUserTool
import com.livingdashboard.ai.tools.BrowserEvalTool
import com.livingdashboard.ai.tools.BrowserGetUrlTool
import com.livingdashboard.ai.tools.BrowserNavigateTool
import com.livingdashboard.ai.tools.CreateHtmlWidgetTool
import com.livingdashboard.ai.tools.CreateUserScriptTool
import com.livingdashboard.ai.tools.DeleteHtmlWidgetTool
import com.livingdashboard.ai.tools.DeleteUserScriptTool
import com.livingdashboard.ai.tools.ListUserScriptsTool
import com.livingdashboard.ai.tools.ListWidgetsTool
import com.livingdashboard.ai.tools.StorageReadTool
import com.livingdashboard.ai.tools.StorageWriteTool
import com.livingdashboard.ai.tools.UpdateHtmlWidgetTool
import com.livingdashboard.ai.tools.UpdateUserScriptTool
import com.livingdashboard.data.dao.BookmarkDao
import com.livingdashboard.data.dao.HistoryDao
import com.livingdashboard.data.dao.TabDao
import com.livingdashboard.data.repository.BookmarkRepository
import com.livingdashboard.data.repository.CanvasRepository
import com.livingdashboard.data.repository.HistoryRepository
import com.livingdashboard.data.repository.TabRepository
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ScriptMetadataParser
import com.livingdashboard.sync.DeviceAuth
import com.livingdashboard.sync.ServerConfig
import com.livingdashboard.sync.WsClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    // ===== M0 已有：WS 相关 @Provides（保留不动） =====

    @Provides @Singleton
    fun provideDeviceAuth(@ApplicationContext ctx: Context): DeviceAuth = DeviceAuth(ctx)

    @Provides @Singleton
    fun provideServerConfig(deviceAuth: DeviceAuth): ServerConfig = ServerConfig(deviceAuth)

    @Provides @Singleton
    fun provideWsClient(serverConfig: ServerConfig, deviceAuth: DeviceAuth): WsClient =
        WsClient(serverConfig, deviceAuth)

    // ===== M1 已有：Repository @Provides（Spec 3.6） =====

    @Provides @Singleton
    fun provideBookmarkRepository(dao: BookmarkDao): BookmarkRepository =
        BookmarkRepository(dao)

    @Provides @Singleton
    fun provideHistoryRepository(dao: HistoryDao): HistoryRepository =
        HistoryRepository(dao)

    @Provides @Singleton
    fun provideTabRepository(dao: TabDao): TabRepository =
        TabRepository(dao)

    // ===== M8 新增：Agent 相关 @Provides（Spec 七章 行 1618-1694） =====
    //
    // 注意：Spec 中 provideAskUserDialogState 返回 `MutableStateFlow<AskUserRequest?>`，
    // 但实际 AskUserDialogState 是封装类（持有内部 StateFlow，见 ai/AskUserDialogState.kt）。
    // 此处按真实类型 `AskUserDialogState` 调整，对应 AskUserTool 构造函数签名
    // `AskUserTool(askUserDialogState: AskUserDialogState)`（见 ai/tools/AskUserTool.kt）。
    //
    // Spec 中 provideActiveWebViewHolder/provideActivePanelIdHolder 返回的 holder 用
    // `@Volatile var value: LivingWebView?`，但 LivingWebView 是 @Composable 函数（非 class）。
    // 实际类型为 [android.webkit.WebView]，且用 MutableStateFlow 持有（见 ai/ActiveHolders.kt）。
    //
    // ToolRegistry/LlmClient/AgentLoop/LocalAgentService/SkillLoader 类由其他 sub-agent 实现，
    // 此处 @Provides 按 Spec 第六章设计签名引用，等类实现后即可编译。

    /**
     * 提供应用级 [CoroutineScope]（Spec 七章 行 1626）。
     *
     * - SupervisorJob：子任务失败不传播到其他子任务
     * - Dispatchers.Main.immediate：与 UI 同线程，避免 Main 跳转开销
     *
     * 用于 RuntimeModeManager.stateIn 等长期订阅 + AgentLoop 内部流发射。
     */
    @Provides @Singleton
    fun provideApplicationScope(): CoroutineScope =
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /**
     * 提供 [OkHttpClient] 单例（Spec 七章 行 1637，LlmClient 依赖）。
     *
     * WsClient 内部自建 OkHttpClient（私有不暴露），LlmClient 需要独立的 OkHttpClient 实例。
     *
     * 配置：
     * - connectTimeout 30s（API 连接）
     * - readTimeout 0（SSE 流不超时，与 OpenAI 流式响应兼容）
     * - writeTimeout 30s（请求体发送，含大量 tools 定义）
     */
    @Provides @Singleton
    fun provideOkHttpClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)  // SSE 流不超时
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Spec 七章 行 1631：[ApiKeyStore] 用 EncryptedSharedPreferences 加密 API Key。
     *
     * 生产环境在此创建 EncryptedSharedPreferences（AES256_GCM + AES256_SIV）后注入 [ApiKeyStore]。
     * [ApiKeyStore] 只依赖 SharedPreferences 接口，便于单元测试用普通 SharedPreferences 隔离
     * security-crypto 对 AndroidKeyStore JCE Provider 的依赖（Robolectric 沙箱不支持）。
     */
    @Provides @Singleton
    fun provideApiKeyStore(@ApplicationContext context: Context): ApiKeyStore {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val encryptedPrefs = EncryptedSharedPreferences.create(
            context, "ai_keys",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        return ApiKeyStore(encryptedPrefs)
    }

    /** Spec 七章 行 1634：[SkillLoader] 扫描 assets/pi/skills/ 加载 skill。 */
    @Provides @Singleton
    fun provideSkillLoader(@ApplicationContext context: Context): SkillLoader =
        SkillLoader(context)

    /** Spec 七章 行 1637：[LlmClient] OkHttp SSE 流式调用。 */
    @Provides @Singleton
    fun provideLlmClient(okHttpClient: OkHttpClient): LlmClient =
        LlmClient(okHttpClient)

    /**
     * Spec 七章 行 1640：[ToolRegistry] 注册 10 个 M8 工具。
     *
     * 工具构造函数依赖（参考 ai/tools/ 下各 .kt 已实现的真实签名）：
     * - ListWidgetsTool(canvasRepository, panelIdProvider: () -> String?)
     * - StorageReadTool(kvStorage)
     * - StorageWriteTool(kvStorage)
     * - CreateHtmlWidgetTool(canvasRepository, panelIdProvider: () -> String?)
     * - UpdateHtmlWidgetTool(canvasRepository)
     * - DeleteHtmlWidgetTool(canvasRepository)
     * - AskUserTool(askUserDialogState: AskUserDialogState)
     * - BrowserEvalTool(webviewProvider: () -> WebView?)
     * - BrowserNavigateTool(webviewProvider: () -> WebView?)
     * - BrowserGetUrlTool(webviewProvider: () -> WebView?)
     *
     * panelIdProvider / webviewProvider 从 holder.value.value 取当前快照。
     */
    @Provides @Singleton
    fun provideToolRegistry(
        canvasRepository: CanvasRepository,
        kvStorage: KvStorage,
        webviewHolder: ActiveWebViewHolder,
        panelIdHolder: ActivePanelIdHolder,
        askUserDialogState: AskUserDialogState,
        navigatorHolder: ActiveNavigatorHolder,
        createUserScriptTool: CreateUserScriptTool,
        updateUserScriptTool: UpdateUserScriptTool,
        listUserScriptsTool: ListUserScriptsTool,
        deleteUserScriptTool: DeleteUserScriptTool,
    ): ToolRegistry = ToolRegistry().apply {
        val panelIdProvider: () -> String? = { panelIdHolder.value.value }
        val webviewProvider: () -> WebView? = { webviewHolder.value.value }
        // M8 已有 10 个工具
        register(ListWidgetsTool(canvasRepository, panelIdProvider))
        register(StorageReadTool(kvStorage))
        register(StorageWriteTool(kvStorage))
        register(CreateHtmlWidgetTool(canvasRepository, panelIdProvider))
        register(UpdateHtmlWidgetTool(canvasRepository))
        register(DeleteHtmlWidgetTool(canvasRepository))
        register(AskUserTool(askUserDialogState))
        register(BrowserEvalTool(webviewProvider))
        register(BrowserNavigateTool(webviewProvider))
        register(BrowserGetUrlTool(webviewProvider))
        // M3 新增 14 个工具（12 browser_* + 2 navigate_*）
        registerAllBrowserTools(webviewHolder, navigatorHolder, canvasRepository)
        // M4 新增 4 个 userscript 工具（Spec 2.5 / 2.7.2）
        // 4 个工具用 @Inject constructor + @Singleton，由 Hilt 自动注入实例
        register(createUserScriptTool)
        register(updateUserScriptTool)
        register(listUserScriptsTool)
        register(deleteUserScriptTool)
    }

    /** Spec 七章 行 1660：[AgentLoop] 多轮工具循环。 */
    @Provides @Singleton
    fun provideAgentLoop(llmClient: LlmClient, toolRegistry: ToolRegistry): AgentLoop =
        AgentLoop(llmClient, toolRegistry)

    /**
     * Spec 七章 行 1663：[LocalAgentService] 本地 Agent 入口（UI 调 sendMessage）。
     *
     * 构造参数顺序与 Spec 一致：llmClient, agentLoop, toolRegistry, apiKeyStore, skillLoader,
     * runtimeModeManager, okHttpClient。
     *
     * M3 新增：`pageContextProvider`（PageContextProvider 已用 @Inject constructor，Hilt 自动提供）。
     */
    @Provides @Singleton
    fun provideLocalAgentService(
        agentLoop: AgentLoop,
        toolRegistry: ToolRegistry,
        apiKeyStore: ApiKeyStore,
        skillLoader: SkillLoader,
        runtimeModeManager: RuntimeModeManager,
        okHttpClient: OkHttpClient,
        llmClient: LlmClient,
        pageContextProvider: PageContextProvider,
    ): LocalAgentService = LocalAgentService(
        llmClient, agentLoop, toolRegistry, apiKeyStore, skillLoader,
        runtimeModeManager, okHttpClient, pageContextProvider,
    )

    /**
     * Spec 七章 行 1677：[RuntimeModeManager] AUTO 模式自动降级。
     *
     * 真实 RuntimeModeManager 构造函数签名（见 ai/RuntimeModeManager.kt:27）：
     * `RuntimeModeManager(wsClient: WsClient, coroutineScope: CoroutineScope)`
     */
    @Provides @Singleton
    fun provideRuntimeModeManager(
        wsClient: WsClient,
        coroutineScope: CoroutineScope,  // 由 provideApplicationScope 注入
    ): RuntimeModeManager = RuntimeModeManager(wsClient, coroutineScope)

    /** Spec 七章 行 1684：[ActiveWebViewHolder] 持有当前活跃 WebView 引用。 */
    @Provides @Singleton
    fun provideActiveWebViewHolder(): ActiveWebViewHolder = ActiveWebViewHolder()

    /** Spec 七章 行 1687：[ActivePanelIdHolder] 持有当前活跃面板 ID。 */
    @Provides @Singleton
    fun provideActivePanelIdHolder(): ActivePanelIdHolder = ActivePanelIdHolder()

    /**
     * Spec 七章 行 1690：[AskUserDialogState] 持有 AskUser Dialog 状态。
     *
     * Spec 原签名 `provideAskUserDialogState(): MutableStateFlow<AskUserRequest?>`，
     * 实际 [AskUserDialogState] 是封装类（持有内部 StateFlow，见 ai/AskUserDialogState.kt），
     * 与 AskUserTool 构造函数签名一致。
     */
    @Provides @Singleton
    fun provideAskUserDialogState(): AskUserDialogState = AskUserDialogState()

    /**
     * Spec 七章 行 1693：[KvStorage] 底层 KV 存储（storage_read / storage_write 工具用）。
     *
     * 真实 KvStorage 构造函数签名（见 ai/KvStorage.kt:20）：
     * `KvStorage(dataStore: DataStore<Preferences>)`，由 DatabaseModule.provideDataStore 注入。
     */
    @Provides @Singleton
    fun provideKvStorage(dataStore: DataStore<Preferences>): KvStorage = KvStorage(dataStore)

    /**
     * M4 新增（Spec 2.7.1）：提供 kotlinx.serialization [Json] 单例。
     *
     * 依赖方：
     * - [UserScriptRepository]（@Inject constructor(dao, json)）
     * - [com.livingdashboard.script.ScriptInjector]（@Inject constructor(... json ...))
     *
     * 配置：ignoreUnknownKeys = true（容错，M5 同步字段演进时不崩溃）。
     */
    @Provides @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    /**
     * M4 新增（Spec 2.7.2）：提供 [ScriptMetadataParser] 单例。
     *
     * [ScriptMetadataParser] 是 Kotlin `object`（无构造函数），无法用 @Inject constructor，
     * 必须由 @Provides 显式提供。依赖方：
     * - [CreateUserScriptTool]（@Inject constructor(repository, parser)）
     * - [UpdateUserScriptTool]（@Inject constructor(repository, parser)）
     * - [com.livingdashboard.ui.script.ScriptEditViewModel]（@Inject constructor）
     */
    @Provides @Singleton
    fun provideScriptMetadataParser(): ScriptMetadataParser = ScriptMetadataParser
}
