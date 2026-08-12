package com.livingdashboard.ai

import android.webkit.CookieManager
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * browser_set_cookie 工具（Spec 6.9.9 行 1500，与 GetCookie 同组）。
 *
 * 为指定 URL 设置 cookie。
 *
 * 通过 [ActiveWebViewHolder] 取当前 WebView（仅用于校验有活跃 WebView）。
 * 用 [CookieManager.getInstance].setCookie(url, cookieString) 直接设置（任务清单要求）。
 *
 * 拼接 cookie 字符串：`"$name=$value; path=$path; domain=$domain"`（domain 可选）。
 * expires 可选，附加到 cookie 字符串尾部。
 *
 * 返回 `{success: true}`。
 */
class BrowserSetCookieTool(
    private val webviewHolder: ActiveWebViewHolder,
) : Tool {

    override val definition = ToolDefinition(
        name = "browser_set_cookie",
        description = "Set a cookie for the specified URL.",
        parameters = toolObjectSchema {
            putJsonObject("url") {
                put("type", "string")
                put("description", "URL to set cookie for")
            }
            putJsonObject("name") {
                put("type", "string")
                put("description", "cookie name")
            }
            putJsonObject("value") {
                put("type", "string")
                put("description", "cookie value")
            }
            putJsonObject("domain") {
                put("type", "string")
                put("description", "optional, cookie domain")
            }
            putJsonObject("path") {
                put("type", "string")
                put("description", "cookie path, default '/'")
            }
            putJsonObject("expires") {
                put("type", "string")
                put("description", "optional, cookie expiration date")
            }
            putJsonArray("required") {
                add("url")
                add("name")
                add("value")
            }
        },
    )

    override suspend fun execute(args: JsonObject): ToolResult {
        // 校验有活跃 WebView（统一兜底，虽然 setCookie 严格不需要 WebView 实例）
        @Suppress("UNUSED_VARIABLE")
        val webView = webviewHolder.value.value
            ?: return ToolResult.error("no active webview")
        val url = args["url"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing url")
        val name = args["name"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing name")
        val value = args["value"]?.jsonPrimitive?.contentOrNull
            ?: return ToolResult.error("missing value")
        val domain = args["domain"]?.jsonPrimitive?.contentOrNull
        val path = args["path"]?.jsonPrimitive?.contentOrNull ?: "/"
        val expires = args["expires"]?.jsonPrimitive?.contentOrNull

        // 拼接 cookie 字符串：name=value; path=/; domain=xxx; expires=xxx
        val cookieBuilder = StringBuilder("$name=$value; path=$path")
        if (domain != null) {
            cookieBuilder.append("; domain=$domain")
        }
        if (expires != null) {
            cookieBuilder.append("; expires=$expires")
        }
        CookieManager.getInstance().setCookie(url, cookieBuilder.toString())
        return ToolResult.success(buildJsonObject {
            put("success", true)
        })
    }
}
