package com.livingdashboard.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * 当前页面上下文（Spec 6.7 节）。
 *
 * @param url 当前活跃 WebView 的 URL（空字符串表示无页面）
 * @param title 当前活跃 WebView 的标题
 */
data class PageContext(val url: String, val title: String)

/**
 * 页面上下文提供者（Spec 6.7 节）。
 *
 * 读取当前活跃 WebView 的 URL/title，拼成 system prompt 附录字符串。
 *
 * - WebView 的 url/title 必须在主线程读取
 * - 用 [withContext]([Dispatchers.Main]) 切到主线程
 * - 当前无活跃 WebView 时返回 null
 *
 * @param activeWebViewHolder 活跃 WebView 持有者（M8 已存在）
 */
class PageContextProvider @Inject constructor(
    private val activeWebViewHolder: ActiveWebViewHolder,
) {
    /**
     * 获取当前活跃 WebView 的页面上下文。
     *
     * @return [PageContext]（url 非空时）；无活跃 WebView 或 url 为空时返回 null
     */
    suspend fun getCurrentContext(): PageContext? {
        val webView = activeWebViewHolder.value.value ?: return null
        return withContext(Dispatchers.Main) {
            val url = webView.url ?: ""
            val title = webView.title ?: ""
            PageContext(url, title).takeIf { it.url.isNotBlank() }
        }
    }
}
