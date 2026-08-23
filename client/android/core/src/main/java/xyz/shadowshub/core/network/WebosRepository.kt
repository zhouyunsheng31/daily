package xyz.shadowshub.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import xyz.shadowshub.core.chat.ChatStreamRequest

/**
 * core 模块对外门面：会话 + 对话 + 应用 / 包 / 市场 / 互通空间
 */
class WebosRepository(
    private val api: WebosApi,
    private val scope: CoroutineScope,
) {
    private val _sessionReady = MutableStateFlow(false)
    val sessionReady: StateFlow<Boolean> = _sessionReady.asStateFlow()

    private val _bootstrap = MutableStateFlow<JsonObject?>(null)
    val bootstrap: StateFlow<JsonObject?> = _bootstrap.asStateFlow()

    private val _apps = MutableStateFlow<List<AppSummary>>(emptyList())
    val apps: StateFlow<List<AppSummary>> = _apps.asStateFlow()

    private val _packages = MutableStateFlow<List<PackageSummary>>(emptyList())
    val packages: StateFlow<List<PackageSummary>> = _packages.asStateFlow()

    private val _market = MutableStateFlow(MarketListing())
    val market: StateFlow<MarketListing> = _market.asStateFlow()

    /** 首次启动：游客登录 + bootstrap（失败可重试） */
    suspend fun initSession(deviceId: String): Boolean {
        val token = api.guest(deviceId)
        if (token == null) {
            _sessionReady.value = false
            return false
        }
        val bs = api.bootstrap()
        _bootstrap.value = bs
        _sessionReady.value = true

        // 异步刷新应用与包列表
        scope.launch {
            refreshApps()
            refreshPackages()
        }
        return true
    }

    suspend fun refreshApps(): List<AppSummary> {
        val list = api.listApps()
        _apps.value = list
        return list
    }

    suspend fun refreshPackages(type: String? = null, query: String? = null): List<PackageSummary> {
        val list = api.listPackages(type, query)
        _packages.value = list
        return list
    }

    suspend fun refreshMarket(type: String? = null, query: String? = null): MarketListing {
        val listing = api.listMarket(type, query)
        _market.value = listing
        return listing
    }

    suspend fun installMarketPackage(id: String): Boolean {
        val ok = api.installMarketPackage(id)
        if (ok) {
            refreshApps()
            refreshPackages()
        }
        return ok
    }

    suspend fun rollbackApp(appId: String, versionId: String? = null): Boolean {
        val ok = api.rollbackApp(appId, versionId)
        if (ok) refreshApps()
        return ok
    }

    suspend fun deleteApp(appId: String): Boolean {
        val ok = api.deleteApp(appId)
        if (ok) refreshApps()
        return ok
    }

    fun stream(req: ChatStreamRequest) = api.chatStream(req)

    /** 终止生成：通知服务端 abort 当前会话（保留上下文）。停止按钮调用；失败静默。 */
    suspend fun cancelChat(conversationId: String = "default"): Boolean = api.cancelChat(conversationId)

    val sessionState: StateFlow<Boolean> = _sessionReady
}