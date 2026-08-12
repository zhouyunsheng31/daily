package com.livingdashboard.ai.tools

import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * ask_user 工具（Spec 6.9.5 行 1238 + task 1.8）。
 *
 * 通过 [AskUserDialogState.showAndWait] 弹 Dialog 询问用户，挂起等待响应。
 * - 用户响应 → 返回 { selectedValues: [...] }
 * - 120s 超时 → 返回 error("ask_user timeout (120s)")
 *
 * UI 层订阅 [AskUserDialogState.state] 显示 AlertDialog，用户选择后调 respond/cancel。
 *
 * Spec 行 1235 原签名 `MutableStateFlow<AskUserRequest?>` 已替换为封装的 [AskUserDialogState]
 * （task 1.8 要求），工具侧不再直接操作 StateFlow。
 */
class AskUserTool(
    private val askUserDialogState: AskUserDialogState,
) : Tool {

    override val definition = ToolDefinition(
        name = "ask_user",
        description = "Ask the user a question with selectable options. Use when AI needs user input.",
        parameters = toolObjectSchema {
            putJsonObject("question") {
                put("type", "string")
                put("description", "Question text to ask the user")
            }
            putJsonObject("options") {
                put("type", "array")
                put("minItems", 2)
                put("maxItems", 4)
                put("description", "Selectable options (2-4)")
            }
            putJsonObject("allowMultiple") {
                put("type", "boolean")
                put("description", "Allow multiple selection")
            }
            putJsonArray("required") { add("question") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val question = args["question"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing question")
        val options = args["options"]?.jsonArray?.map { it.jsonObject } ?: emptyList()
        val allowMultiple = args["allowMultiple"]?.jsonPrimitive?.booleanOrNull ?: false

        val selectedValues = askUserDialogState.showAndWait(
            question = question,
            options = options,
            allowMultiple = allowMultiple,
        ) ?: return ToolResult.error("ask_user timeout (120s)")

        return ToolResult.success(buildJsonObject {
            putJsonArray("selectedValues") {
                selectedValues.forEach { add(it) }
            }
        })
    }
}
