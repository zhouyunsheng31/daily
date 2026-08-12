package com.livingdashboard.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * browser_forward 工具（Spec 6.9.8 行 1478，与 Back/Reload 同组）。
 *
 * 在当前活跃 [android.webkit.WebView] 历史中前进。
 *
 * 通过 [ActiveWebViewHolder] 取当前 WebView。canGoForward 必须主线程访问，故用
 * [withContext]([Dispatchers.Main])。goForward 用 webView.post { ... } 切回主线程。
 *
 * 返回 `{success: true, canGoForward: Boolean}`：即使不能前进也返回 success=true，
 * 但 canGoForward=false 让 LLM 知道状态。
 */
class BrowserForwardTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_forward",
        description = "Go forward in the active WebView's history.",
        parameters = toolObjectSchema { /* 无参数 */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val canGoForward = withContext(Dispatchers.Main) { webView.canGoForward() }
        if (canGoForward) {
            webView.post { webView.goForward() }
        }
        return ToolResult.success(buildJsonObject {
            put("success", true)
            put("canGoForward", canGoForward)
        })
    }
}
