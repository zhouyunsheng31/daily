package com.livingdashboard.sync

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

enum class WsState {
    DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING
}

class WsClient(
    private val serverConfig: ServerConfig,
    private val deviceAuth: DeviceAuth
) {
    companion object {
        private const val TAG = "LivingDashboard.WS"
        private const val PING_INTERVAL_MS = 30_000L
        private const val RECONNECT_BASE_MS = 1_000L
        private const val RECONNECT_MAX_MS = 30_000L
        private const val MAX_RECONNECT_ATTEMPTS = 10
    }

    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var ws: WebSocket? = null
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null
    private var manuallyClosed = false
    private var reconnectAttempts = 0

    private val httpClient = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)  // OkHttp 协议层 ping（与应用层 ping 双保险）
        .readTimeout(0, TimeUnit.SECONDS)     // WS 长连接不超时
        .build()

    // 连接状态：StateFlow，UI 订阅
    private val _state = MutableStateFlow(WsState.DISCONNECTED)
    val state: StateFlow<WsState> = _state.asStateFlow()

    // 服务器消息：SharedFlow，UI 订阅。buffer 64，DROP_OLDEST 防背压
    private val _messages = MutableSharedFlow<ServerMessage>(
        extraBufferCapacity = 64,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST
    )
    val messages: SharedFlow<ServerMessage> = _messages.asSharedFlow()

    /** 建立 WS 连接（Application.onCreate 调用） */
    fun connect() {
        // 用 state 判断而非 ws!=null（ws 在 onClosed/onFailure 后仍可能非 null）
        if (_state.value == WsState.CONNECTED || _state.value == WsState.CONNECTING) return
        // 若 scope 已被 disconnect() 取消，重建 scope 以支持重连
        if (!scope.isActive) {
            scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        }
        manuallyClosed = false
        reconnectAttempts = 0
        doConnect()
    }

    private fun doConnect() {
        if (manuallyClosed) return  // 防止 disconnect 后重连任务仍触发
        val url = serverConfig.buildWsUrl()
        Log.i(TAG, "Connecting to $url")
        _state.value = if (reconnectAttempts > 0) WsState.RECONNECTING else WsState.CONNECTING

        val request = Request.Builder().url(url).build()
        ws = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WS connected")
                reconnectAttempts = 0
                _state.value = WsState.CONNECTED
                startPing()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "WS recv: $text")
                try {
                    val msg = WsJson.decodeFromString(ServerMessage.serializer(), text)
                    _messages.tryEmit(msg)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to parse server message: $text", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WS closed: $code $reason")
                _state.value = WsState.DISCONNECTED
                cleanup()
                if (!manuallyClosed) scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure", t)
                _state.value = WsState.DISCONNECTED
                cleanup()
                if (!manuallyClosed) scheduleReconnect()
            }
        })
    }

    /** 发送客户端消息 */
    fun send(msg: ClientMessage): Boolean {
        val w = ws ?: return false
        return try {
            val json = WsJson.encodeToString(ClientMessage.serializer(), msg)
            Log.d(TAG, "WS send: $json")
            w.send(json)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send message", e)
            false
        }
    }

    /** 主动断开（Application.onTerminate 或不需要时调用） */
    fun disconnect() {
        Log.i(TAG, "WS disconnect (manual)")
        manuallyClosed = true
        pingJob?.cancel()
        reconnectJob?.cancel()  // 取消等待中的重连任务
        ws?.close(1000, "client closed")
        ws = null
        _state.value = WsState.DISCONNECTED
        scope.cancel()  // 取消所有协程，防止泄漏
    }

    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (true) {
                delay(PING_INTERVAL_MS)
                send(ClientMessage.Ping)
            }
        }
    }

    private fun scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Max reconnect attempts reached, giving up")
            _state.value = WsState.DISCONNECTED
            return
        }
        reconnectAttempts++
        val delayMs = minOf(RECONNECT_BASE_MS * (1L shl (reconnectAttempts - 1)), RECONNECT_MAX_MS)
        Log.i(TAG, "Reconnecting in ${delayMs}ms (attempt $reconnectAttempts)")
        _state.value = WsState.RECONNECTING
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (!manuallyClosed) doConnect()
        }
    }

    private fun cleanup() {
        pingJob?.cancel()
        pingJob = null
    }
}
