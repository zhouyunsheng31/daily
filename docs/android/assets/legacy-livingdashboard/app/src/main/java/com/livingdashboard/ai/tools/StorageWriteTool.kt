package com.livingdashboard.ai.tools

import com.livingdashboard.ai.KvStorage
import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * storage_write 工具（Spec 6.9.2 行 1062）。
 *
 * 写入一个值到本地 KV 存储。底层 [KvStorage] 由 DI 注入。
 */
class StorageWriteTool(
    private val kvStorage: KvStorage,
) : Tool {

    override val definition = ToolDefinition(
        name = "storage_write",
        description = "Write a value to local key-value storage.",
        parameters = toolObjectSchema {
            putJsonObject("key") {
                put("type", "string")
                put("description", "Storage key")
            }
            putJsonObject("value") {
                put("type", "string")
                put("description", "Storage value")
            }
            putJsonArray("required") { add("key"); add("value") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val key = args["key"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing key")
        val value = args["value"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing value")
        kvStorage.write(key, value)
        return ToolResult.success(buildJsonObject {
            put("key", key)
            put("success", true)
        })
    }
}
