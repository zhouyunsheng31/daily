package com.livingdashboard.ai.tools

import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import com.livingdashboard.data.repository.CanvasRepository
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * delete_html_widget 工具（Spec 6.9.4 行 1213）。
 *
 * 调用 [CanvasRepository.deleteWidget] 删除组件及其位置/收藏记录（外键 CASCADE）。
 */
class DeleteHtmlWidgetTool(
    private val canvasRepository: CanvasRepository,
) : Tool {

    override val definition = ToolDefinition(
        name = "delete_html_widget",
        description = "Delete an HTML widget from the canvas.",
        parameters = toolObjectSchema {
            putJsonObject("widget_id") {
                put("type", "string")
                put("description", "Widget ID to delete")
            }
            putJsonArray("required") { add("widget_id") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val widgetId = args["widget_id"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing widget_id")
        canvasRepository.deleteWidget(widgetId)
        return ToolResult.success(buildJsonObject {
            put("widget_id", widgetId)
            put("success", true)
        })
    }
}
