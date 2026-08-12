package com.livingdashboard.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume

/**
 * browser_get_title 工具（Spec 6.9.7 行 1460）。
 *
 * 在当前活跃 [android.webkit.WebView] 上执行 JS `document.title` 获取页面标题。
 *
 * 通过 [ActiveWebViewHolder] 取当前 WebView（M3 统一用 holder 而非 webviewProvider lambda）。
 * evaluateJavascript 是异步回调，用 [suspendCancellableCoroutine] 包装成 suspend，
 * 通过 [withContext]([Dispatchers.Main]) 切主线程（WebView 单线程模型）。
 *
 * evaluateJavascript 返回值是 JSON 编码字符串（如 `"Hello"` 或 `null`），需要解析。
 */
class BrowserGetTitleTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_get_title",
        description = "Get the title of the current page in the active WebView via document.title.",
        parameters = toolObjectSchema { /* 无参数 */ },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val rawTitle: String? = withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { cont ->
                webView.evaluateJavascript("document.title") { value ->
                    if (cont.isActive) cont.resume(value)
                }
            }
        }
        // evaluateJavascript 返回 JSON 编码字符串：标题为 "Hello" 时返回 "\"Hello\""，无标题时返回 "null"
        val title: String = when {
            rawTitle == null -> ""
            rawTitle == "null" -> ""
            else -> try {
                Json.decodeFromString<String>(rawTitle)
            } catch (e: Exception) {
                rawTitle
            }
        }
        return ToolResult.success(buildJsonObject {
            put("title", title)
        })
    }
}
