package com.livingdashboard.browser

import android.graphics.Bitmap
import android.net.Uri
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import com.livingdashboard.script.GmApiBridge

/**
 * Living Dashboard WebChromeClient（Spec 3.2.3，含 C10 修复）。
 *
 * C10 修复：
 * - `onShowFileChooser`：返回 false（M1 不支持文件上传，让 WebView 默认行为）
 * - `onJsAlert`：用 Toast 显示 message 并调用 `result.confirm()`，返回 true
 * - `onJsConfirm`：类似处理，返回 true
 * - `onPermissionRequest`：`request.deny()`（M1 默认拒绝权限请求）
 *
 * @param onProgressChange 加载进度回调（0-100）
 * @param onTitleChange 页面标题变化回调
 * @param onFaviconChange 网站图标变化回调
 */
class LivingWebChromeClient(
    private val onProgressChange: (Int) -> Unit,
    private val onTitleChange: (String) -> Unit,
    private val onFaviconChange: (Bitmap?) -> Unit,
    private val gmApiBridge: GmApiBridge? = null,
) : WebChromeClient() {

    /** 加载进度变化 */
    override fun onProgressChanged(view: WebView, newProgress: Int) {
        onProgressChange(newProgress)
    }

    /** 页面标题变化 */
    override fun onReceivedTitle(view: WebView, title: String?) {
        title?.let { onTitleChange(it) }
    }

    /** 网站图标变化 */
    override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
        onFaviconChange(icon)
    }

    /**
     * C10 修复：文件选择（input type=file）回调。
     * M1 不支持文件上传，返回 false（让 WebView 默认行为）。
     */
    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?
    ): Boolean {
        return false
    }

    /**
     * C10 修复：JS alert 对话框。
     * M1 简化：用 Toast 显示 message 并自动 confirm，返回 true。
     * 注：WebView 用 applicationContext 创建，无法弹 AlertDialog（会 BadTokenException），
     * 故用 Toast 显示消息后自动确认。
     */
    override fun onJsAlert(
        view: WebView?, url: String?, message: String?, result: JsResult?
    ): Boolean {
        val ctx = view?.context
        if (ctx != null && message != null) {
            Toast.makeText(ctx, message, Toast.LENGTH_LONG).show()
        }
        result?.confirm()
        return true
    }

    /**
     * C10 修复：JS confirm 对话框。
     * M1 简化：用 Toast 显示 message 并自动 confirm，返回 true。
     */
    override fun onJsConfirm(
        view: WebView?, url: String?, message: String?, result: JsResult?
    ): Boolean {
        val ctx = view?.context
        if (ctx != null && message != null) {
            Toast.makeText(ctx, message, Toast.LENGTH_LONG).show()
        }
        result?.confirm()
        return true
    }

    /**
     * C10 修复：权限请求（地理位置、摄像头等）。
     * M1 默认拒绝所有 WebView 权限请求，避免权限滥用。
     */
    override fun onPermissionRequest(request: PermissionRequest?) {
        request?.deny()
    }

    /**
     * M4 新增（Spec 2.4.5 / 2.6.1）：拦截 GM_* API 调用（onJsPrompt 桥接）。
     *
     * - message 以 "__GM_CALL__|" 开头 → 分发到 [gmApiBridge.handlePrompt]，confirm 结果
     * - 其他 prompt → 走默认行为（返回 false）
     *
     * 同步 API（GM_addStyle/GM_setValue/GM_getValue/GM_setClipboard/GM_xhrAbort）在 confirm 中
     * 直接返回结果。异步 API（GM_xmlhttpRequest/GM_notification）confirm 立即返回 cbId，
     * 结果后续 evaluateJavascript 回调。
     *
     * v3 修复 M7：[GmApiBridge.handlePrompt] 内部 try-catch + 参数 schema 校验，
     * 解析失败/校验失败时 result.cancel() 返回 false（让默认 prompt 处理）。
     */
    override fun onJsPrompt(
        view: WebView?, url: String?, message: String?, defaultValue: String?,
        result: JsPromptResult?,
    ): Boolean {
        if (message != null && message.startsWith("__GM_CALL__|") && gmApiBridge != null && result != null) {
            return gmApiBridge.handlePrompt(message, result)
        }
        return false  // 走默认行为
    }
}
