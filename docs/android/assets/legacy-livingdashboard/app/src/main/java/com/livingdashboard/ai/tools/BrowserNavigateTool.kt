package com.livingdashboard.ai.tools

import android.webkit.WebView
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
 * browser_navigate 工具（Spec 6.9.6 行 1306）。
 *
 * 让活跃 [WebView] 加载指定 URL。loadUrl 必须在主线程调用，故用 webView.post { ... } 切回。
 */
class BrowserNavigateTool(
    private val webviewProvider: () -> WebView?,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_navigate",
        description = "Navigate the active WebView to a URL.",
        parameters = toolObjectSchema {
            putJsonObject("url") {
                put("type", "string")
                put("description", "URL to navigate to")
            }
            putJsonArray("required") { add("url") }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val url = args["url"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing url")
        webView.post { webView.loadUrl(url) }
        return ToolResult.success(buildJsonObject {
            put("url", url)
            put("success", true)
        })
    }
}
