package com.livingdashboard.script

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JsPromptResult
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.livingdashboard.ai.ActiveWebViewHolder
import com.livingdashboard.ai.KvStorage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * GM_* API 桥接（Spec 2.3 节，onJsPrompt 协议）。
 *
 * JS 侧通过 `prompt('__GM_CALL__|' + JSON.stringify({api, args, cbId}))` 调用，
 * Kotlin 侧 [handlePrompt] 拦截 `__GM_CALL__|` 前缀，分发到对应 API。
 *
 * - 同步 API（GM_addStyle/GM_setValue/GM_getValue/GM_setClipboard/GM_xhrAbort）在
 *   onJsPrompt 内直接 confirm 结果
 * - 异步 API（GM_xmlhttpRequest/GM_notification）立即 confirm 返回 cbId，
 *   Kotlin 异步处理后用 `webView.evaluateJavascript("__gmCbSuccess(...)")` 回调
 *
 * v3 修复落地：
 * - F2：7 个 API 分支（含 GM_xhrAbort）+ cancelXhr + pendingXhrs
 * - F3：GM_addStyle 只 confirm("{}")，不调 evaluateJavascript
 * - B2：GM_getValue 读 args["default"] 字段
 * - M5：展开 4 个同步 API 实现
 * - M7：handlePrompt try-catch + 参数 schema 校验
 * - L3：jsonString 用 Json.encodeToString(String.serializer(), s)
 * - S6：POST_NOTIFICATIONS 权限检查 + Toast 兜底
 * - S7：init 块创建 NotificationChannel
 * - N1：删除 GM_notification onclick 死代码（通过 cbId 路由）
 */
@Singleton
class GmApiBridge @Inject constructor(
    private val kvStorage: KvStorage,
    private val okHttpClient: OkHttpClient,
    @ApplicationContext private val context: Context,
    private val coroutineScope: CoroutineScope,
    private val webviewHolder: ActiveWebViewHolder,
) {
    // v3 修复 S7：NotificationChannel（API 26+ 必需，minSdk=26 保证此分支必走）
    private val channelId = "gm_notification"
    private val notifMgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "GM Notification",
                NotificationManager.IMPORTANCE_DEFAULT,
            )
            notifMgr.createNotificationChannel(channel)
        }
    }

    // v3 修复 F2：跟踪进行中的 XHR 请求，用于 abort
    private val pendingXhrs = ConcurrentHashMap<String, Call>()

    /**
     * 独立的 XHR 客户端（M4 修复 P2：30s callTimeout）。
     *
     * - 复用 [okHttpClient] 的连接池 / 拦截器（newBuilder() 共享底层资源）
     * - 仅覆盖 callTimeout 为 30s，避免 XHR 请求永久挂起
     *   （共享的 okHttpClient readTimeout=0 用于 SSE 流，不适用于 GM_xhr）
     * - 用 callTimeout（整个 call 超时）而非 readTimeout，更可靠地覆盖连接 + 读取全流程
     */
    private val xhrClient: OkHttpClient = okHttpClient.newBuilder()
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    /** v3 修复 L3：JSON 字符串字面量编码（用于 evaluateJavascript 参数） */
    private fun jsonString(s: String): String = Json.encodeToString(String.serializer(), s)

    /**
     * onJsPrompt 入口：解析 message，分发到对应 API。
     *
     * v3 修复 M7：try-catch 包裹，解析失败或 schema 校验失败时 `result.cancel()` 返回 false。
     *
     * @return true 表示已处理（调用 JsPromptResult.confirm/cancel）；false 表示非 GM 调用，让默认 onJsPrompt 处理
     */
    fun handlePrompt(message: String, result: JsPromptResult): Boolean {
        if (!message.startsWith("__GM_CALL__|")) return false
        try {
            val json = message.removePrefix("__GM_CALL__|")
            val call = Json.decodeFromString(GmCall.serializer(), json)
            // v3 修复 M7：参数 schema 校验（api 必填 String 已由 @Serializable 保证；args 必填 JsonObject）
            if (call.api.isEmpty()) {
                result.cancel()
                return false
            }
            when (call.api) {
                // v3 修复 F3：GM_addStyle 只 confirm "{}"，不调 evaluateJavascript（JS 侧已注入 <style>）
                "GM_addStyle" -> {
                    result.confirm("{}")
                }
                "GM_setValue" -> {
                    val key = call.args["key"]?.jsonPrimitive?.contentOrNull ?: ""
                    val value = call.args["value"]?.jsonPrimitive?.contentOrNull ?: ""
                    // 同步写内存缓存（立即对后续 readSync 可见）+ 异步落盘
                    kvStorage.writeSync(key, value)
                    coroutineScope.launch(Dispatchers.IO) { kvStorage.write(key, value) }
                    result.confirm("{}")
                }
                // v3 修复 B2：args["default"] 链路完整（JS 侧已补发 default 字段）
                "GM_getValue" -> {
                    val key = call.args["key"]?.jsonPrimitive?.contentOrNull ?: ""
                    val defaultV = call.args["default"]?.jsonPrimitive?.contentOrNull
                    val v = kvStorage.readSync(key) ?: defaultV ?: ""
                    result.confirm("""{"value":"${v.replace("\\", "\\\\").replace("\"", "\\\"")}"}""")
                }
                "GM_setClipboard" -> {
                    val text = call.args["text"]?.jsonPrimitive?.contentOrNull ?: ""
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("gm", text))
                    result.confirm("{}")
                }
                "GM_notification" -> {
                    val cbId = call.cbId
                    coroutineScope.launch { handleNotification(cbId, call.args) }
                    result.confirm("""{"cbId":"${cbId ?: ""}"}""")
                }
                "GM_xmlhttpRequest" -> {
                    val cbId = call.cbId ?: run { result.confirm("{}"); return true }
                    coroutineScope.launch { handleXhr(cbId, call.args) }
                    result.confirm("""{"cbId":"$cbId"}""")
                }
                // v3 修复 F2：GM_xhrAbort 分支，避免 JsPromptResult 未 confirm 导致 WebView 挂起
                "GM_xhrAbort" -> {
                    val xhrId = call.args["id"]?.jsonPrimitive?.contentOrNull
                    if (xhrId != null) cancelXhr(xhrId)
                    result.confirm("{}")
                }
                else -> {
                    // 未知 API 兜底（防止恶意 JS 探测分支；confirm 空 JSON 不挂起 WebView）
                    result.confirm("{}")
                }
            }
            return true
        } catch (e: Exception) {
            // v3 修复 M7：JSON 解析失败/字段缺失 → cancel + 返回 false（让默认 prompt 处理）
            result.cancel()
            return false
        }
    }

    /**
     * GM_xmlhttpRequest 异步处理（Spec 2.3.3 + 2.3.4）。
     *
     * 安全约束：
     * - 仅 http/https scheme（拦截 file/content/ftp）
     * - 响应体 ≤ 1MB
     * - 无 CORS 限制（GM_xhr 核心价值）
     */
    private suspend fun handleXhr(cbId: String, details: JsonObject) {
        val url = details["url"]?.jsonPrimitive?.contentOrNull ?: return
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            callbackError(cbId, "only http/https allowed")
            return
        }
        try {
            val request = buildXhrRequest(details)
            // M4 修复 P2：用独立的 xhrClient（30s callTimeout），避免 XHR 永久挂起
            val call = xhrClient.newCall(request)
            // v3 修复 F2：将 Call 注册到 pendingXhrs，供 GM_xhrAbort 取消
            pendingXhrs[cbId] = call
            call.execute().use { resp ->
                val text = resp.body?.string()?.take(1_000_000) ?: ""  // ≤1MB
                val payload = buildJsonObject {
                    put("status", resp.code)
                    put("responseText", text)
                    put("finalUrl", resp.request.url.toString())
                }
                callbackSuccess(cbId, payload)
            }
        } catch (e: Exception) {
            callbackError(cbId, e.message ?: "xhr failed")
        } finally {
            pendingXhrs.remove(cbId)
        }
    }

    /**
     * 构建 OkHttp Request（Spec 2.3.3）。
     * 支持 url/method/headers/data 字段，默认 GET。
     */
    private fun buildXhrRequest(details: JsonObject): Request {
        val url = details["url"]?.jsonPrimitive?.contentOrNull ?: ""
        val method = details["method"]?.jsonPrimitive?.contentOrNull?.uppercase() ?: "GET"
        val builder = Request.Builder().url(url)
        details["headers"]?.let { headersEl ->
            (headersEl as? JsonObject)?.forEach { (k, v) ->
                builder.header(k, v.jsonPrimitive.content)
            }
        }
        val data = details["data"]?.jsonPrimitive?.contentOrNull
        if (method != "GET" && method != "HEAD" && data != null) {
            builder.method(method, data.toRequestBody(null))
        } else {
            builder.method(method, null)
        }
        return builder.build()
    }

    /** v3 修复 F2：取消进行中的 XHR（从 pendingXhrs 移除并 call.cancel()） */
    private fun cancelXhr(xhrId: String) {
        pendingXhrs.remove(xhrId)?.cancel()
    }

    private fun callbackSuccess(cbId: String, payload: JsonObject) {
        webviewHolder.value.value?.evaluateJavascript(
            "window.__gmCbSuccess && __gmCbSuccess('$cbId', ${Json.encodeToString(JsonObject.serializer(), payload)})",
            null,
        )
    }

    private fun callbackError(cbId: String, msg: String) {
        webviewHolder.value.value?.evaluateJavascript(
            "window.__gmCbError && __gmCbError('$cbId', ${jsonString(msg)})",
            null,
        )
    }

    /**
     * GM_notification 详细实现（Spec 2.3.6 v3 修复 S6 + S7 + N1）。
     *
     * v3 修复 N1：删除 onclick 字段读取（JSON.stringify 静默丢弃函数属性，永远为 null，死代码）。
     *   onclick 通过 cbId 路由：JS 侧 callbacks[cbId].onclick 已在 gmCall 异步分支注册，
     *   Kotlin 侧通过 PendingIntent → GmNotificationReceiver →
     *   evaluateJavascript("__gmNotificationOnClick('$cbId')") 触发。
     *
     * v3 修复 S6：Android 13+ 需要 POST_NOTIFICATIONS 运行时权限，权限拒绝时降级为 Toast 兜底。
     * v3 修复 S7：使用 init 块创建的 channelId。
     */
    private suspend fun handleNotification(cbId: String?, details: JsonObject) {
        val title = details["title"]?.jsonPrimitive?.contentOrNull ?: ""
        val text = details["text"]?.jsonPrimitive?.contentOrNull ?: ""

        // v3 修复 S6：检查 POST_NOTIFICATIONS 权限（API 33+）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                // v3 修复 S6：降级为 Toast 兜底（不崩溃，用户可见）
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(context, "$title: $text", Toast.LENGTH_LONG).show()
                }
                return
            }
        }

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)

        // 点击事件：通过 PendingIntent 路由回 GmNotificationReceiver → __gmNotificationOnClick
        if (cbId != null) {
            val intent = Intent("com.livingdashboard.GM_NOTIF_CLICK").putExtra("cbId", cbId)
            val pi = PendingIntent.getBroadcast(
                context, cbId.hashCode(), intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            builder.setContentIntent(pi)
        }

        notifMgr.notify(System.currentTimeMillis().toInt(), builder.build())
    }
}
