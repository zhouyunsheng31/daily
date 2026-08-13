package xyz.shadowshub.core.agent

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformWhile
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import xyz.shadowshub.core.chat.ChatEvent

/**
 * 本地对话源：AgentBridgeClient 之上的一轮对话抽象（D15 端侧 pi）。
 *
 * turn() 语义：
 *  1. session.turn 请求（返回 accepted 即本轮排队/开始）
 *  2. 订阅本 conversationId 的事件流，事件词汇与 SSE 的 ChatEvent 完全一致
 *  3. 收到 done / error 即本轮结束
 */
class AgentChatSource(private val bridge: AgentBridgeClient) {

    /** 启动一轮本地对话，返回本轮事件流（done/error 为终止事件，会被 emit 后结束） */
    suspend fun turn(conversationId: String, text: String, thinking: String? = null): Flow<ChatEvent> {
        bridge.request(
            "session.turn",
            buildJsonObject {
                put("conversationId", conversationId)
                put("text", text)
                thinking?.let { put("thinking", it) }
            },
        )
        return bridge.events
            .filter { it.conversationId == conversationId }
            .map { it.event }
            .transformWhile { event ->
                emit(event)
                // done / error 为终止事件：emit 后结束流
                event !is ChatEvent.Done && event !is ChatEvent.Error
            }
    }

    /** 中止当前轮（服务端语义：abort 后 pi 仍会以 done/error 收尾） */
    suspend fun abort(conversationId: String): Boolean {
        val res = bridge.request(
            "session.abort",
            buildJsonObject { put("conversationId", conversationId) },
        )
        return res["ok"]?.let {
            (it as? JsonPrimitive)?.let { p ->
                p.content == "true" || p.booleanOrNull == true
            }
        } ?: false
    }

    /** ping 探活（进程就绪检查） */
    suspend fun ping(): Boolean {
        val res = bridge.request("ping")
        return res["ok"]?.let {
            (it as? JsonPrimitive)?.let { p ->
                p.content == "true" || p.booleanOrNull == true
            }
        } ?: false
    }
}
