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
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * list_userscripts 工具（Spec 2.5.5 / Phase M4 T5）。
 *
 * 列出所有用户脚本。[repository.snapshot] 仅返回 enabled=true 的脚本
 * （ScriptInjector 用，避免每次注入都查 DB）。
 *
 * 可选 enabled 参数过滤：由于 snapshot 已过滤 enabled=true，
 * 传 enabled=true 返回全部快照；传 enabled=false 返回空列表；不传返回全部快照。
 *
 * 返回 [ToolResult.success] 含 JsonObject{scripts: JsonArray}，
 * 每个脚本含 id/name/enabled/matches。
 *
 * Hilt 注入：[UserScriptRepository]（@Singleton）。
 */
@Singleton
class ListUserScriptsTool @Inject constructor(
    private val repository: UserScriptRepository,
) : Tool {

    override val definition = ToolDefinition(
        name = "list_userscripts",
        description = "List all userscripts. Optionally filter by enabled status.",
        parameters = toolObjectSchema {
            putJsonObject("enabled") {
                put("type", "boolean")
                put("description", "Filter by enabled status (optional)")
            }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val enabledFilter = args["enabled"]?.jsonPrimitive?.booleanOrNull
        val list = repository.snapshot().let { all ->
            if (enabledFilter == null) all else all.filter { it.enabled == enabledFilter }
        }
        return ToolResult.success(
            buildJsonObject {
                putJsonArray("scripts") {
                    list.forEach { s ->
                        add(buildJsonObject {
                            put("id", s.id)
                            put("name", s.name)
                            put("enabled", s.enabled)
                            putJsonArray("matches") { s.matches.forEach { add(it) } }
                        })
                    }
                }
            },
        )
    }
}
