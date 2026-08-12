package com.livingdashboard.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * browser_wait_for 工具（Spec 6.9.4 节）。
 *
 * 等待匹配 CSS selector 的元素出现在页面中。用 polling 模式（不用 Promise）。
 *
 * **实现思路**（代码 C4 修复：Android WebView 的 `evaluateJavascript` 不会可靠地 await Promise）：
 * 1. JS 注入：定义 IIFE 用 `setInterval`（100ms）轮询 `document.querySelector(selector)`，
 *    找到元素后写入 `window.__livingWaitResult = JSON.stringify({found:true, elapsedMs})`，并 `clearInterval`
 * 2. Kotlin 侧用 `while(isActive) + delay(200) + evaluateJavascript` 轮询 `__livingWaitResult`
 * 3. 完成后清理 `__livingWaitPolling`（interval ID）和 `__livingWaitResult`（避免下次复用污染）
 *
 * 超时层次（5.5 节）：硬上限 29000ms，留 1s 给外层 `withTimeoutOrNull(timeoutMs + 1000)` 兜底。
 */
class BrowserWaitForTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_wait_for",
        description = "等待匹配 CSS selector 的元素出现在页面中。",
        parameters = toolObjectSchema {
            putJsonObject("selector") {
                put("type", "string")
                put("description", "CSS selector")
            }
            putJsonObject("timeoutMs") {
                put("type", "integer")
                put("description", "超时毫秒，默认 25000，硬上限 29000")
                put("default", 25000)
            }
            putJsonArray("required") { add("selector") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val selector = args["selector"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing selector")
        // 5.5 节超时层次：硬上限 29000ms，留 1s 给外层 withTimeoutOrNull 兜底
        val timeoutMs = (args["timeoutMs"]?.jsonPrimitive?.intOrNull ?: 25000).coerceAtMost(29000)

        val quotedSelector = JSONObject.quote(selector)
        // 1. 注入 JS：启动 setInterval 轮询，结果写到 window.__livingWaitResult
        val injectJs = """
            (function(selector, timeoutMs){
                window.__livingWaitResult = null;
                window.__livingWaitPolling && clearInterval(window.__livingWaitPolling);
                const start = Date.now();
                window.__livingWaitPolling = setInterval(function(){
                    try {
                        if (document.querySelector(selector)) {
                            window.__livingWaitResult = JSON.stringify({found: true, elapsedMs: Date.now() - start});
                            clearInterval(window.__livingWaitPolling);
                            return;
                        }
                    } catch(e) {
                        window.__livingWaitResult = JSON.stringify({found: false, error: e.message});
                        clearInterval(window.__livingWaitPolling);
                        return;
                    }
                    if (Date.now() - start >= timeoutMs) {
                        window.__livingWaitResult = JSON.stringify({found: false, elapsedMs: Date.now() - start});
                        clearInterval(window.__livingWaitPolling);
                    }
                }, 100);
            })($quotedSelector, $timeoutMs);
        """.trimIndent()

        // 2. 注入 JS（主线程），不等待回调
        withContext(Dispatchers.Main) {
            webView.evaluateJavascript(injectJs, null)
        }

        // 3. Kotlin 侧 polling：每 200ms 查一次 __livingWaitResult（原子读取并清除）
        val result = withTimeoutOrNull(timeoutMs + 1000L) {
            while (isActive) {
                delay(200)
                val raw = withContext(Dispatchers.Main) {
                    suspendCancellableCoroutine<String?> { cont ->
                        webView.evaluateJavascript(
                            "(function(){const r = window.__livingWaitResult; window.__livingWaitResult = null; return r;})()"
                        ) { value ->
                            if (cont.isActive) cont.resume(value)
                        }
                    }
                }
                // evaluateJavascript 返回 "null" 字符串表示变量为 null，返回 JSON 字符串表示有结果
                if (raw != null && raw != "null") {
                    return@withTimeoutOrNull raw
                }
            }
            null
        } ?: return ToolResult.error("wait_for timeout after ${timeoutMs}ms")

        // 4. 清理全局变量（避免下次复用污染）
        withContext(Dispatchers.Main) {
            webView.evaluateJavascript(
                "if(window.__livingWaitPolling){clearInterval(window.__livingWaitPolling);window.__livingWaitPolling=null;}window.__livingWaitResult=null;",
                null
            )
        }

        // 5. 解析 JSON 结果（evaluateJavascript 对 string 返回值会加引号，需两次解析）
        return try {
            val obj = unquoteJson(result) ?: return ToolResult.error("invalid result: $result")
            val found = obj["found"]?.jsonPrimitive?.booleanOrNull ?: false
            ToolResult.success(buildJsonObject {
                put("found", found)
                obj["elapsedMs"]?.let { put("elapsedMs", it) }
            })
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
