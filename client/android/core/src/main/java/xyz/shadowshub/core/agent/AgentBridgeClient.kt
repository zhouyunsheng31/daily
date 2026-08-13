package xyz.shadowshub.core.agent

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import xyz.shadowshub.core.chat.ChatEvent
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * 端侧 pi harness 的 stdio JSON-RPC 2.0 桥客户端（D15：本地 AI 唯一通道）。
 *
 * 协议单一事实源：shared/agent-bridge-contract/bridge.schema.json（main.js 输出侧）。
 * - 请求：{"jsonrpc":"2.0","id":N,"method":"session.turn","params":{...}}
 * - 响应：{"jsonrpc":"2.0","id":N,"result":{...}} / {"jsonrpc":"2.0","id":N,"error":{code,message}}
 * - 事件（通知）：{"jsonrpc":"2.0","method":"event","params":{"conversationId":...,"event":{...}}}
 *   事件词汇对齐 shared/webos-contracts 的 WebOsChatEvent（ChatEvent.fromJson 复用解析）。
 *
 * 收发解耦：onLine() 由进程管理器的 stdout 逐行驱动；请求经 sendLine 回调写出。
 */
class AgentBridgeClient(
    private val sendLine: (String) -> Unit,
    private val requestTimeoutMs: Long = 30_000L,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val pending = ConcurrentHashMap<Long, CompletableDeferred<JsonObject>>()
    private val nextId = AtomicLong(1)

    private val _events = MutableSharedFlow<AgentBridgeEvent>(
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<AgentBridgeEvent> = _events.asSharedFlow()

    /** 处理 stdout 的一行输出（由进程管理器调用） */
    fun onLine(line: String) {
        if (line.isBlank()) return
        val obj = runCatching { json.parseToJsonElement(line) as? JsonObject }.getOrNull() ?: return

        val id = (obj["id"] as? JsonPrimitive)?.longOrNull
        if (id != null) {
            // 请求-响应关联
            val deferred = pending.remove(id) ?: return
            val err = obj["error"]?.jsonObject
            if (err != null) {
                val code = err["code"]?.jsonPrimitive?.contentOrNull ?: "-32603"
                val message = err["message"]?.jsonPrimitive?.contentOrNull ?: "rpc error"
                deferred.completeExceptionally(BridgeRpcException(code, message))
            } else {
                deferred.complete(obj["result"]?.jsonObject ?: buildJsonObject { })
            }
            return
        }

        val method = (obj["method"] as? JsonPrimitive)?.contentOrNull ?: return
        if (method != "event") return
        val params = obj["params"]?.jsonObject ?: return
        val conversationId = params["conversationId"]?.jsonPrimitive?.contentOrNull ?: "default"
        val eventObj = params["event"]?.jsonObject ?: return
        _events.tryEmit(AgentBridgeEvent(conversationId, ChatEvent.fromJson(eventObj)))
    }

    /** JSON-RPC 请求（带超时）。调用方需在协程上下文。 */
    suspend fun request(method: String, params: JsonObject = buildJsonObject { }): JsonObject {
        val id = nextId.getAndIncrement()
        val deferred = CompletableDeferred<JsonObject>()
        pending[id] = deferred
        sendLine(
            json.encodeToString(
                JsonObject.serializer(),
                buildJsonObject {
                    put("jsonrpc", "2.0")
                    put("id", id)
                    put("method", method)
                    put("params", params)
                },
            ),
        )
        return try {
            withTimeout(requestTimeoutMs) { deferred.await() }
        } catch (e: TimeoutCancellationException) {
            pending.remove(id)
            throw BridgeRpcException("-32000", "request timeout: $method")
        }
    }

    /** 断开清理：所有挂起请求以错误结束 */
    fun onClosed(reason: String) {
        val err = BridgeRpcException("-32001", "bridge closed: $reason")
        pending.values.forEach { it.completeExceptionally(err) }
        pending.clear()
    }
}

/** 桥事件：conversationId + 映射后的 ChatEvent（词汇与 SSE 一致） */
data class AgentBridgeEvent(val conversationId: String, val event: ChatEvent)

/** JSON-RPC 错误（对齐 -32xxx 惯例） */
class BridgeRpcException(val code: String, message: String) : Exception("$code: $message")
