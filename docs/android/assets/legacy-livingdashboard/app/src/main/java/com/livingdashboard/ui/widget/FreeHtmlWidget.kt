package com.livingdashboard.ui.widget

import android.annotation.SuppressLint
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
 * FreeHtmlWidget —— 自由 HTML 组件（与 Web 端 freeHtml 对齐）。
 *
 * 与 HtmlCanvasWidget 的区别：
 * - 不需要固定矩形边界，可覆盖更大区域
 * - 支持透明背景（WebView 背景透明，底层画布可见）
 * - 支持全局覆盖模式（isGlobal=true 时覆盖整个屏幕）
 * - 默认 pointer-events 穿透（通过 WebView 的 isClickable=false 实现）
 * - interactive 属性控制是否可交互
 *
 * state 字段：
 * - html: String —— 要渲染的 HTML 内容
 * - isGlobal: Boolean —— 是否全局覆盖（默认 false）
 * - interactive: Boolean —— 是否可交互（默认 true）
 *
 * 分层渲染（D9）：
 * - THUMBNAIL：HTML 图标
 * - SUMMARY：HTML 标题或前 50 字符
 * - INTERACTIVE/FULL：完整 WebView 渲染 HTML
 *
 * @param params 渲染参数，state["html"] 为 HTML 内容
 */
@Composable
fun FreeHtmlWidget(params: WidgetRenderParams) {
    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> FreeHtmlThumbnail(params)
        ZoomLevel.SUMMARY -> FreeHtmlSummary(params)
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> FreeHtmlInteractive(params)
    }
}

/** 缩略图：自由 HTML 图标 */
@Composable
private fun FreeHtmlThumbnail(params: WidgetRenderParams) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.Html,
            contentDescription = "自由 HTML",
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

/** 摘要：HTML 标题或前 50 字符 */
@Composable
private fun FreeHtmlSummary(params: WidgetRenderParams) {
    val html = (params.state["html"] as? String) ?: ""
    val title = remember(html) { extractFreeHtmlTitle(html) }
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
            text = params.title.ifEmpty { "自由 HTML" },
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

/** 交互/完整：WebView 渲染自由 HTML（透明背景 + pointer-events 穿透，修复白屏） */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun FreeHtmlInteractive(params: WidgetRenderParams) {
    val html = (params.state["html"] as? String) ?: ""
    val isGlobal = params.state["isGlobal"] as? Boolean ?: false
    val interactive = params.state["interactive"] as? Boolean ?: true

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

    // 跟踪上次加载到 WebView 的 HTML，避免重复加载
    var lastLoadedHtml by remember { mutableStateOf<String?>(null) }

    // 修复白屏：用 AndroidView factory 创建 WebView（不用 applicationContext）
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.loadWithOverviewMode = false
                settings.useWideViewPort = false
                // 透明背景，让底层画布可见
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                // pointer-events 穿透：默认不可点击，interactive=true 时可点击
                isClickable = interactive
                webViewClient = WebViewClient()
                loadDataWithBaseURL("about:blank", html, "text/html", "UTF-8", null)
            }.also { lastLoadedHtml = html }
        },
        update = { webView ->
            // html 变化时重新加载（与 lastLoadedHtml 比较，避免恒相等的死代码）
            if (html != lastLoadedHtml) {
                webView.loadDataWithBaseURL("about:blank", html, "text/html", "UTF-8", null)
                lastLoadedHtml = html
            }
            // 更新可交互状态
            webView.isClickable = interactive
        },
        onRelease = { webView ->
            webView.destroy()
        },
        modifier = Modifier.fillMaxSize()
    )
}

/**
 * 从 HTML 提取 <title> 标签内容（用于摘要显示）。
 */
private fun extractFreeHtmlTitle(html: String): String {
    if (html.isBlank()) return ""
    val regex = Regex("<title[^>]*>([^<]*)</title>", RegexOption.IGNORE_CASE)
    return regex.find(html)?.groupValues?.getOrNull(1)?.trim().orEmpty()
}
