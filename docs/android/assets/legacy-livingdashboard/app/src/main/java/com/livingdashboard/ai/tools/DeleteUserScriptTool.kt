package com.livingdashboard.ai.tools

import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import com.livingdashboard.data.repository.UserScriptRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * delete_userscript 工具（Spec 2.5.6 / Phase M4 T5）。
 *
 * 按 id 删除用户脚本。先查找确认存在，不存在返回 [ToolResult.error]("not found")。
 *
 * 返回 [ToolResult.success] 含 JsonObject{id, deleted:true}。
 *
 * Hilt 注入：[UserScriptRepository]（@Singleton）。
 */
@Singleton
class DeleteUserScriptTool @Inject constructor(
    private val repository: UserScriptRepository,
) : Tool {

    override val definition = ToolDefinition(
        name = "delete_userscript",
        description = "Delete a userscript by id.",
        parameters = toolObjectSchema {
            putJsonObject("id") {
                put("type", "string")
                put("description", "Script id")
            }
            putJsonArray("required") { add("id") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val id = args["id"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing id")
        repository.getById(id) ?: return ToolResult.error("not found")
        repository.deleteById(id)
        return ToolResult.success(
            buildJsonObject {
                put("id", id)
                put("deleted", true)
            },
        )
    }
}
