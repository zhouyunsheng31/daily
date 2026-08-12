package com.livingdashboard.ai

import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

enum class ThinkingLevel(val value: Int, val label: String) {
    AUTO(1, "自动"),
    STANDARD(2, "标准"),
    DEEP(3, "深度"),
    MAX(4, "最深");

    companion object { fun fromValue(v: Int) = entries.firstOrNull { it.value == v } ?: STANDARD }
}

/**
 * 4 档思考等级映射到 provider 参数（架构 13.6）。
 * 在构建 LLM 请求体时调用 applyToRequest(builder, provider, level)。
 */
object ThinkingLevelMapper {
    fun applyToRequest(builder: JsonObjectBuilder, provider: String, level: ThinkingLevel) {
        when (provider) {
            "deepseek" -> {
                // reasoning_effort: low | medium | high（DeepSeek 实际取值；注：原 Spec 误写 auto/high/high/max，修正为 low/medium/high/high）
                val effort = when (level) {
                    ThinkingLevel.AUTO -> "low"      // 不调思考
                    ThinkingLevel.STANDARD -> "medium"
                    ThinkingLevel.DEEP -> "high"
                    ThinkingLevel.MAX -> "high"      // DeepSeek 最高就是 high
                }
                builder.put("reasoning_effort", effort)
            }
            "qwen" -> {
                // thinking_budget: null | 4096 | 8192 | 16384
                val budget = when (level) {
                    ThinkingLevel.AUTO -> null
                    ThinkingLevel.STANDARD -> 4096
                    ThinkingLevel.DEEP -> 8192
                    ThinkingLevel.MAX -> 16384
                }
                budget?.let { builder.put("thinking_budget", it) }
            }
            "openai" -> {
                // reasoning.effort: low | medium | high（仅 reasoning 模型生效，如 o1/o3 系列；OpenAI 最高就是 high）
                val effort = when (level) {
                    ThinkingLevel.AUTO -> "low"
                    ThinkingLevel.STANDARD -> "medium"
                    ThinkingLevel.DEEP -> "high"
                    ThinkingLevel.MAX -> "high"
                }
                builder.putJsonObject("reasoning") { put("effort", effort) }
            }
            "anthropic" -> {
                // AUTO/STANDARD 不注入 thinking 参数（Claude 默认 adaptive）
                when (level) {
                    ThinkingLevel.AUTO, ThinkingLevel.STANDARD -> {
                        // 不注入 thinking 参数
                    }
                    ThinkingLevel.DEEP -> {
                        builder.putJsonObject("thinking") {
                            put("type", "enabled")
                            put("budget_tokens", 8000)
                        }
                    }
                    ThinkingLevel.MAX -> {
                        builder.putJsonObject("thinking") {
                            put("type", "enabled")
                            put("budget_tokens", 16000)
                        }
                    }
                }
            }
            "stepfun" -> {
                // StepFun 暂无思考等级参数（标准 OpenAI 兼容）
                // 等级 1-4 通过 temperature 微调（注：buildJsonObject 的 put 是覆盖语义，会覆盖 request 中的 temperature）
                val temp = when (level) {
                    ThinkingLevel.AUTO -> 0.5
                    ThinkingLevel.STANDARD -> 0.3
                    ThinkingLevel.DEEP -> 0.2
                    ThinkingLevel.MAX -> 0.1
                }
                builder.put("temperature", temp)
            }
            // "custom"（自定义 OpenAI 兼容 API）：不注入 provider 专属思考参数，
            // 由用户自行配置 endpoint/model，兼容标准 OpenAI 协议。
        }
    }

    /** 仅供内部 fallback，不应作为路由依据（路由依据应为 LlmRequest.provider 字段） */
    internal fun parseProvider(fullModel: String): String {
        // fullModel 可能是 "stepfun/step-3.7-flash" 或 "step-3.7-flash"
        return if (fullModel.contains('/')) fullModel.substringBefore('/')
        else "stepfun"  // 默认 provider
    }
}
