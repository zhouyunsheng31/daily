package com.livingdashboard.ui.widget

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.ai.ActiveWebViewHolder
import com.livingdashboard.browser.LivingWebView
import com.livingdashboard.browser.rememberWebViewController
import com.livingdashboard.script.GmApiBridge
import com.livingdashboard.script.ScriptInjector
import com.livingdashboard.script.ScriptInjectorEntryPoint
import dagger.hilt.android.EntryPointAccessors
import java.net.URI

/**
 * WebviewWidget（Spec A.2，D11 前置依赖）。
 *
 * 复用 M1 的 [LivingWebView] Composable + [com.livingdashboard.browser.WebViewController] 模式。
 * LivingWebView 内部已用 DisposableEffect 监听生命周期，onDispose 调用 webView.destroy()
 * 释放资源（C5 + M27），本组件无需再手动 destroy。
 *
 * state 字段：
 * - url: String —— 当前加载的 URL
 *
 * 分层渲染（D9）：
 * - THUMBNAIL：域名 + 图标
 * - SUMMARY：标题 + URL
 * - INTERACTIVE/FULL：完整 WebView + 工具栏（后退/前进/刷新/地址栏）
 *
 * @param params 渲染参数，state["url"] 为初始 URL
 */
@Composable
fun WebviewWidget(params: WidgetRenderParams) {
    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> WebviewThumbnail(params)
        ZoomLevel.SUMMARY -> WebviewSummary(params)
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> WebviewInteractive(params)
    }
}

/** 缩略图：域名 + 图标（Spec A.2） */
@Composable
private fun WebviewThumbnail(params: WidgetRenderParams) {
    val url = (params.state["url"] as? String) ?: ""
    val host = remember(url) { extractHost(url) }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Language,
            contentDescription = "网页",
            modifier = Modifier.size(24.dp),
            tint = Color(0xFF666666)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = host.ifEmpty { params.title.ifEmpty { "网页" } },
            fontSize = 10.sp,
            color = Color(0xFF999999),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 摘要：标题 + URL（Spec A.2） */
@Composable
private fun WebviewSummary(params: WidgetRenderParams) {
    val url = (params.state["url"] as? String) ?: ""
    val title = params.title.ifEmpty { extractHost(url).ifEmpty { "网页" } }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = title,
            fontSize = 12.sp,
            color = Color(0xFF333333),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = url,
            fontSize = 10.sp,
            color = Color(0xFF999999),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 交互/完整：工具栏 + LivingWebView（Spec A.2） */
@Composable
private fun WebviewInteractive(params: WidgetRenderParams) {
    val initialUrl = (params.state["url"] as? String) ?: "https://www.baidu.com"
    // 输入框显示的 URL（用户编辑中）
    var inputUrl by remember { mutableStateOf(initialUrl) }
    // 实际提交加载的 URL（按回车或刷新按钮才更新）
    var submittedUrl by remember { mutableStateOf(initialUrl) }
    // 页面标题（SUMMARY 级别用，这里仅维护供未来扩展）
    var title by remember { mutableStateOf("") }
    var canGoBack by remember { mutableStateOf(false) }
    var canGoForward by remember { mutableStateOf(false) }
    val controller = rememberWebViewController()
    val keyboard = LocalSoftwareKeyboardController.current
    // M4（Spec 2.4.7 / v3 修复 M3 / v3 修复 S8）：通过 EntryPoint 获取脚本系统依赖
    // WebviewWidget 不在 Hilt ViewModel 体系内，需用 EntryPointAccessors.fromApplication
    // 获取 Singleton 作用域的 ScriptInjector / GmApiBridge / ActiveWebViewHolder
    val (scriptInjector, gmApiBridge, activeWebViewHolder) = rememberScriptDeps()

    Column(modifier = Modifier.fillMaxSize()) {
        // 工具栏
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = { controller.goBack() },
                modifier = Modifier.size(28.dp),
                enabled = canGoBack
            ) {
                Icon(
                    Icons.Default.ArrowBack,
                    contentDescription = "后退",
                    modifier = Modifier.size(14.dp),
                    tint = if (canGoBack) Color(0xFF333333) else Color(0xFFCCCCCC)
                )
            }
            IconButton(
                onClick = { controller.goForward() },
                modifier = Modifier.size(28.dp),
                enabled = canGoForward
            ) {
                Icon(
                    Icons.Default.ArrowForward,
                    contentDescription = "前进",
                    modifier = Modifier.size(14.dp),
                    tint = if (canGoForward) Color(0xFF333333) else Color(0xFFCCCCCC)
                )
            }
            IconButton(
                onClick = { controller.reload() },
                modifier = Modifier.size(28.dp)
            ) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = "刷新",
                    modifier = Modifier.size(14.dp),
                    tint = Color(0xFF333333)
                )
            }
            TextField(
                value = inputUrl,
                onValueChange = { inputUrl = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("URL", fontSize = 11.sp) },
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color(0x0D000000),
                    unfocusedContainerColor = Color(0x0D000000),
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                textStyle = LocalTextStyle.current.copy(fontSize = 11.sp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(
                    onGo = {
                        val normalized = normalizeUrl(inputUrl)
                        if (normalized.isNotEmpty()) {
                            submittedUrl = normalized
                            inputUrl = normalized
                            params.onStateChange(mapOf("url" to normalized))
                            keyboard?.hide()
                        }
                    }
                )
            )
        }

        // WebView（复用 M1 LivingWebView，内部已处理 destroy()）
        // submittedUrl 变化时，LivingWebView 的 update lambda 会调用 loadUrl
        LivingWebView(
            url = submittedUrl,
            onUrlChange = { newUrl ->
                inputUrl = newUrl
                submittedUrl = newUrl
                params.onStateChange(mapOf("url" to newUrl))
            },
            onTitleChange = { title = it },
            onProgressChange = { /* M2 不显示进度条 */ },
            onBackForwardStateChange = { back, forward ->
                canGoBack = back
                canGoForward = forward
            },
            modifier = Modifier.fillMaxSize(),
            controller = controller,
            // M4（Spec 2.4.7 / v3 修复 S8）：传 holder/注入器/桥接器
            activeWebViewHolder = activeWebViewHolder,
            scriptInjector = scriptInjector,
            gmApiBridge = gmApiBridge,
        )
    }
}

/**
 * 通过 Hilt EntryPoint 获取脚本系统依赖（Spec 2.4.7 / v3 修复 M3 / v3 修复 S8）。
 *
 * WebviewWidget 是画布 widget，不在 Hilt ViewModel 体系内（无法用 `@HiltViewModel` +
 * `hiltViewModel()` 获取依赖）。通过 [EntryPointAccessors.fromApplication] 从 Application
 * Context 直接获取 Singleton 作用域的实例。
 *
 * v3 修复 S8：必须传 [ActiveWebViewHolder]，否则 GM 异步回调（GM_xmlhttpRequest /
 * GM_notification）会路由到错误 WebView（BrowserViewModel 的 holder 而非 widget 自己
 * 创建的 WebView）。
 */
@Composable
private fun rememberScriptDeps(): Triple<ScriptInjector?, GmApiBridge?, ActiveWebViewHolder?> {
    val context = LocalContext.current
    val entryPoint = remember(context) {
        EntryPointAccessors.fromApplication(
            context.applicationContext,
            ScriptInjectorEntryPoint::class.java
        )
    }
    return Triple(entryPoint.scriptInjector(), entryPoint.gmApiBridge(), entryPoint.activeWebViewHolder())
}

/** 从 URL 提取域名（用于缩略图/摘要显示） */
private fun extractHost(url: String): String {
    if (url.isBlank()) return ""
    return try {
        val uri = URI(url)
        uri.host ?: url
    } catch (e: Exception) {
        url
    }
}

/** 规范化 URL：无 scheme 时补 https:// */
private fun normalizeUrl(input: String): String {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return ""
    return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        trimmed
    } else {
        "https://$trimmed"
    }
}
