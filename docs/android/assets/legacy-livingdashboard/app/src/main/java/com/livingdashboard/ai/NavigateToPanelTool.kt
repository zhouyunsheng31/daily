package com.livingdashboard.ai

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
 * navigate_to_panel 工具（Spec 6.9.10 行 1562）。
 *
 * 切换到指定画布面板。
 *
 * 通过 [ActiveNavigatorHolder.navigate] 导航（M8 修复：内部 withContext(Dispatchers.Main)，
 * NavController 必须主线程访问）。路由用 [Routes.canvas] 拼接。
 *
 * 任务清单简化版：仅支持 panelId 参数（spec 原版还支持 panelName 模糊查找，本实现按
 * 任务清单只接收 panelId）。
 *
 * 返回 `{success: true, navigatedTo: panelId}`。
 */
class NavigateToPanelTool(
    private val navigatorHolder: ActiveNavigatorHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "navigate_to_panel",
        description = "Navigate to a canvas panel by its ID.",
        parameters = toolObjectSchema {
            putJsonObject("panelId") {
                put("type", "string")
                put("description", "Panel ID to navigate to")
            }
            putJsonArray("required") {
                add("panelId")
            }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val panelId = args["panelId"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing panelId")
        // M8 修复（C6）：调 navigatorHolder.navigate（内部 withContext(Dispatchers.Main)）
        // 不直接操作 NavController，不使用 navigator.post（NavController 无 post 方法）
        navigatorHolder.navigate(Routes.canvas(panelId))
        return ToolResult.success(buildJsonObject {
            put("success", true)
            put("navigatedTo", panelId)
        })
    }
}
