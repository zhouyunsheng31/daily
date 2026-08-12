package com.livingdashboard.ai

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.cancellable
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSource
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * LLM 流式事件（Spec 6.1 节）。
 *
 * 由 [LlmClient.stream] 发出，[AgentLoop] 收集后转为 [AgentEvent]。
 */
sealed class LlmStreamEvent {
    /** 文本增量（assistant 消息内容） */
    data class TextDelta(val text: String) : LlmStreamEvent()

    /** 思考链增量（DeepSeek reasoning_content / Qwen thinking / OpenAI reasoning summary） */
    data class ThinkingDelta(val text: String) : LlmStreamEvent()

    /** 工具调用增量（tool_calls 跨多个 chunk 累积） */
    data class ToolCallDelta(
        val index: Int,
        val id: String?,
        val name: String?,
        val argsDelta: String?,
    ) : LlmStreamEvent()

    /** 流结束（usage 信息） */
    data class Done(val finishReason: String?, val totalTokens: Int?) : LlmStreamEvent()

    /** 错误（网络/HTTP/SSE 协议错误） */
    data class Error(val throwable: Throwable) : LlmStreamEvent()
}

/**
 * LLM 调用请求（Spec 6.1 节）。
 *
 * @param provider "stepfun"|"openai"|"deepseek"|"anthropic"|"qwen"|"custom"
 * @param model 模型名（不含 provider 前缀，如 "step-3.7-flash"）
 * @param messages 消息列表（含 system/user/assistant/tool）
 * @param tools 可用工具定义（null 表示无工具）
 * @param thinkingLevel 思考等级（由 [ThinkingLevelMapper.applyToRequest] 注入参数）
 * @param maxTokens 最大输出 token 数（Anthropic 必填，缺省 4096）
 * @param temperature 采样温度
 */
data class LlmRequest(
    val provider: String,
    val model: String,
    val messages: List<LlmMessage>,
    val tools: List<ToolDefinition>? = null,
    val thinkingLevel: ThinkingLevel = ThinkingLevel.STANDARD,
    val maxTokens: Int? = null,
    val temperature: Double = 0.3,
)

/**
 * LLM 客户端配置（Spec 6.1 节）。
 *
 * @param endpoint base URL（不含 /chat/completions 或 /messages），如 "https://api.stepfun.com/v1"
 * @param apiKey API Key
 * @param provider 与 [LlmRequest.provider] 同步，用于分派协议路径
 * @param model 模型名（由 [LocalAgentService] 从 [LlmProviderConfig.model] 注入，
 *   [AgentLoop] 构建 [LlmRequest] 时使用）
 */
data class LlmClientConfig(
    val endpoint: String,
    val apiKey: String,
    val provider: String,
    val model: String = "",
)

/**
 * LLM 客户端（OkHttp SSE 流式，Spec 6.1 节）。
 *
 * - 根据 [LlmClientConfig.provider] 分派到 OpenAI 兼容路径或 Anthropic 路径
 * - OpenAI 兼容：POST /v1/chat/completions，Header Authorization: Bearer
 * - Anthropic：POST /v1/messages，Header x-api-key + anthropic-version，body system 提取顶级、
 *   max_tokens 必填、tools 用 input_schema
 * - SSE 解析：data: 前缀 + [DONE] + multi-line data 累积
 * - Anthropic SSE：event: + data: 双行
 * - 取消：suspendCancellableCoroutine + invokeOnCancellation { call.cancel() }
 * - flowOn(Dispatchers.IO)
 */
class LlmClient(
    private val httpClient: OkHttpClient,
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /**
     * 流式调用 LLM。
     *
     * - 构建 OpenAI 兼容或 Anthropic 请求体（含 tools/thinkingLevel 映射）
     * - 用 OkHttp 发 POST，读 SSE 流
     * - 解析 data: 行，[DONE] 终止
     * - 解析 choices[0].delta.content / reasoning_content / thinking / tool_calls
     * - 返回 Flow<LlmStreamEvent>
     */
    fun stream(request: LlmRequest, config: LlmClientConfig): Flow<LlmStreamEvent> = flow {
        try {
            val isAnthropic = config.provider == "anthropic"
            val url = buildApiUrl(config.endpoint, isAnthropic)
            Log.d("LlmClient", "stream: url=$url, provider=${config.provider}, model=${config.model.ifEmpty { request.model }}")
            val body = if (isAnthropic) {
                buildAnthropicBody(request, config)
            } else {
                buildOpenAIBody(request, config)
            }
            val httpRequest = buildRequest(url, body, config, isAnthropic)

            // 用 suspendCancellableCoroutine 包裹 call.execute()，
            // 协程取消时调 call.cancel() 中断阻塞的 execute()
            val response: Response = suspendCancellableCoroutine { cont ->
                val call = httpClient.newCall(httpRequest)
                cont.invokeOnCancellation { runCatching { call.cancel() } }
                try {
                    val r = call.execute()
                    if (cont.isActive) cont.resume(r)
                } catch (e: Exception) {
                    if (cont.isActive) cont.resumeWithException(e)
                }
            }

            response.use { resp ->
                if (!resp.isSuccessful) {
                    val errorBody = runCatching { resp.body?.string() }.getOrNull() ?: ""
                    val msg = when (resp.code) {
                        401, 403 -> "API Key 无效或权限不足"
                        429 -> {
                            val retryAfter = resp.header("retry-after")
                            if (retryAfter != null) "限流，请在 $retryAfter 秒后重试"
                            else "限流，请稍后重试"
                        }
                        in 400..499 -> "客户端错误 ${resp.code}: $errorBody"
                        in 500..599 -> "服务器错误 ${resp.code}: $errorBody"
                        else -> "HTTP ${resp.code}: $errorBody"
                    }
                    emit(LlmStreamEvent.Error(RuntimeException(msg)))
                    return@use
                }
                val source = resp.body?.source() ?: run {
                    emit(LlmStreamEvent.Error(RuntimeException("empty response body")))
                    return@use
                }
                if (isAnthropic) {
                    parseAnthropicSSE(source, this)
                } else {
                    parseOpenAISSE(source, this)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            emit(LlmStreamEvent.Error(e))
        }
    }.flowOn(Dispatchers.IO).cancellable()

    // -------------------------------------------------------------------------
    // URL 构建（参考 llmCaller.ts:58-71 buildApiUrl）
    // -------------------------------------------------------------------------

    private fun buildApiUrl(endpoint: String, isAnthropic: Boolean): String {
        val tail = if (isAnthropic) "/messages" else "/chat/completions"
        if (endpoint.endsWith(tail)) return endpoint
        val base = endpoint.trimEnd('/')
        val versionSuffix = Regex("""/v\d+$""").find(base) != null || base.endsWith("/v1")
        return if (isAnthropic) {
            if (versionSuffix) "$base/messages" else "$base/v1/messages"
        } else {
            if (versionSuffix) "$base/chat/completions" else "$base/v1/chat/completions"
        }
    }

    // -------------------------------------------------------------------------
    // 请求体构建
    // -------------------------------------------------------------------------

    /** OpenAI 兼容请求体（stepfun/openai/deepseek/qwen/custom） */
    private fun buildOpenAIBody(request: LlmRequest, config: LlmClientConfig): String {
        val body = buildJsonObject {
            put("model", config.model.ifEmpty { request.model })
            putJsonArray("messages") {
                request.messages.forEach { add(messageToOpenAIJson(it)) }
            }
            put("stream", true)
            put("temperature", request.temperature)
            request.maxTokens?.let { put("max_tokens", it) }
            request.tools?.let { tools ->
                if (tools.isNotEmpty()) {
                    putJsonArray("tools") {
                        tools.forEach { t ->
                            addJsonObject {
                                put("type", "function")
                                putJsonObject("function") {
                                    put("name", t.name)
                                    put("description", t.description)
                                    put("parameters", t.parameters)
                                }
                            }
                        }
                    }
                }
            }
            // 注入思考等级参数（DeepSeek reasoning_effort / Qwen thinking_budget / OpenAI reasoning.effort / ...）
            ThinkingLevelMapper.applyToRequest(this, request.provider, request.thinkingLevel)
        }
        return body.toString()
    }

    /** Anthropic 请求体（system 提取顶级、max_tokens 必填、tools 用 input_schema） */
    private fun buildAnthropicBody(request: LlmRequest, config: LlmClientConfig): String {
        // 从 messages 中提取 system 消息，其余作为对话消息
        val systemText = request.messages
            .filter { it.role == "system" }
            .joinToString("\n\n") { it.content ?: "" }
        val nonSystemMessages = request.messages.filter { it.role != "system" }

        val body = buildJsonObject {
            put("model", config.model.ifEmpty { request.model })
            put("stream", true)
            put("max_tokens", request.maxTokens ?: 4096)  // Anthropic 必填
            if (systemText.isNotEmpty()) {
                put("system", systemText)
            }
            putJsonArray("messages") {
                nonSystemMessages.forEach { add(messageToAnthropicJson(it)) }
            }
            request.tools?.let { tools ->
                if (tools.isNotEmpty()) {
                    putJsonArray("tools") {
                        tools.forEach { t ->
                            addJsonObject {
                                put("name", t.name)
                                put("description", t.description)
                                put("input_schema", t.parameters)  // Anthropic 用 input_schema
                            }
                        }
                    }
                }
            }
            // 注入思考等级参数（anthropic thinking.type=enabled + budget_tokens）
            ThinkingLevelMapper.applyToRequest(this, request.provider, request.thinkingLevel)
        }
        return body.toString()
    }

    /** LlmMessage → OpenAI wire JSON（snake_case: tool_calls / tool_call_id） */
    private fun messageToOpenAIJson(msg: LlmMessage): JsonObject = buildJsonObject {
        put("role", msg.role)
        msg.content?.let { put("content", it) }
        msg.toolCalls?.let { tcs ->
            if (tcs.isNotEmpty()) {
                putJsonArray("tool_calls") {
                    tcs.forEach { tc ->
                        addJsonObject {
                            put("id", tc.id)
                            put("type", "function")
                            putJsonObject("function") {
                                put("name", tc.name)
                                put("arguments", tc.arguments)
                            }
                        }
                    }
                }
            }
        }
        msg.toolCallId?.let { put("tool_call_id", it) }
    }

    /** LlmMessage → Anthropic wire JSON（content 为数组形式，tool_calls → tool_use block） */
    private fun messageToAnthropicJson(msg: LlmMessage): JsonObject = buildJsonObject {
        when (msg.role) {
            "user", "assistant" -> {
                put("role", msg.role)
                putJsonArray("content") {
                    if (!msg.content.isNullOrEmpty()) {
                        addJsonObject {
                            put("type", "text")
                            put("text", msg.content)
                        }
                    }
                    msg.toolCalls?.forEach { tc ->
                        addJsonObject {
                            put("type", "tool_use")
                            put("id", tc.id)
                            put("name", tc.name)
                            // Anthropic input 是 JSON 对象，不是字符串
                            val inputObj = runCatching {
                                json.parseToJsonElement(tc.arguments).jsonObject
                            }.getOrNull() ?: JsonObject(emptyMap())
                            put("input", inputObj)
                        }
                    }
                }
            }
            "tool" -> {
                put("role", "user")
                putJsonArray("content") {
                    addJsonObject {
                        put("type", "tool_result")
                        put("tool_use_id", msg.toolCallId ?: "")
                        put("content", msg.content ?: "")
                    }
                }
            }
            else -> {
                put("role", msg.role)
                msg.content?.let { put("content", it) }
            }
        }
    }

    // -------------------------------------------------------------------------
    // 请求构建
    // -------------------------------------------------------------------------

    private fun buildRequest(
        url: String,
        body: String,
        config: LlmClientConfig,
        isAnthropic: Boolean,
    ): Request {
        val mediaType = "application/json".toMediaType()
        val builder = Request.Builder()
            .url(url)
            .post(body.toRequestBody(mediaType))
        if (isAnthropic) {
            builder.addHeader("x-api-key", config.apiKey)
            builder.addHeader("anthropic-version", "2023-06-01")
        } else {
            builder.addHeader("Authorization", "Bearer ${config.apiKey}")
        }
        return builder.build()
    }

    // -------------------------------------------------------------------------
    // SSE 解析（OpenAI 兼容）
    // -------------------------------------------------------------------------

    private suspend fun parseOpenAISSE(source: BufferedSource, collector: FlowCollector<LlmStreamEvent>) {
        val dataBuilder = StringBuilder()
        while (true) {
            currentCoroutineContext().ensureActive()
            val line = source.readUtf8Line() ?: break
            when {
                // keep-alive 注释行
                line.startsWith(":") -> continue
                // [DONE] 终止
                line.startsWith("data: [DONE]") -> {
                    // 先 flush 累积的 data
                    if (dataBuilder.isNotEmpty()) {
                        parseAndEmitOpenAIChunk(dataBuilder.toString(), collector)
                        dataBuilder.clear()
                    }
                    collector.emit(LlmStreamEvent.Done(finishReason = "stop", totalTokens = null))
                    return
                }
                // data 行（可能跨多行累积）
                line.startsWith("data: ") -> {
                    dataBuilder.append(line.removePrefix("data: "))
                }
                line.startsWith("data:") -> {
                    dataBuilder.append(line.removePrefix("data:"))
                }
                // 空行 → 触发解析累积的 data
                line.isEmpty() -> {
                    if (dataBuilder.isNotEmpty()) {
                        parseAndEmitOpenAIChunk(dataBuilder.toString(), collector)
                        dataBuilder.clear()
                    }
                }
                // 其他行（如 event: 等 OpenAI 不用）忽略
            }
        }
        // 流自然结束（无 [DONE]），发 Done
        if (dataBuilder.isNotEmpty()) {
            parseAndEmitOpenAIChunk(dataBuilder.toString(), collector)
        }
        collector.emit(LlmStreamEvent.Done(finishReason = "stop", totalTokens = null))
    }

    private suspend fun parseAndEmitOpenAIChunk(data: String, collector: FlowCollector<LlmStreamEvent>) {
        val chunk = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return
        // 错误响应
        chunk["error"]?.let { errEl ->
            val errObj = runCatching { errEl.jsonObject }.getOrNull()
            val msg = errObj?.get("message")?.jsonPrimitive?.contentOrNull
                ?: errEl.toString()
            collector.emit(LlmStreamEvent.Error(RuntimeException(msg)))
            return
        }
        val choices = chunk["choices"]?.jsonArray ?: return
        val firstChoice = choices.firstOrNull()?.jsonObject ?: return
        val delta = firstChoice["delta"]?.jsonObject ?: return
        // 忽略 delta.role="assistant"（首个 chunk）
        delta["content"]?.jsonPrimitive?.contentOrNull?.let { collector.emit(LlmStreamEvent.TextDelta(it)) }
        // DeepSeek reasoning_content
        delta["reasoning_content"]?.jsonPrimitive?.contentOrNull?.let {
            collector.emit(LlmStreamEvent.ThinkingDelta(it))
        }
        // Qwen thinking
        delta["thinking"]?.jsonPrimitive?.contentOrNull?.let {
            collector.emit(LlmStreamEvent.ThinkingDelta(it))
        }
        // tool_calls 分片
        delta["tool_calls"]?.jsonArray?.forEach { tcEl ->
            val tc = tcEl.jsonObject
            val index = tc["index"]?.jsonPrimitive?.intOrNull ?: 0
            val id = tc["id"]?.jsonPrimitive?.contentOrNull
            val function = tc["function"]?.jsonObject
            val name = function?.get("name")?.jsonPrimitive?.contentOrNull
            val argsDelta = function?.get("arguments")?.jsonPrimitive?.contentOrNull
            collector.emit(LlmStreamEvent.ToolCallDelta(index, id, name, argsDelta))
        }
        // finish_reason（在 choices[0].finish_reason）
        firstChoice["finish_reason"]?.jsonPrimitive?.contentOrNull?.let { reason ->
            // 流内 finish_reason 不直接 emit Done（等 [DONE] 或流结束），
            // 仅记录。length/content_filter 在 [DONE] 后由 Done 携带。
        }
        // usage（最后一个 chunk 可能带）
        chunk["usage"]?.jsonObject?.get("total_tokens")?.jsonPrimitive?.intOrNull?.let {
            // 不在此 emit Done，等 [DONE] 触发
        }
    }

    // -------------------------------------------------------------------------
    // SSE 解析（Anthropic）
    // -------------------------------------------------------------------------

    private suspend fun parseAnthropicSSE(source: BufferedSource, collector: FlowCollector<LlmStreamEvent>) {
        var currentEvent = ""
        val dataBuilder = StringBuilder()
        var finishReason: String? = null
        var totalTokens: Int? = null
        while (true) {
            currentCoroutineContext().ensureActive()
            val line = source.readUtf8Line() ?: break
            when {
                line.startsWith(":") -> continue  // 注释/keep-alive
                line.startsWith("event: ") -> {
                    currentEvent = line.removePrefix("event: ").trim()
                }
                line.startsWith("data: ") -> {
                    dataBuilder.append(line.removePrefix("data: "))
                }
                line.startsWith("data:") -> {
                    dataBuilder.append(line.removePrefix("data:"))
                }
                line.isEmpty() -> {
                    if (dataBuilder.isNotEmpty()) {
                        val (fr, tt) = parseAnthropicEvent(currentEvent, dataBuilder.toString(), collector)
                        if (fr != null) finishReason = fr
                        if (tt != null) totalTokens = tt
                        dataBuilder.clear()
                        currentEvent = ""
                    }
                }
            }
        }
        if (dataBuilder.isNotEmpty()) {
            parseAnthropicEvent(currentEvent, dataBuilder.toString(), collector)
        }
        collector.emit(LlmStreamEvent.Done(finishReason ?: "stop", totalTokens))
    }

    /** 返回 finishReason / totalTokens（仅 message_delta/message_stop 时非 null） */
    private suspend fun parseAnthropicEvent(event: String, data: String, collector: FlowCollector<LlmStreamEvent>): Pair<String?, Int?> {
        val obj = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull()
            ?: return null to null
        when (event) {
            "message_start" -> {
                // 提取 usage.input_tokens（可选）
                obj["message"]?.jsonObject?.get("usage")?.jsonObject?.let { usage ->
                    // input_tokens 在此，但 totalTokens 包含 input+output，暂不处理
                }
            }
            "content_block_start" -> {
                // content_block.type 可能是 "text" 或 "tool_use"
                val cb = obj["content_block"]?.jsonObject ?: return null to null
                val type = cb["type"]?.jsonPrimitive?.contentOrNull
                if (type == "tool_use") {
                    val index = obj["index"]?.jsonPrimitive?.intOrNull ?: 0
                    val id = cb["id"]?.jsonPrimitive?.contentOrNull
                    val name = cb["name"]?.jsonPrimitive?.contentOrNull
                    // tool_use 开始：emit 一个 ToolCallDelta 携带 id+name
                    collector.emit(LlmStreamEvent.ToolCallDelta(index, id, name, null))
                }
            }
            "content_block_delta" -> {
                val delta = obj["delta"]?.jsonObject ?: return null to null
                val deltaType = delta["type"]?.jsonPrimitive?.contentOrNull
                when (deltaType) {
                    "text_delta" -> {
                        delta["text"]?.jsonPrimitive?.contentOrNull?.let {
                            collector.emit(LlmStreamEvent.TextDelta(it))
                        }
                    }
                    "thinking_delta" -> {
                        delta["thinking"]?.jsonPrimitive?.contentOrNull?.let {
                            collector.emit(LlmStreamEvent.ThinkingDelta(it))
                        }
                    }
                    "input_json_delta" -> {
                        // tool_use 参数增量
                        val index = obj["index"]?.jsonPrimitive?.intOrNull ?: 0
                        val argsDelta = delta["partial_json"]?.jsonPrimitive?.contentOrNull
                        if (argsDelta != null) {
                            collector.emit(LlmStreamEvent.ToolCallDelta(index, null, null, argsDelta))
                        }
                    }
                }
            }
            "content_block_stop" -> {
                // 单个 content_block 结束，无需 emit
            }
            "message_delta" -> {
                val delta = obj["delta"]?.jsonObject
                val stopReason = delta?.get("stop_reason")?.jsonPrimitive?.contentOrNull
                if (stopReason != null) {
                    // end_turn → stop, tool_use → tool_calls
                    val mapped = when (stopReason) {
                        "end_turn" -> "stop"
                        "tool_use" -> "tool_calls"
                        "max_tokens" -> "length"
                        else -> stopReason
                    }
                    return mapped to null
                }
                obj["usage"]?.jsonObject?.get("output_tokens")?.jsonPrimitive?.intOrNull?.let {
                    return null to it
                }
            }
            "message_stop" -> {
                // 整个消息流结束
            }
            "error" -> {
                val err = obj["error"]?.jsonObject
                val msg = err?.get("message")?.jsonPrimitive?.contentOrNull ?: data
                collector.emit(LlmStreamEvent.Error(RuntimeException(msg)))
            }
        }
        return null to null
    }
}
