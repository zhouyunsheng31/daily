package com.livingdashboard.ai.tools

import android.webkit.WebView
import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.coroutines.resume

/**
 * browser_eval 工具（Spec 6.9.6 行 1281）。
 *
 * 在当前活跃 [WebView] 上执行 JavaScript 并返回结果。
 *
 * Spec/Task 原文 webviewProvider: () -> LivingWebView?，但 LivingWebView 是 @Composable 函数
 * 而非 class（见 LivingWebView.kt:96）。实际活跃 WebView 是 android.webkit.WebView 实例，
 * 由 CanvasHomeViewModel/BrowserViewModel 持有。此处按真实类型 [WebView] 调整。
 *
 * evaluateJavascript 是异步回调，用 [suspendCancellableCoroutine] 包装成 suspend。
 * 必须用 webView.post { ... } 切回主线程（WebView 单线程模型）。
 */
class BrowserEvalTool(
    private val webviewProvider: () -> WebView?,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_eval",
        description = "Evaluate JavaScript in the active WebView and return result.",
        parameters = toolObjectSchema {
            putJsonObject("script") {
                put("type", "string")
                put("description", "JavaScript code to evaluate")
            }
            putJsonArray("required") { add("script") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val script = args["script"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing script")
        val result: String? = suspendCancellableCoroutine { cont ->
            webView.post {
                webView.evaluateJavascript(script) { value ->
                    if (cont.isActive) cont.resume(value)
                }
            }
        }
        return ToolResult.success(buildJsonObject {
            put("result", result ?: "null")
        })
    }
}
