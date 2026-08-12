package com.livingdashboard.ai

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * browser_get_dom 工具（Spec 6.9.6 节）。
 *
 * 获取页面 DOM HTML。可选 selector 仅获取子树。
 *
 * - `selector` 可选：不传则取 `document.documentElement.outerHTML`，传则取 `querySelector(selector).outerHTML`
 * - **m16 修复**：限制返回长度 50000 字符——从末尾截断保留前面的 DOM 结构（head/body 开头比末尾 script 更重要）
 * - 截断时在末尾追加 `"\n...[truncated, total=X chars]"`
 * - 字符串拼接 + [JSONObject.quote] 转义 selector
 * - [suspendCancellableCoroutine] + `webView.post` + `evaluateJavascript` + [withTimeoutOrNull]`（30_000）
 */
class BrowserGetDomTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_get_dom",
        description = "获取页面 DOM HTML。可选 selector 仅获取子树。",
        parameters = toolObjectSchema {
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector，可选。不传则取 document.documentElement.outerHTML")
            }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
        val quotedSelector = selector?.let { JSONObject.quote(it) } ?: "null"
        val js = """
            (function(){
                try {
                    const el = $quotedSelector ? document.querySelector($quotedSelector) : document.documentElement;
                    if (!el) return JSON.stringify({html: "", error: "element not found"});
                    const html = el.outerHTML;
                    // m16：50000 字符截断——从末尾截断保留前面的 DOM 结构
                    const MAX = 50000;
                    if (html.length <= MAX) return JSON.stringify({html: html, total: html.length, truncated: false});
                    return JSON.stringify({html: html.substring(0, MAX) + "\n...[truncated, total=" + html.length + " chars]", total: html.length, truncated: true});
                } catch(e) {
                    return JSON.stringify({html: "", error: e.message});
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
        } ?: return ToolResult.error("get_dom timeout")

        // 解析 result JSON（evaluateJavascript 对 string 返回值会加引号，需两次解析）
        return try {
            val obj = unquoteJson(result) ?: return ToolResult.error("invalid result: $result")
            if (obj["error"] != null) {
                ToolResult.error(obj["error"]!!.jsonPrimitive.content)
            } else {
                ToolResult.success(obj)
            }
        } catch (e: Exception) {
            ToolResult.error("invalid result: $result")
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
