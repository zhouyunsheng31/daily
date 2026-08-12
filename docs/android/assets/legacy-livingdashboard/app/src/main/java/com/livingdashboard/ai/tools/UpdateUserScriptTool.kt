package com.livingdashboard.ai.tools

import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ScriptMetadata
import com.livingdashboard.script.ScriptMetadataParser
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * update_userscript 工具（Spec 2.5.4 / Phase M4 T5）。
 *
 * 按 id 更新已存在的用户脚本。表单字段优先（缺失时保留原值）。
 *
 * v3 修复 M4：用 [ScriptMetadataParser.rewriteMetadata] 重写 code 中的 ==UserScript== 块，
 * 确保表单字段与代码块一致（表单字段为 source of truth）。保持代码正文不变，仅同步元数据块。
 *
 * 返回 [ToolResult.success] 含 JsonObject{id, updated:true}；
 * id 不存在返回 [ToolResult.error]("not found")。
 *
 * Hilt 注入：[UserScriptRepository]（@Singleton）+ [ScriptMetadataParser]（object，需 AppModule 提供 @Provides）。
 */
@Singleton
class UpdateUserScriptTool @Inject constructor(
    private val repository: UserScriptRepository,
    private val parser: ScriptMetadataParser,
) : Tool {

    override val definition = ToolDefinition(
        name = "update_userscript",
        description = "Update an existing userscript by id. All fields optional except id. " +
            "Form fields override existing values; ==UserScript== block in code is rewritten to stay in sync.",
        parameters = toolObjectSchema {
            putJsonObject("id") {
                put("type", "string")
                put("description", "Script id")
            }
            putJsonObject("name") {
                put("type", "string")
                put("description", "Script name")
            }
            putJsonObject("code") {
                put("type", "string")
                put("description", "JavaScript code body")
            }
            putJsonObject("description") {
                put("type", "string")
                put("description", "Human-readable description")
            }
            putJsonObject("matches") {
                put("type", "array")
                put("items", buildJsonObject { put("type", "string") })
                put("description", "URL glob patterns")
            }
            putJsonObject("grants") {
                put("type", "array")
                put("items", buildJsonObject { put("type", "string") })
                put("description", "GM_* API grants")
            }
            putJsonObject("runAt") {
                put("type", "string")
                put("description", "Injection timing: document-start | document-end | document-idle")
            }
            putJsonObject("enabled") {
                put("type", "boolean")
                put("description", "Whether the script is enabled")
            }
            putJsonArray("required") { add("id") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val id = args["id"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing id")
        val existing = repository.getById(id) ?: return ToolResult.error("not found")

        // 表单字段优先（缺失时保留原值）
        val newName = args["name"]?.jsonPrimitive?.contentOrNull ?: existing.name
        val newCode = args["code"]?.jsonPrimitive?.contentOrNull ?: existing.code
        val newDescription = args["description"]?.jsonPrimitive?.contentOrNull ?: existing.description
        val newMatches = args["matches"]?.jsonArray?.map { it.jsonPrimitive.content } ?: existing.matches
        val newGrants = args["grants"]?.jsonArray?.map { it.jsonPrimitive.content } ?: existing.grants
        val newRunAt = args["runAt"]?.jsonPrimitive?.contentOrNull ?: existing.runAt
        val newEnabled = args["enabled"]?.jsonPrimitive?.booleanOrNull ?: existing.enabled

        // v3 修复 M4：用 ScriptMetadataParser.rewriteMetadata 重写 code 中的 ==UserScript== 块
        // （表单字段为 source of truth；保持代码正文不变，仅同步元数据块）
        val rewrittenCode = parser.rewriteMetadata(
            code = newCode,
            metadata = ScriptMetadata(
                name = newName,
                namespace = existing.namespace,
                version = existing.version,
                description = newDescription,
                author = existing.author,
                matches = newMatches,
                includes = existing.includes,
                excludes = existing.excludes,
                grants = newGrants,
                runAt = newRunAt,
            ),
        )

        val updated = existing.copy(
            name = newName,
            code = rewrittenCode,
            description = newDescription,
            matches = newMatches,
            grants = newGrants,
            runAt = newRunAt,
            enabled = newEnabled,
        )
        repository.update(updated)

        return ToolResult.success(
            buildJsonObject {
                put("id", id)
                put("updated", true)
            },
        )
    }
}
