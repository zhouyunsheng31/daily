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
 * storage_read 工具（Spec 6.9.2 行 1041）。
 *
 * 从本地 KV 存储读取一个值。底层 [KvStorage] 由 DI 注入。
 */
class StorageReadTool(
    private val kvStorage: KvStorage,
) : Tool {

    override val definition = ToolDefinition(
        name = "storage_read",
        description = "Read a value from local key-value storage (DataStore Preferences).",
        parameters = toolObjectSchema {
            putJsonObject("key") {
                put("type", "string")
                put("description", "Storage key")
            }
            putJsonArray("required") { add("key") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val key = args["key"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing key")
        val value = kvStorage.read(key)
        return ToolResult.success(buildJsonObject {
            put("key", key)
            put("value", value ?: "")
        })
    }
}
