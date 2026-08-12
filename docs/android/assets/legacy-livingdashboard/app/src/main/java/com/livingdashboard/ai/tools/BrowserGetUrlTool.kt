package com.livingdashboard.ai.tools

import android.webkit.WebView
import com.livingdashboard.ai.Tool
import com.livingdashboard.ai.ToolDefinition
import com.livingdashboard.ai.ToolResult
import com.livingdashboard.ai.toolObjectSchema
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * browser_get_url 工具（Spec 6.9.6 行 1325）。
 *
 * 返回活跃 [WebView] 的当前 URL。WebView.url 可能在页面加载中为 null，工具内统一兜底为空串。
 */
class BrowserGetUrlTool(
    private val webviewProvider: () -> WebView?,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_get_url",
        description = "Get the current URL of the active WebView.",
        parameters = toolObjectSchema { /* 无参 */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewProvider() ?: return ToolResult.error("no active webview")
        val url = webView.url ?: ""
        return ToolResult.success(buildJsonObject {
            put("url", url)
        })
    }
}
