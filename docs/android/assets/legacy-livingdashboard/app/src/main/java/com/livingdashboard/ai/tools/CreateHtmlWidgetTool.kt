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
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * create_html_widget 工具（Spec 6.9.3 行 1105）。
 *
 * 在当前活跃面板上创建一个 HTML Canvas 组件。默认值：
 * - x=100, y=100, width=400, height=300, title="HTML Widget"
 *
 * CanvasRepository.createHtmlWidget 内部走 createWidget + updatePosition 两步
 * （参考桌面端 wsToolHandlers.ts:170-182），否则位置不会写入 widget_positions 表。
 */
class CreateHtmlWidgetTool(
    private val canvasRepository: CanvasRepository,
    private val panelIdProvider: () -> String?,
) : Tool {

    override val definition = ToolDefinition(
        name = "create_html_widget",
        description = "Create a new HTML widget on the current canvas panel.",
        parameters = toolObjectSchema {
            putJsonObject("html") {
                put("type", "string")
                put("description", "HTML content")
            }
            putJsonObject("x") {
                put("type", "number")
                put("description", "Canvas X position (default 100)")
            }
            putJsonObject("y") {
                put("type", "number")
                put("description", "Canvas Y position (default 100)")
            }
            putJsonObject("width") {
                put("type", "number")
                put("description", "Widget width px (default 400)")
            }
            putJsonObject("height") {
                put("type", "number")
                put("description", "Widget height px (default 300)")
            }
            putJsonObject("title") {
                put("type", "string")
                put("description", "Widget title")
            }
            putJsonArray("required") { add("html") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val panelId = panelIdProvider() ?: return ToolResult.error("no active panel")
        val html = args["html"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing html")
        val x = args["x"]?.jsonPrimitive?.doubleOrNull ?: 100.0
        val y = args["y"]?.jsonPrimitive?.doubleOrNull ?: 100.0
        val width = args["width"]?.jsonPrimitive?.doubleOrNull ?: 400.0
        val height = args["height"]?.jsonPrimitive?.doubleOrNull ?: 300.0
        val title = args["title"]?.jsonPrimitive?.contentOrNull ?: "HTML Widget"

        val widgetId = canvasRepository.createHtmlWidget(
            panelId = panelId,
            html = html,
            x = x.toFloat(),
            y = y.toFloat(),
            w = width.toFloat(),
            h = height.toFloat(),
            title = title,
        )
        return ToolResult.success(buildJsonObject {
            put("id", widgetId)
            put("width", width)
            put("height", height)
        })
    }
}
