package com.livingdashboard.ai

import com.livingdashboard.data.repository.CanvasRepository
import com.livingdashboard.ui.nav.Routes
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * create_panel 工具（Spec 6.9.11 行 1610）。
 *
 * 创建新画布面板并导航到它。
 *
 * 步骤：
 * 1. 调 [CanvasRepository.createPanel] 创建面板（PanelEntity）
 * 2. 调 [ActiveNavigatorHolder.navigate] 导航到新面板（M8 修复：内部切主线程）
 *
 * 任务清单简化版：参数 name + type（type 默认 "WEBVIEW"）。
 * 注意：CanvasRepository.createPanel 仅接收 name（PanelEntity.type 默认 NORMAL），
 * type 参数当前保留供未来扩展（M3 阶段 CanvasRepository 未支持 type 重载）。
 *
 * 返回 `{success: true, panelId: newPanelId, name: name}`。
 */
class CreatePanelTool(
    private val canvasRepository: CanvasRepository,
    private val navigatorHolder: ActiveNavigatorHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "create_panel",
        description = "Create a new canvas panel and navigate to it.",
        parameters = toolObjectSchema {
            putJsonObject("name") {
                put("type", "string")
                put("description", "Panel name")
            }
            putJsonObject("type") {
                put("type", "string")
                put("description", "Panel type, default 'WEBVIEW'")
            }
            putJsonArray("required") {
                add("name")
            }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val name = args["name"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing name")
        val type = args["type"]?.jsonPrimitive?.contentOrNull ?: "WEBVIEW"
        // 1. 创建面板（CanvasRepository.createPanel 仅接收 name；type 参数保留供未来扩展）
        val panel = canvasRepository.createPanel(name)
        // 2. 导航到新面板（M8 修复 C6：调 navigatorHolder.navigate，内部 withContext(Dispatchers.Main)）
        navigatorHolder.navigate(Routes.canvas(panel.id))
        return ToolResult.success(buildJsonObject {
            put("success", true)
            put("panelId", panel.id)
            put("name", name)
        })
    }
}
