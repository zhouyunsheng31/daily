package com.livingdashboard.ai

import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * browser_get_cookie 工具（Spec 6.9.9 行 1500）。
 *
 * 获取当前 URL（或指定 URL）的所有 cookies。
 *
 * 通过 [ActiveWebViewHolder] 取当前 WebView，默认 url 取 WebView.url（主线程读取）。
 * 用 [CookieManager.getInstance].getCookie(url) 直接读取（不经过 CookieManagerWrapper，
 * 任务清单明确要求直接用 CookieManager）。
 *
 * m7 修复：getCookie 返回 String?，**不要 `?: ""`**——null 时直接用 [JsonNull] 让 LLM
 * 看到 cookies=null 知道无 cookie，而非误以为是空字符串。
 *
 * 返回 `{cookies: String|null, url: String}`。
 */
class BrowserGetCookieTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_get_cookie",
        description = "Get all cookies for the current URL (or a specified URL) from the active WebView.",
        parameters = toolObjectSchema {
            putJsonObject("url") {
                put("type", "string")
                put("description", "URL to get cookies for. Defaults to the current WebView URL.")
            }
            // url 可选，无 required
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        // 参数 url 优先，否则取当前 WebView 的 url（主线程读取）
        val url = args["url"]?.jsonPrimitive?.contentOrNull
            ?: withContext(Dispatchers.Main) { webView.url }
            ?: return ToolResult.error("no url")
        // 任务清单：用 CookieManager.getInstance().getCookie(url)，返回 String?，不要 ?: ""
        val cookies: String? = CookieManager.getInstance().getCookie(url)
        return ToolResult.success(buildJsonObject {
            // m7：cookies 为 null 时 put(String?) 重载自动写入 JsonNull，
            // 让 LLM 看到 cookies=null 知道无 cookie（不用 ?: ""）
            put("cookies", cookies)
            put("url", url)
        })
    }
}
