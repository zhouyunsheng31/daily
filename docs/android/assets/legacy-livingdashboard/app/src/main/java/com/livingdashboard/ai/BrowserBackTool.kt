package com.livingdashboard.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * browser_back 工具（Spec 6.9.8 行 1478）。
 *
 * 在当前活跃 [android.webkit.WebView] 历史中后退。
 *
 * 通过 [ActiveWebViewHolder] 取当前 WebView。canGoBack 必须主线程访问，故用
 * [withContext]([Dispatchers.Main])。goBack 用 webView.post { ... } 切回主线程。
 *
 * 返回 `{success: true, canGoBack: Boolean}`：即使不能后退也返回 success=true，
 * 但 canGoBack=false 让 LLM 知道状态。
 */
class BrowserBackTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_back",
        description = "Go back in the active WebView's history.",
        parameters = toolObjectSchema { /* 无参数 */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val canGoBack = withContext(Dispatchers.Main) { webView.canGoBack() }
        if (canGoBack) {
            webView.post { webView.goBack() }
        }
        return ToolResult.success(buildJsonObject {
            put("success", true)
            put("canGoBack", canGoBack)
        })
    }
}
