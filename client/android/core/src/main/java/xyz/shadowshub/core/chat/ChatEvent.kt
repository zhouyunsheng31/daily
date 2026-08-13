package xyz.shadowshub.core.chat

import kotlinx.serialization.json.JsonObject

/**
 * webOS chat/stream SSE 事件（契约镜像，与 shared/webos-contracts 的 WebOsChatEvent 对齐）。
 * 用 JsonObject 手写解析（服务端事件字段差异大，多态序列化易错）。
 */
sealed class ChatEvent {
    abstract val type: String

    /** start：请求开始（resume=true 为重连补发） */
    data class Start(
        val requestId: String,
        val model: String,
        val thinking: String,
        val resume: Boolean = false,
    ) : ChatEvent() {
        override val type = "start"
    }

    /** delta：AI 输出增量 */
    data class Delta(val content: String) : ChatEvent() {
        override val type = "delta"
    }

    /** thinking：AI 思考增量 */
    data class Thinking(val content: String) : ChatEvent() {
        override val type = "thinking"
    }

    /** tool_start：工具调用开始 */
    data class ToolStart(val tool: String) : ChatEvent() {
        override val type = "tool_start"
    }

    /** tool_update：工具执行过程增量 */
    data class ToolUpdate(val tool: String, val content: String) : ChatEvent() {
        override val type = "tool_update"
    }

    /** tool_end：工具调用结束 */
    data class ToolEnd(val tool: String, val ok: Boolean, val images: List<String> = emptyList(), val videos: List<String> = emptyList()) : ChatEvent() {
        override val type = "tool_end"
    }

    /** app_created：AI 创建了 App */
    data class AppCreated(val appId: String) : ChatEvent() {
        override val type = "app_created"
    }

    /** interactive_html：AI 输出可交互 HTML 卡片 */
    data class InteractiveHtml(val html: String, val heightPx: Int? = null) : ChatEvent() {
        override val type = "interactive_html"
    }

    /** busy_waiting：上一条后台任务运行中，本次请求排队 */
    data class BusyWaiting(val elapsed: Long, val message: String? = null) : ChatEvent() {
        override val type = "busy_waiting"
    }

    /** background_progress：后台任务实时进度（不属于本次请求） */
    data class BackgroundProgress(val kind: String, val content: String?, val tool: String?, val ok: Boolean?) : ChatEvent() {
        override val type = "background_progress"
    }

    /** done：请求结束（含用量） */
    data class Done(val usage: Usage?, val resume: Boolean = false) : ChatEvent() {
        override val type = "done"

        data class Usage(
            val estimatedMinor: Long,
            val actualMinor: Long,
            val model: String,
            val thinking: String,
            val totalTokens: Long,
            val usedCredits: Long? = null,
            val remainingCredits: Long? = null,
        )
    }

    /** error：服务端错误 */
    data class Error(val code: String, val message: String) : ChatEvent() {
        override val type = "error"
    }

    /** no_task：resume 时无运行中任务 */
    data object NoTask : ChatEvent() {
        override val type = "no_task"
    }

    /** keep_alive：SSE 心跳（15s 一次） */
    data object KeepAlive : ChatEvent() {
        override val type = "keep_alive"
    }

    /** 未知事件（协议演进容错：忽略不崩溃） */
    data class Unknown(val rawType: String, val raw: JsonObject) : ChatEvent() {
        override val type = rawType
    }

    companion object {
        fun fromJson(obj: JsonObject): ChatEvent {
            val type = obj["type"]?.let { if (it is kotlinx.serialization.json.JsonPrimitive) it.content else null } ?: return Unknown("?", obj)
            return try {
                when (type) {
                    "start" -> Start(
                        requestId = obj.str("requestId") ?: "",
                        model = obj.obj("config")?.str("model") ?: "",
                        thinking = obj.obj("config")?.str("thinking") ?: "medium",
                        resume = obj.bool("resume"),
                    )
                    "delta" -> Delta(obj.str("content") ?: "")
                    "thinking" -> Thinking(obj.str("content") ?: "")
                    "tool_start" -> ToolStart(obj.str("tool") ?: "")
                    "tool_update" -> ToolUpdate(obj.str("tool") ?: "", obj.str("content") ?: "")
                    "tool_end" -> ToolEnd(
                        tool = obj.str("tool") ?: "",
                        ok = obj.bool("ok"),
                        images = obj.arr("images")?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: emptyList(),
                        videos = obj.arr("videos")?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: emptyList(),
                    )
                    "app_created" -> AppCreated(obj.str("appId") ?: "")
                    "interactive_html" -> InteractiveHtml(obj.str("html") ?: "", obj.intOrNull("heightPx"))
                    "busy_waiting" -> BusyWaiting(obj.long("elapsed") ?: 0L, obj.str("message"))
                    "background_progress" -> {
                        val ev = obj.obj("event")
                        BackgroundProgress(
                            kind = ev?.str("kind") ?: "",
                            content = ev?.str("content"),
                            tool = ev?.str("tool"),
                            ok = ev?.boolOrNull("ok"),
                        )
                    }
                    "done" -> {
                        val u = obj.obj("usage")
                        Done(
                            usage = u?.let {
                                Done.Usage(
                                    estimatedMinor = it.long("estimatedMinor") ?: 0L,
                                    actualMinor = it.long("actualMinor") ?: 0L,
                                    model = it.str("model") ?: "",
                                    thinking = it.str("thinking") ?: "",
                                    totalTokens = it.long("totalTokens") ?: 0L,
                                    usedCredits = it.long("usedCredits"),
                                    remainingCredits = it.long("remainingCredits"),
                                )
                            },
                            resume = obj.bool("resume"),
                        )
                    }
                    "error" -> Error(obj.str("code") ?: "UNKNOWN", obj.str("message") ?: "")
                    "no_task" -> NoTask
                    "keep_alive" -> KeepAlive
                    else -> Unknown(type, obj)
                }
            } catch (_: Exception) {
                Unknown(type, obj)
            }
        }

        private fun JsonObject.str(key: String): String? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.content
        private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
        private fun JsonObject.arr(key: String): kotlinx.serialization.json.JsonArray? = this[key] as? kotlinx.serialization.json.JsonArray
        private fun JsonObject.bool(key: String): Boolean = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.let { it.booleanOrNull ?: it.content == "true" } ?: false
        private fun JsonObject.boolOrNull(key: String): Boolean? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull
        private fun JsonObject.intOrNull(key: String): Int? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.intOrNull
        private fun JsonObject.long(key: String): Long? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.longOrNull
    }
}