package xyz.shadowshub.core.network

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import xyz.shadowshub.core.chat.ChatEvent

/**
 * SSE 客户端封装（okhttp-sse）。
 * 服务端格式：`data: {json}\n\n`（writeSse），每行一个事件。
 */
class SseSource(private val client: OkHttpClient) {

    /** 订阅 SSE：返回事件 Flow；cancel() 或 onClosed/onFailure 结束 */
    fun events(request: Request): Flow<ChatEvent> = callbackFlow {
        val listener = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (data.isBlank()) return
                try {
                    val obj = Json.parseToJsonElement(data) as? kotlinx.serialization.json.JsonObject
                    if (obj != null) trySendBlocking(ChatEvent.fromJson(obj))
                } catch (_: Exception) {
                    // 单条事件解析失败不中断流
                }
            }

            override fun onClosed(eventSource: EventSource) {
                close()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                // 正常关闭（done 后服务端断连）不视为错误
                trySendBlocking(ChatEvent.Error("SSE_DISCONNECTED", t?.message ?: "连接中断"))
                close()
            }
        }

        val eventSource = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { eventSource.cancel() }
    }
}