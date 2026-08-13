package xyz.shadowshub.core.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonObject
import xyz.shadowshub.core.chat.ChatStreamRequest

/** core 模块对外门面（M0-2：会话 + 对话） */
class WebosRepository(
    private val api: WebosApi,
    private val scope: CoroutineScope,
) {
    private val _sessionReady = MutableStateFlow(false)
    val sessionReady: StateFlow<Boolean> = _sessionReady

    private val _bootstrap = MutableStateFlow<JsonObject?>(null)
    val bootstrap: StateFlow<JsonObject?> = _bootstrap

    /** 首次启动：游客登录 + bootstrap（失败可重试） */
    suspend fun initSession(deviceId: String): Boolean {
        val token = api.guest(deviceId)
        if (token == null) {
            _sessionReady.value = false
            return false
        }
        _bootstrap.value = api.bootstrap()
        _sessionReady.value = true
        return true
    }

    fun stream(req: ChatStreamRequest) = api.chatStream(req)

    val sessionState: StateFlow<Boolean> = _sessionReady
}