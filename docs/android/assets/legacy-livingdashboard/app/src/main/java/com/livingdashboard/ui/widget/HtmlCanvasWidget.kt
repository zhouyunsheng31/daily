package com.livingdashboard.ui.widget

import android.annotation.SuppressLint
import android.util.Log
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Html
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * HtmlCanvasWidget（Spec A.5，D11 依赖 WebviewWidget）。
 *
 * 用 WebView 渲染任意 HTML 字符串（loadDataWithBaseURL，避免外网请求）。
 *
 * state 字段：
 * - html: String —— 要渲染的 HTML 内容
 *
 * 分层渲染（D9）：
 * - THUMBNAIL：HTML 图标
 * - SUMMARY：HTML 标题（从 <title> 提取）或前 50 字符
 * - INTERACTIVE/FULL：完整 WebView 渲染 HTML
 *
 * **v4 #16 修复**：用 [lastLoadedHtml] 跟踪上次加载到 WebView 的 HTML。
 * 原Bug：update lambda 中 `currentHtml = params.state["html"]` 与外层 `html`（同源）比较，
 * recomposition 后两者都更新为新值，恒相等，导致 HTML 变化后永不重新加载。
 * 修复：用 remember 持久化 lastLoadedHtml，factory/update 完成加载后更新它，
 * 后续 update 与 lastLoadedHtml 比较（而非与当前 html 比较）。
 *
 * 生命周期：onDispose 调用 [WebView.destroy] 释放资源（避免内存泄漏）。
 *
 * @param params 渲染参数，state["html"] 为 HTML 内容
 */
@Composable
fun HtmlCanvasWidget(params: WidgetRenderParams) {
    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> HtmlCanvasThumbnail(params)
        ZoomLevel.SUMMARY -> HtmlCanvasSummary(params)
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> HtmlCanvasInteractive(params)
    }
}

/** 缩略图：HTML 图标（Spec A.5） */
@Composable
private fun HtmlCanvasThumbnail(params: WidgetRenderParams) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.Html,
            contentDescription = "HTML 画布",
            modifier = Modifier.size(24.dp),
            tint = Color(0xFF666666)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = params.title.ifEmpty { "HTML" },
            fontSize = 10.sp,
            color = Color(0xFF999999),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 摘要：HTML 标题或前 50 字符（Spec A.5） */
@Composable
private fun HtmlCanvasSummary(params: WidgetRenderParams) {
    val html = (params.state["html"] as? String) ?: ""
    val title = remember(html) { extractHtmlTitle(html) }
    val summary = title.ifEmpty {
        if (html.isNotEmpty()) html.take(50) else "等待内容..."
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = params.title.ifEmpty { "HTML 画布" },
            fontSize = 12.sp,
            color = Color(0xFF333333),
            maxLines = 1
        )
        Text(
            text = summary,
            fontSize = 10.sp,
            color = Color(0xFF666666),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 交互/完整：完整 WebView 渲染 HTML（Spec A.5，修复黑屏问题） */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun HtmlCanvasInteractive(params: WidgetRenderParams) {
    val html = (params.state["html"] as? String) ?: ""
    val tag = "HtmlCanvasWidget"

    if (html.isEmpty()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "等待内容...",
                fontSize = 12.sp,
                color = Color(0xFF999999)
            )
        }
        return
    }

    Log.d(tag, "render: id=${params.widgetId} len=${html.length} preview=${html.take(50)}")

    // 跟踪上次加载到 WebView 的 HTML，避免重复加载
    var lastLoadedHtml by remember { mutableStateOf<String?>(null) }

    // 智能包裹：检测 AI 生成的 HTML 是否是完整文档（含 <!DOCTYPE> 或 <html>）
    // 如果是完整文档，直接加载并在 </body> 前注入 canvas 修复脚本，避免嵌套 HTML 导致 CSS 层叠异常；
    // 如果是片段，用完整 HTML 文档包裹（保留 viewport meta + CSS 重置）。
    val isFullDocument = html.trimStart().startsWith("<!DOCTYPE", ignoreCase = true) ||
        html.trimStart().startsWith("<html", ignoreCase = true)

    val canvasFixScript = """
<script>
(function() {
    function fixCanvasSize() {
        var canvases = document.querySelectorAll('canvas');
        canvases.forEach(function(c) {
            var rect = c.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                c.width = Math.round(rect.width);
                c.height = Math.round(rect.height);
            }
        });
        window.dispatchEvent(new Event('resize'));
    }
    if (document.readyState === 'complete') {
        setTimeout(fixCanvasSize, 50);
    } else {
        window.addEventListener('load', function() { setTimeout(fixCanvasSize, 50); });
    }
})();
</script>
    """.trimIndent()

    val finalHtml = if (isFullDocument) {
        html.replace("</body>", canvasFixScript + "</body>", ignoreCase = true)
    } else {
        """
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;box-sizing:border-box;}*{box-sizing:border-box;}</style>
        </head>
        <body>${html}${canvasFixScript}</body>
        </html>
        """.trimIndent()
    }

    // 修复黑屏：
    // 1. setBackgroundColor(WHITE) —— WebView 默认背景在硬件加速层中可能显示为黑色，
    //    设置白色背景确保内容区域可见
    // 2. WebChromeClient（带 JS console 日志）—— 部分 JS 和渲染特性需要它，并捕获 JS 输出便于调试
    // 3. LOAD_NO_CACHE —— 避免加载到旧缓存内容
    AndroidView(
        factory = { ctx ->
            Log.d(tag, "factory: create WebView, html len=${html.length} isFullDoc=$isFullDocument")
            WebView(ctx).apply {
                layoutParams = android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(android.graphics.Color.WHITE)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                webViewClient = WebViewClient()
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                        consoleMessage?.let {
                            Log.d(tag, "JS: ${it.message()} (${it.sourceId()}:${it.lineNumber()})")
                        }
                        return true
                    }
                }
                loadDataWithBaseURL("about:blank", finalHtml, "text/html", "UTF-8", null)
            }.also { lastLoadedHtml = html }
        },
        update = { webView ->
            if (html != lastLoadedHtml) {
                Log.d(tag, "update: html changed, reload. len=${html.length} isFullDoc=$isFullDocument")
                webView.loadDataWithBaseURL("about:blank", finalHtml, "text/html", "UTF-8", null)
                lastLoadedHtml = html
            }
        },
        onRelease = { webView ->
            webView.destroy()
        },
        modifier = Modifier.fillMaxSize()
    )
}

/**
 * 从 HTML 提取 <title> 标签内容（用于摘要显示）。
 * 用正则匹配，避免引入 Jsoup 等额外依赖。
 */
private fun extractHtmlTitle(html: String): String {
    if (html.isBlank()) return ""
    val regex = Regex("<title[^>]*>([^<]*)</title>", RegexOption.IGNORE_CASE)
    return regex.find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
}
