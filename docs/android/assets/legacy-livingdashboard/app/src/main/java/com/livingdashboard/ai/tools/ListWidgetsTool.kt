package com.livingdashboard.ai.tools

import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import com.livingdashboard.data.repository.CanvasRepository
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * list_widgets 工具（Spec 6.9.1 行 1019）。
 *
 * 列出当前活跃面板上的所有组件，返回 id/type/title。
 *
 * 真实 WidgetEntity 字段名为 `id` / `type`（非 Spec 示例的 widgetId/widgetType），
 * 已按真实 [CanvasRepository.observeWidgets] 返回类型 [com.livingdashboard.data.entity.WidgetEntity] 调整。
 */
class ListWidgetsTool(
    private val canvasRepository: CanvasRepository,
    private val panelIdProvider: () -> String?,
) : Tool {

    override val definition = ToolDefinition(
        name = "list_widgets",
        description = "List all widgets on the current canvas panel. Returns id/type/title for each.",
        parameters = toolObjectSchema { /* 无参，type=object */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val panelId = panelIdProvider() ?: return ToolResult.error("no active panel")
        val widgets = canvasRepository.observeWidgets(panelId).first()
        return ToolResult.success(buildJsonObject {
            putJsonArray("widgets") {
                widgets.forEach { w ->
                    addJsonObject {
                        put("id", w.id)
                        put("type", w.type.name)
                        put("title", w.title)
                    }
                }
            }
        })
    }
}
