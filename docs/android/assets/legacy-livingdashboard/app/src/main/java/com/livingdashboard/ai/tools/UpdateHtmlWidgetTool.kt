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
 * update_html_widget 工具（Spec 6.9.4 行 1180）。
 *
 * 更新已有 HTML 组件的 content/title。仅当 html 或 title 至少一个非空时才更新；
 * 都为空返回 "nothing to update" 错误（Spec 行 1200）。
 *
 * 底层调用 [CanvasRepository.updateHtmlWidget] 合并 state（保留其他字段如 createdAt/agentWidth）。
 */
class UpdateHtmlWidgetTool(
    private val canvasRepository: CanvasRepository,
) : Tool {

    override val definition = ToolDefinition(
        name = "update_html_widget",
        description = "Update an existing HTML widget's content or title.",
        parameters = toolObjectSchema {
            putJsonObject("widget_id") {
                put("type", "string")
                put("description", "Widget ID to update")
            }
            putJsonObject("html") {
                put("type", "string")
                put("description", "New HTML content (optional)")
            }
            putJsonObject("title") {
                put("type", "string")
                put("description", "New widget title (optional)")
            }
            putJsonArray("required") { add("widget_id") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val widgetId = args["widget_id"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing widget_id")
        val html = args["html"]?.jsonPrimitive?.contentOrNull
        val title = args["title"]?.jsonPrimitive?.contentOrNull
        if (html == null && title == null) return ToolResult.error("nothing to update")
        val ok = canvasRepository.updateHtmlWidget(widgetId, html, title)
        if (!ok) return ToolResult.error("widget not found: $widgetId")
        return ToolResult.success(buildJsonObject {
            put("widget_id", widgetId)
            put("success", true)
        })
    }
}
