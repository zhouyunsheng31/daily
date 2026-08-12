package com.livingdashboard.ai

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * 工具执行结果（Spec 6.3 节）。
 *
 * 签名以现有工具用法为准：[success] 接收 [JsonObject]，[error] 接收 String。
 */
data class ToolResult(
    val success: Boolean,
    val data: JsonObject? = null,
    val error: String? = null,
) {
    companion object {
        fun success(data: JsonObject) = ToolResult(true, data)
        fun error(message: String) = ToolResult(false, error = message)
    }
}

/**
 * 工具定义（OpenAI function schema）。
 *
 * @param parameters JSON Schema（由 [toolObjectSchema] 构建）
 */
data class ToolDefinition(
    val name: String,
    val description: String,
    val parameters: JsonObject,
)

/** 工具接口（所有工具实现此接口） */
interface Tool {
    val definition: ToolDefinition
    suspend fun execute(args: JsonObject): ToolResult
}

/**
 * 构建 JSON Schema object（Spec 6.3 节行 606-627）。
 *
 * block 在临时 builder 内执行：block 写入各 property 子对象 + 可选 `required` 数组。
 * 实现把 `required` 数组从 properties 中提取到顶级，保证生成的 JSON Schema 结构正确：
 *
 * ```
 * {
 *   "type": "object",
 *   "properties": { ... },        // block 写入的属性（不含 required）
 *   "required": ["key1", "key2"]   // 从 block 中提取的 required 数组（如有）
 * }
 * ```
 *
 * 这样现有工具调用 `putJsonArray("required") { add("key") }` 时，
 * required 不会被错误嵌套在 properties 内。
 */
fun toolObjectSchema(block: JsonObjectBuilder.() -> Unit): JsonObject {
    val captured = buildJsonObject { block() }
    val requiredElement = captured["required"]
    return buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            captured.forEach { (k, v) -> if (k != "required") put(k, v) }
        }
        if (requiredElement is JsonArray) {
            put("required", requiredElement)
        }
    }
}
