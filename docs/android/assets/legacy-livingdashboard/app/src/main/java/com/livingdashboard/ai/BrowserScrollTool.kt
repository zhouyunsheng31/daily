package com.livingdashboard.ai

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * browser_scroll 工具（Spec 6.9.3 节）。
 *
 * 滚动页面或指定元素。
 *
 * - 参数：x（Int, 默认 0）、y（Int, 默认 0）、selector（String?, 可选）
 * - 若有 selector：设置 `element.scrollLeft = x; element.scrollTop = y`
 * - 若无 selector：`window.scrollBy(x, y)` 滚动整个页面
 * - 字符串拼接 + [JSONObject.quote] 转义 selector
 * - [suspendCancellableCoroutine] + `webView.post` + `evaluateJavascript` + [withTimeoutOrNull]`（30_000）
 */
class BrowserScrollTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_scroll",
        description = "滚动页面。若有 selector 则设置该元素的 scrollLeft/Top，否则用 window.scrollBy 滚动整个页面。",
        parameters = toolObjectSchema {
            putJsonObject("x") {
                put("type", "integer")
                put("description", "水平滚动量（像素），默认 0")
                put("default", 0)
            }
            putJsonObject("y") {
                put("type", "integer")
                put("description", "垂直滚动量（像素），默认 0")
                put("default", 0)
            }
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector，可选。指定时设置该元素的 scrollLeft/Top")
            }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val x = args["x"]?.jsonPrimitive?.intOrNull ?: 0
        val y = args["y"]?.jsonPrimitive?.intOrNull ?: 0
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
        val quotedSelector = selector?.let { JSONObject.quote(it) } ?: "null"
        val js = """
            (function(){
                try {
                    const x = $x;
                    const y = $y;
                    const selector = $quotedSelector;
                    if (selector !== null) {
                        const el = document.querySelector(selector);
                        if (!el) return JSON.stringify({scrolled: false, error: "element not found"});
                        el.scrollLeft = x;
                        el.scrollTop = y;
                        return JSON.stringify({scrolled: true, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop});
                    } else {
                        window.scrollBy(x, y);
                        return JSON.stringify({scrolled: true, scrollX: window.scrollX, scrollY: window.scrollY});
                    }
                } catch(e) {
                    return JSON.stringify({scrolled: false, error: e.message});
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
        } ?: return ToolResult.error("scroll timeout")

        return parseResult(result)
    }

    private fun parseResult(result: String?): ToolResult {
        if (result == null || result == "null") {
            return ToolResult.error("scroll returned null")
        }
        val obj = unquoteJson(result) ?: return ToolResult.error("invalid result: $result")
        val scrolled = obj["scrolled"]?.jsonPrimitive?.booleanOrNull ?: false
        return if (scrolled) {
            ToolResult.success(obj)
        } else {
            val error = obj["error"]?.jsonPrimitive?.contentOrNull ?: "scroll failed"
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
