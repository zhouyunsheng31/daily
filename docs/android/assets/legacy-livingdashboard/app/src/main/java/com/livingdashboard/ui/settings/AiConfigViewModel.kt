package com.livingdashboard.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.ai.ApiKeyStore
import com.livingdashboard.ai.LlmProviderConfig
import com.livingdashboard.ai.LocalAgentService
import com.livingdashboard.ai.RuntimeModeManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject

/**
 * AI 配置页状态，Spec 6.11.3 节。
 *
 * @param provider 当前选中的 provider id（"stepfun"|"openai"|"deepseek"|"anthropic"|"qwen"|"custom"）
 * @param apiKey API Key（明文，保存时加密）
 * @param endpoint 接口地址（不含 /chat/completions）
 * @param model 模型名（不含 provider 前缀，如 "step-3.7-flash"）
 * @param isTesting 是否正在测试连接
 * @param testResult 测试结果（null=未测试，true=成功，false=失败）
 * @param errorMessage 错误信息（测试失败/保存失败时显示）
 */
data class AiConfigState(
    val provider: String = "stepfun",
    val apiKey: String = "",
    val endpoint: String = "",
    val model: String = "",
    val isTesting: Boolean = false,
    val testResult: Boolean? = null,
    val errorMessage: String? = null,
    /** 获取模型列表状态 */
    val isFetchingModels: Boolean = false,
    /** 获取到的可用模型列表 */
    val models: List<String> = emptyList(),
    /** 获取模型列表错误信息 */
    val fetchModelsError: String? = null,
) {
    /** 测试按钮可用条件：apiKey 非空且未在测试中 */
    val canTest: Boolean get() = apiKey.isNotBlank() && !isTesting

    /** 保存按钮可用条件：provider + apiKey 都非空且未在测试中 */
    val canSave: Boolean get() = provider.isNotBlank() && apiKey.isNotBlank() && !isTesting

    /** 获取模型列表按钮可用条件：apiKey + endpoint 非空且未在获取中 */
    val canFetchModels: Boolean get() = apiKey.isNotBlank() && endpoint.isNotBlank() && !isFetchingModels
}

/**
 * AI 配置页 ViewModel，Spec 6.11.3 节。
 *
 * 职责：
 * - 加载已有 provider 配置（[load] 在 init 中调用）
 * - 切换 provider 时加载对应已存配置（[onProviderChange]）
 * - 测试连接：调 [LocalAgentService.testConnection]
 * - 保存：调 [ApiKeyStore.saveConfig] + [ApiKeyStore.setActiveProvider]
 *
 * @param apiKeyStore 加密存储 API Key
 * @param localAgentService 本地 Agent 服务（提供 testConnection）
 */
@HiltViewModel
class AiConfigViewModel @Inject constructor(
    private val apiKeyStore: ApiKeyStore,
    private val localAgentService: LocalAgentService,
    private val okHttpClient: OkHttpClient,
    private val runtimeModeManager: RuntimeModeManager,
) : ViewModel() {

    private val _state = MutableStateFlow(AiConfigState())
    val state: StateFlow<AiConfigState> = _state.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    init {
        load()
    }

    /**
     * 加载已有配置。
     *
     * 优先加载 activeProvider 的配置；若无 activeProvider，加载第一个已配置的 provider；
     * 若全部为空，用默认 provider（stepfun）+ 默认 endpoint/model。
     */
    private fun load() {
        val activeProvider = apiKeyStore.getActiveProvider()
        val providerToLoad = activeProvider
            ?: apiKeyStore.listConfiguredProviders().firstOrNull()
            ?: "stepfun"
        applyProviderConfig(providerToLoad)
    }

    /**
     * 把指定 provider 的已存配置应用到 state（无配置则用默认值）。
     */
    private fun applyProviderConfig(provider: String) {
        val saved = apiKeyStore.getConfig(provider)
        val defaults = defaultConfigFor(provider)
        _state.value = AiConfigState(
            provider = provider,
            apiKey = saved?.apiKey ?: "",
            endpoint = saved?.endpoint.ifBlank { defaults.endpoint },
            model = saved?.model.ifBlank { defaults.model },
        )
    }

    /** Provider 切换回调：加载对应 provider 的已存配置或默认值 */
    fun onProviderChange(provider: String) {
        applyProviderConfig(provider)
    }

    fun onApiKeyChange(apiKey: String) {
        _state.update { it.copy(apiKey = apiKey, testResult = null, errorMessage = null) }
    }

    fun onEndpointChange(endpoint: String) {
        _state.update { it.copy(endpoint = endpoint, testResult = null, errorMessage = null) }
    }

    fun onModelChange(model: String) {
        _state.update { it.copy(model = model, testResult = null, errorMessage = null) }
    }

    /**
     * 测试连接，Spec 6.11.3 节。
     *
     * 用当前 state 的配置调 [LocalAgentService.testConnection]，
     * 成功/失败结果写入 [AiConfigState.testResult]。
     */
    fun testConnection() {
        val current = _state.value
        if (!current.canTest) return
        viewModelScope.launch {
            _state.update { it.copy(isTesting = true, testResult = null, errorMessage = null) }
            val config = LlmProviderConfig(
                provider = current.provider,
                apiKey = current.apiKey,
                endpoint = current.endpoint,
                model = current.model,
            )
            val ok = try {
                localAgentService.testConnection(config)
            } catch (e: Exception) {
                _state.update {
                    it.copy(isTesting = false, testResult = false, errorMessage = e.message)
                }
                return@launch
            }
            _state.update {
                it.copy(
                    isTesting = false,
                    testResult = ok,
                    errorMessage = if (ok) null else "连接失败，请检查 API Key / Endpoint / Model"
                )
            }
        }
    }

    /**
     * 保存配置，Spec 6.11.3 节。
     *
     * 调 [ApiKeyStore.saveConfig] + [ApiKeyStore.setActiveProvider]，
     * 把当前 provider 设为活跃 provider（LocalAgentService 会用 activeProvider 发送消息）。
     */
    fun save() {
        val current = _state.value
        if (!current.canSave) return
        val config = LlmProviderConfig(
            provider = current.provider,
            apiKey = current.apiKey,
            endpoint = current.endpoint,
            model = current.model,
        )
        apiKeyStore.saveConfig(current.provider, config)
        apiKeyStore.setActiveProvider(current.provider)
        // 保存 API 配置后切换到 LOCAL 模式，确保用户配置的 API Key 被使用
        // （CLOUD 模式只发 WS 消息到服务器，不会用本地 API Key 调 LLM）
        runtimeModeManager.setMode(com.livingdashboard.ai.AgentMode.LOCAL)
        _state.update {
            it.copy(errorMessage = null, testResult = null)
        }
    }

    /**
     * 获取可用模型列表。
     *
     * 调 LLM API 的 /models 端点（OpenAI 兼容: GET {endpoint}/v1/models；
     * Anthropic: GET {endpoint}/v1/models，Header x-api-key + anthropic-version）。
     * 成功后模型列表写入 [AiConfigState.models]，UI 展示 DropdownMenu。
     */
    fun fetchModels() {
        val current = _state.value
        if (!current.canFetchModels) {
            if (current.apiKey.isBlank()) {
                _state.update { it.copy(fetchModelsError = "请先填写 API Key") }
            } else if (current.endpoint.isBlank()) {
                _state.update { it.copy(fetchModelsError = "请先填写 Endpoint") }
            }
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(isFetchingModels = true, fetchModelsError = null, models = emptyList())
            }
            val result = try {
                fetchModelsInternal(current.provider, current.endpoint, current.apiKey)
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        isFetchingModels = false,
                        fetchModelsError = e.message ?: "获取模型列表失败"
                    )
                }
                return@launch
            }
            _state.update {
                it.copy(
                    isFetchingModels = false,
                    models = result,
                    fetchModelsError = if (result.isEmpty()) "未获取到模型" else null
                )
            }
        }
    }

    /**
     * 用 OkHttp 发 GET /models 请求，解析返回的模型 id 列表。
     *
     * - OpenAI 兼容: Authorization: Bearer
     * - Anthropic: x-api-key + anthropic-version
     * - URL 构建：endpoint 已含 /v1 则直接拼 /models，否则补 /v1/models
     */
    private suspend fun fetchModelsInternal(
        provider: String,
        endpoint: String,
        apiKey: String
    ): List<String> = withContext(Dispatchers.IO) {
        val isAnthropic = provider == "anthropic"
        val base = endpoint.trimEnd('/')
        val hasVersionSuffix = Regex("""/v\d+$""").find(base) != null || base.endsWith("/v1")
        val url = if (hasVersionSuffix) "$base/models" else "$base/v1/models"

        val request = Request.Builder()
            .url(url)
            .get()
            .apply {
                if (isAnthropic) {
                    addHeader("x-api-key", apiKey)
                    addHeader("anthropic-version", "2023-06-01")
                } else {
                    addHeader("Authorization", "Bearer $apiKey")
                }
            }
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw RuntimeException("HTTP ${response.code}")
            }
            val body = response.body?.string() ?: throw RuntimeException("空响应")
            val obj = json.parseToJsonElement(body).jsonObject
            val data = obj["data"]?.jsonArray ?: return@withContext emptyList()
            data.mapNotNull { item ->
                runCatching { item.jsonObject["id"]?.jsonPrimitive?.contentOrNull }.getOrNull()
            }
        }
    }

    // ===== Provider 默认配置 =====
    //
    // 默认 endpoint（参考 Spec 6.1 buildApiUrl，不含 /chat/completions）
    // 默认 model（常用入门型号，用户可改）

    private data class ProviderDefaults(val endpoint: String, val model: String)

    private fun defaultConfigFor(provider: String): ProviderDefaults = when (provider) {
        "stepfun"   -> ProviderDefaults("https://api.stepfun.com/v1", "step-3.7-flash")
        "openai"    -> ProviderDefaults("https://api.openai.com/v1", "gpt-4o-mini")
        "deepseek"  -> ProviderDefaults("https://api.deepseek.com/v1", "deepseek-chat")
        "anthropic" -> ProviderDefaults("https://api.anthropic.com/v1", "claude-3-5-sonnet-latest")
        "qwen"      -> ProviderDefaults("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max")
        "custom"    -> ProviderDefaults("", "")
        else        -> ProviderDefaults("", "")
    }
}

/**
 * Kotlin 惯例：String?.ifBlank { default } —— 若为 null 或 blank 则用 default，否则用原值。
 */
private fun String?.ifBlank(default: () -> String): String =
    if (this.isNullOrBlank()) default() else this
