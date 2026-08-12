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
 * browser_click 工具（Spec 6.9.1 节）。
 *
 * 点击页面中匹配 CSS selector 的元素。
 *
 * 关键实现点：
 * - 字符串拼接 + [JSONObject.quote] 转义 selector（不用 String.format，避免 `%` 冲突——代码 C5 修复）
 * - 参数 schema 用 `putJsonObject` 替代不存在的 `stringSchema`（代码 C1 修复）
 * - [suspendCancellableCoroutine] + `webView.post` + `evaluateJavascript` + [withTimeoutOrNull]`（30_000）
 * - 构造函数接收 [ActiveWebViewHolder]，通过 `webviewHolder.value.value` 取当前活跃 WebView
 */
class BrowserClickTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_click",
        description = "点击页面中匹配 CSS selector 的元素。",
        parameters = toolObjectSchema {
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector，如 #login-btn 或 .submit")
            }
            putJsonArray("required") { add("selector") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing selector")
        // 代码 C5：字符串拼接 + JSONObject.quote 转义，避免 String.format 与 % 冲突
        val quotedSelector = JSONObject.quote(selector)
        val js = """
            (function(){
                try {
                    const selector = $quotedSelector;
                    const el = document.querySelector(selector);
                    if (!el) return JSON.stringify({clicked: false, error: "element not found"});
                    el.click();
                    return JSON.stringify({clicked: true});
                } catch(e) {
                    return JSON.stringify({clicked: false, error: e.message});
                }
            })()
        """.trimIndent()
        val result = withTimeoutOrNull(30_000) {
            suspendCancellableCoroutine<String?> { cont ->
                webView.post {
                    webView.evaluateJavascript(js) { value ->
                        if (cont.isActive) cont.resume(value)
                    }
                }
            }
        } ?: return ToolResult.error("click timeout")

        return parseResult(result)
    }

    private fun parseResult(result: String?): ToolResult {
        if (result == null || result == "null") {
            return ToolResult.error("click returned null")
        }
        val obj = unquoteJson(result) ?: return ToolResult.error("invalid result: $result")
        val clicked = obj["clicked"]?.jsonPrimitive?.booleanOrNull ?: false
        return if (clicked) {
            ToolResult.success(buildJsonObject { put("clicked", true) })
        } else {
            val error = obj["error"]?.jsonPrimitive?.contentOrNull ?: "click failed"
            ToolResult.error(error)
        }
    }

    /**
     * 解析 evaluateJavascript 返回值。JS 返回 `JSON.stringify({...})` 时，
     * Android WebView 回调会再包一层引号，需两次解析：先解外层字符串引号，再解内层 JSON 对象。
     */
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
