package com.livingdashboard.ai

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * browser_reload 工具（Spec 6.9.8 行 1478，与 Back/Forward 同组）。
 *
 * 重新加载当前活跃 [android.webkit.WebView] 的页面。
 *
 * 通过 [ActiveWebViewHolder] 取当前 WebView。reload 用 webView.post { ... } 切回主线程
 * （WebView 单线程模型，必须主线程访问）。
 *
 * 返回 `{success: true}`。
 */
class BrowserReloadTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_reload",
        description = "Reload the current page in the active WebView.",
        parameters = toolObjectSchema { /* 无参数 */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        webView.post { webView.reload() }
        return ToolResult.success(buildJsonObject {
            put("success", true)
        })
    }
}
