package com.livingdashboard.ai

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * browser_input 工具（Spec 6.9.2 节）。
 *
 * 在匹配 CSS selector 的输入框中设置文本值，并触发 input/change 事件。
 *
 * JS: `el.value = text; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}))`
 *
 * - 字符串拼接 + [JSONObject.quote] 转义 selector 和 value
 * - [suspendCancellableCoroutine] + `webView.post` + `evaluateJavascript` + [withTimeoutOrNull]`（30_000）
 */
class BrowserInputTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_input",
        description = "在匹配 CSS selector 的输入框中设置文本值，并触发 input/change 事件。",
        parameters = toolObjectSchema {
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector，如 #search-input")
            }
            putJsonObject("value") {
                put("type", "string")
                put("description", "要输入的文本值")
            }
            putJsonArray("required") { add("selector"); add("value") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing selector")
        val value = args["value"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing value")
        val quotedSelector = JSONObject.quote(selector)
        val quotedValue = JSONObject.quote(value)
        val js = """
            (function(){
                try {
                    const selector = $quotedSelector;
                    const text = $quotedValue;
                    const el = document.querySelector(selector);
                    if (!el) return JSON.stringify({input: false, error: "element not found"});
                    el.value = text;
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    return JSON.stringify({input: true});
                } catch(e) {
                    return JSON.stringify({input: false, error: e.message});
                }
            })()
        """.trimIndent()
        val result = withTimeoutOrNull(30_000) {
            suspendCancellableCoroutine<String?> { cont ->
                webView.post {
                    webView.evaluateJavascript(js) { v ->
                        if (cont.isActive) cont.resume(v)
                    }
                }
            }
        } ?: return ToolResult.error("input timeout")

        return parseResult(result)
    }

    private fun parseResult(result: String?): ToolResult {
        if (result == null || result == "null") {
            return ToolResult.error("input returned null")
        }
        val obj = unquoteJson(result) ?: return ToolResult.error("invalid result: $result")
        val input = obj["input"]?.jsonPrimitive?.booleanOrNull ?: false
        return if (input) {
            ToolResult.success(buildJsonObject { put("input", true) })
        } else {
            val error = obj["error"]?.jsonPrimitive?.contentOrNull ?: "input failed"
            ToolResult.error(error)
        }
    }

    private fun unquoteJson(result: String): JsonObject? = try {
        val element = Json.parseToJsonElement(result)
        if (element is JsonPrimitive && element.isString) {
            Json.parseToJsonElement(element.content).jsonObject
        } else {
            element.jsonObject
        }
    } catch (e: Exception) {
        null
    }
}
