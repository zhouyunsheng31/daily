package com.livingdashboard.ai.tools

import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ScriptMetadataParser
import java.util.UUID
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
 * create_userscript 工具（Spec 2.5.3 / Phase M4 T5）。
 *
 * AI 生成脚本的入口工具。AI 提供 name + code（可选 description/matches/grants/runAt/enabled），
 * 工具用 [ScriptMetadataParser.parse] 从 code 中提取元数据（若含 ==UserScript== 块），
 * 表单字段覆盖解析结果，构造 [UserScriptEntity] 持久化到 Room。
 *
 * 表单字段覆盖规则（表单为 source of truth，缺失时回退到解析值或默认值）：
 * - name：表单必填，直接使用
 * - description/matches/grants/runAt/enabled：表单字段优先，缺失时用解析值，再缺失用默认值
 * - namespace/version/includes/excludes/author：用解析值（author 固定 "AI"）
 *
 * 返回 [ToolResult.success] 含 JsonObject{id, name, version}。
 *
 * Hilt 注入：[UserScriptRepository]（@Singleton）+ [ScriptMetadataParser]（object，需 AppModule 提供 @Provides）。
 */
@Singleton
class CreateUserScriptTool @Inject constructor(
    private val repository: UserScriptRepository,
    private val parser: ScriptMetadataParser,
) : Tool {

    override val definition = ToolDefinition(
        name = "create_userscript",
        description = "Create a userscript that will be injected into matching web pages. " +
            "Provide JavaScript code (may include ==UserScript== header; form fields override parsed metadata).",
        parameters = toolObjectSchema {
            putJsonObject("name") {
                put("type", "string")
                put("description", "Script name")
            }
            putJsonObject("code") {
                put("type", "string")
                put("description", "JavaScript code body (may include ==UserScript== header)")
            }
            putJsonObject("description") {
                put("type", "string")
                put("description", "Human-readable description (optional)")
            }
            putJsonObject("matches") {
                put("type", "array")
                put("items", buildJsonObject { put("type", "string") })
                put("description", "URL glob patterns, e.g. *://example.com/*")
            }
            putJsonObject("grants") {
                put("type", "array")
                put("items", buildJsonObject { put("type", "string") })
                put("description", "GM_* API grants, e.g. GM_setValue")
            }
            putJsonObject("runAt") {
                put("type", "string")
                put("description", "Injection timing: document-start | document-end | document-idle")
            }
            putJsonObject("enabled") {
                put("type", "boolean")
                put("description", "Whether the script is enabled (default true)")
            }
            putJsonArray("required") { add("name"); add("code") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val name = args["name"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing name")
        val code = args["code"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing code")

        // 用 ScriptMetadataParser.parse(code) 提取元数据（若 code 含 ==UserScript== 块）
        val parsed = parser.parse(code)
        val meta = parsed.metadata

        // 表单字段覆盖解析出的元数据（表单为 source of truth，缺失时回退到解析值或默认值）
        val formDescription = args["description"]?.jsonPrimitive?.contentOrNull
        val formMatches = args["matches"]?.jsonArray?.map { it.jsonPrimitive.content }
        val formGrants = args["grants"]?.jsonArray?.map { it.jsonPrimitive.content }
        val formRunAt = args["runAt"]?.jsonPrimitive?.contentOrNull
        val formEnabled = args["enabled"]?.jsonPrimitive?.booleanOrNull

        val finalDescription = formDescription ?: meta.description
        val finalMatches = formMatches ?: meta.matches
        val finalGrants = formGrants ?: meta.grants
        val finalRunAt = formRunAt ?: meta.runAt
        val finalEnabled = formEnabled ?: true

        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()

        repository.insert(
            UserScriptEntity(
                id = id,
                name = name,
                namespace = meta.namespace,
                version = meta.version,
                description = finalDescription,
                author = "AI",
                matches = finalMatches,
                includes = meta.includes,
                excludes = meta.excludes,
                grants = finalGrants,
                runAt = finalRunAt,
                code = code,
                rawMetadata = parsed.rawMetadata,
                enabled = finalEnabled,
                source = "ai",
                createdAt = now,
                updatedAt = now,
                versionCode = 1,
            ),
        )

        return ToolResult.success(
            buildJsonObject {
                put("id", id)
                put("name", name)
                put("version", meta.version)
            },
        )
    }
}
