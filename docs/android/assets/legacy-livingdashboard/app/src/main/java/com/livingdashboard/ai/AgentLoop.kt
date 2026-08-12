package com.livingdashboard.ai

import android.util.Log
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Agent 核心循环（Spec 6.2 节）。
 *
 * 循环逻辑：
 * 1. session.addUserMessage(userMessage)
 * 2. while (iterations++ < 10):
 *    a. emit(TurnStart)
 *    b. llmClient.stream().collect { ... } 累积 assistantText + toolCallBuilders
 *    c. LlmStreamEvent.Error → emit(AgentEvent.Error) + return@flow
 *    d. session.addAssistantMessage(assistantText, toolCalls)
 *    e. if (toolCalls.isEmpty()) → emit(TurnEnd) + return@flow
 *    f. for (call in toolCalls): execute → session.addToolResultMessage → emit(ToolCallEnd)
 *    g. continue
 * 3. 第 11 轮（iterations=10 条件失败）→ emit(Error("max iterations exceeded"))
 *
 * @param llmClient LLM 客户端（流式）
 * @param toolRegistry 工具注册表（执行工具调用）
 */
class AgentLoop(
    private val llmClient: LlmClient,
    private val toolRegistry: ToolRegistry,
) {
    /** 最大工具调用轮数（防死循环） */
    private val maxIterations = 10

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    /**
     * Agent 主循环（返回 Flow，UI 流式收集）。
     *
     * @param session 当前面板 Session
     * @param userMessage 用户消息文本
     * @param thinkingLevel 思考等级
     * @param llmConfig LLM 客户端配置（endpoint + apiKey + provider + model）
     */
    fun run(
        session: Session,
        userMessage: String,
        thinkingLevel: ThinkingLevel,
        llmConfig: LlmClientConfig,
    ): Flow<AgentEvent> = flow {
        session.addUserMessage(userMessage)

        var iterations = 0
        while (iterations++ < maxIterations) {
            emit(AgentEvent.TurnStart)

            val assistantText = StringBuilder()
            val thinkingText = StringBuilder()
            val toolCallBuilders = mutableMapOf<Int, ToolCallBuilder>()

            val sessionMessages = session.messages()
            val llmRequest = LlmRequest(
                provider = llmConfig.provider,
                model = llmConfig.model,
                messages = sessionMessages,
                tools = toolRegistry.listDefinitions().ifEmpty { null },
                thinkingLevel = thinkingLevel,
            )

            var streamError: Throwable? = null
            var doneFinishReason: String? = null

            llmClient.stream(llmRequest, llmConfig).collect { ev ->
                when (ev) {
                    is LlmStreamEvent.TextDelta -> {
                        assistantText.append(ev.text)
                        emit(AgentEvent.TextDelta(ev.text))
                    }
                    is LlmStreamEvent.ThinkingDelta -> {
                        thinkingText.append(ev.text)
                        emit(AgentEvent.ThinkingDelta(ev.text))
                    }
                    is LlmStreamEvent.ToolCallDelta -> {
                        val builder = toolCallBuilders.getOrPut(ev.index) { ToolCallBuilder() }
                        ev.id?.let { builder.id = it }
                        ev.name?.let { builder.name = it }
                        ev.argsDelta?.let { builder.args.append(it) }
                    }
                    is LlmStreamEvent.Done -> {
                        doneFinishReason = ev.finishReason
                    }
                    is LlmStreamEvent.Error -> {
                        // 流错误：中断整个 AgentLoop.run（不能用 return@collect 会导致死循环）
                        streamError = ev.throwable
                    }
                }
            }

            // 错误处理：emit Error 后中断整个 flow
            streamError?.let {
                Log.e("AgentLoop", "stream error: ${it.message}", it)
                emit(AgentEvent.Error(it.message ?: "LLM stream error", false))
                return@flow
            }

            // 累积 tool_calls
            val toolCalls = toolCallBuilders.toSortedMap()
                .values
                .filter { it.id.isNotEmpty() && it.name.isNotEmpty() }
                .map { ToolCall(it.id, it.name, it.args.toString()) }

            // 写入 assistant 消息（含 tool_calls）
            session.addAssistantMessage(
                content = assistantText.toString().ifEmpty { null },
                toolCalls = toolCalls.ifEmpty { null },
            )

            if (toolCalls.isEmpty()) {
                // 无工具调用 → 结束
                emit(AgentEvent.TurnEnd(doneFinishReason ?: "stop"))
                return@flow
            }

            // 执行工具调用
            for (call in toolCalls) {
                val args: JsonObject = runCatching {
                    json.parseToJsonElement(call.arguments).let {
                        if (it is JsonObject) it else JsonObject(emptyMap())
                    }
                }.getOrDefault(JsonObject(emptyMap()))

                emit(AgentEvent.ToolCallStart(call.id, call.name, args))

                val result = toolRegistry.execute(call.name, args)
                val resultJson = if (result.success) {
                    result.data?.toString() ?: "{}"
                } else {
                    buildJsonObject {
                        put("error", result.error ?: "tool execution failed")
                    }.toString()
                }
                session.addToolResultMessage(call.id, resultJson)

                emit(AgentEvent.ToolCallEnd(
                    callId = call.id,
                    success = result.success,
                    result = result.error ?: result.data?.toString() ?: "",
                ))
            }
            // 继续下一轮 LLM 调用
        }

        // 超过最大轮次
        emit(AgentEvent.Error("max iterations exceeded", false))
    }

    /** 工具调用分片累积器 */
    private class ToolCallBuilder {
        var id: String = ""
        var name: String = ""
        val args: StringBuilder = StringBuilder()
    }
}
