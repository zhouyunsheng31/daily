package com.livingdashboard.script

import android.app.NotificationManager
import android.content.ClipboardManager
import android.content.Context
import android.webkit.JsPromptResult
import android.webkit.WebView
import com.google.common.truth.Truth.assertThat
import com.livingdashboard.ai.ActiveWebViewHolder
import com.livingdashboard.ai.KvStorage
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

/**
 * Phase M4 T7 单元测试：GmApiBridge（Spec 第四章验收标准）。
 *
 * 覆盖 spec 验收标准"GM_* API 正常 — GmApiBridgeTest"：
 * - v3 修复 F2：7 个 API handlePrompt 路径全覆盖（含 GM_xhrAbort）
 * - v3 修复 F3：GM_addStyle 不调 evaluateJavascript（只 confirm("{}")）
 * - v3 修复 B2：GM_getValue 读 args["default"] 字段
 * - v3 修复 M7：handlePrompt try-catch + 参数 schema 校验（JSON 解析失败 cancel）
 * - M4 修复 P2：xhrClient 30s callTimeout
 * - GM_xmlhttpRequest 用 MockWebServer 验证成功 / 500 / scheme 拦截 / abort
 * - GM_getValue 同步读内存缓存 + 特殊字符转义
 *
 * 技术栈：JUnit 4 + MockK 1.13.10 + Truth 1.1.5 + MockWebServer 4.12.0 +
 * kotlinx-coroutines-test 1.7.3（纯 JVM，不依赖 Robolectric）。
 *
 * Mock 策略：kvStorage/context/NotificationManager/ClipboardManager/WebView/
 * ActiveWebViewHolder 用 MockK；okHttpClient 用真实实例（GM_xhr 测试用 MockWebServer）；
 * coroutineScope 用真实 CoroutineScope(Dispatchers.IO + SupervisorJob + CoroutineExceptionHandler)
 * —— 异步 XHR 通知回调用 CompletableDeferred 等待 evaluateJavascript 被调用。
 */
@RunWith(JUnit4::class)
class GmApiBridgeTest {

    private lateinit var kvStorage: KvStorage
    private lateinit var okHttpClient: OkHttpClient
    private lateinit var context: Context
    private lateinit var notifMgr: NotificationManager
    private lateinit var clipboardManager: ClipboardManager
    private lateinit var webview: WebView
    private lateinit var webviewHolder: ActiveWebViewHolder
    private lateinit var holderFlow: MutableStateFlow<WebView?>
    private lateinit var exceptionHandler: CoroutineExceptionHandler
    private lateinit var scope: CoroutineScope
    private lateinit var result: JsPromptResult
    private lateinit var bridge: GmApiBridge

    @Before
    fun setup() {
        kvStorage = mockk(relaxed = true)
        okHttpClient = OkHttpClient.Builder().build()
        context = mockk()
        notifMgr = mockk(relaxed = true)
        clipboardManager = mockk(relaxed = true)

        // GmApiBridge init 块调 getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        every { context.getSystemService(Context.NOTIFICATION_SERVICE) } returns notifMgr
        // GM_setClipboard 调 getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        every { context.getSystemService(Context.CLIPBOARD_SERVICE) } returns clipboardManager

        webview = mockk(relaxed = true)
        webviewHolder = mockk()
        holderFlow = MutableStateFlow<WebView?>(webview)
        every { webviewHolder.value } returns holderFlow

        // 异步协程异常吞噬（GM_notification 在纯 JVM 中 NotificationCompat 可能 NPE，不影响同步断言）
        exceptionHandler = CoroutineExceptionHandler { _, _ -> }
        scope = CoroutineScope(Dispatchers.IO + SupervisorJob() + exceptionHandler)

        result = mockk(relaxed = true)

        bridge = GmApiBridge(
            kvStorage = kvStorage,
            okHttpClient = okHttpClient,
            context = context,
            coroutineScope = scope,
            webviewHolder = webviewHolder,
        )
    }

    @After
    fun tearDown() {
        scope.cancel()
    }

    /** 构造 __GM_CALL__| 前缀的 prompt 消息（用 kotlinx.serialization 编码避免手写 JSON 转义错误）。 */
    private fun gmMessage(api: String, args: JsonObject, cbId: String? = null): String {
        val call = GmCall(api = api, args = args, cbId = cbId)
        return "__GM_CALL__|" + Json.encodeToString(GmCall.serializer(), call)
    }

    // =========================================================================
    // 1. 非 GM 调用：message 不以 __GM_CALL__| 开头 → 返回 false（不调 confirm/cancel）
    // =========================================================================

    /** 1. 非 GM 调用 → 返回 false，不调 result.confirm/cancel。 */
    @Test
    fun handlePrompt_非GM调用_返回false不调result() {
        val ret = bridge.handlePrompt("hello world", result)
        assertThat(ret).isFalse()
        verify(exactly = 0) { result.confirm(any<String>()) }
        verify(exactly = 0) { result.cancel() }
    }

    // =========================================================================
    // 2. JSON 解析失败 → try-catch → result.cancel() → 返回 false（v3 修复 M7）
    // =========================================================================

    /** 2. JSON 解析失败 → cancel + 返回 false。 */
    @Test
    fun handlePrompt_json解析失败_cancel返回false() {
        val ret = bridge.handlePrompt("__GM_CALL__|invalid json", result)
        assertThat(ret).isFalse()
        verify { result.cancel() }
    }

    // =========================================================================
    // 3. api 为空字符串 → schema 校验失败 → cancel → false（v3 修复 M7）
    // =========================================================================

    /** 3. api 为空字符串 → cancel + 返回 false。 */
    @Test
    fun handlePrompt_api为空_cancel返回false() {
        val msg = gmMessage("", buildJsonObject {})
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isFalse()
        verify { result.cancel() }
    }

    // =========================================================================
    // 4. GM_addStyle → confirm("{}") + 返回 true；不调 evaluateJavascript（v3 修复 F3）
    // =========================================================================

    /** 4. GM_addStyle 只 confirm("{}")，不调 evaluateJavascript（<style> 注入由 JS 侧完成）。 */
    @Test
    fun handlePrompt_GM_addStyle_confirm空JSON不调evaluateJavascript() {
        val msg = gmMessage("GM_addStyle", buildJsonObject { put("css", ".ad{display:none}") })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("{}") }
        verify(exactly = 0) { webview.evaluateJavascript(any(), any()) }
    }

    // =========================================================================
    // 5. GM_setValue → writeSync 同步写 + write 异步落盘 + confirm("{}")
    // =========================================================================

    /** 5. GM_setValue 同步写内存缓存 + 异步落盘 + confirm("{}")。 */
    @Test
    fun handlePrompt_GM_setValue_写KV并confirm() {
        val msg = gmMessage("GM_setValue", buildJsonObject {
            put("key", "k1")
            put("value", "v1")
        })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        // 同步写内存缓存立即生效
        verify { kvStorage.writeSync("k1", "v1") }
        // 异步 write 在 scope.launch(Dispatchers.IO) 中执行，用 coVerify + timeout 等待
        coVerify(timeout = 2000L) { kvStorage.write("k1", "v1") }
        verify { result.confirm("{}") }
    }

    // =========================================================================
    // 6. GM_getValue key 存在 → readSync 返回 "v1" → confirm({"value":"v1"})
    // =========================================================================

    /** 6. GM_getValue key 存在 → 返回存储值。 */
    @Test
    fun handlePrompt_GM_getValue_key存在_返回存储值() {
        every { kvStorage.readSync("k1") } returns "v1"
        val msg = gmMessage("GM_getValue", buildJsonObject { put("key", "k1") })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("""{"value":"v1"}""") }
    }

    // =========================================================================
    // 7. GM_getValue key 不存在有 default（v3 修复 B2）→ 返回 default
    // =========================================================================

    /** 7. GM_getValue key 不存在有 default → 返回 default 值（B2 修复：args["default"] 字段链路）。 */
    @Test
    fun handlePrompt_GM_getValue_key不存在有default_返回default() {
        every { kvStorage.readSync("missing") } returns null
        val msg = gmMessage("GM_getValue", buildJsonObject {
            put("key", "missing")
            put("default", "defVal")
        })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("""{"value":"defVal"}""") }
    }

    // =========================================================================
    // 8. GM_getValue key 不存在无 default → 返回空字符串
    // =========================================================================

    /** 8. GM_getValue key 不存在无 default → 返回空字符串。 */
    @Test
    fun handlePrompt_GM_getValue_key不存在无default_返回空字符串() {
        every { kvStorage.readSync("missing") } returns null
        val msg = gmMessage("GM_getValue", buildJsonObject { put("key", "missing") })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("""{"value":""}""") }
    }

    // =========================================================================
    // 9. GM_getValue 值含特殊字符（反斜杠 + 双引号）→ confirm 中正确转义
    // =========================================================================

    /** 9. GM_getValue 值含特殊字符（a"b\c）→ confirm 中 \ → \\，" → \" 转义。 */
    @Test
    fun handlePrompt_GM_getValue_值含特殊字符_正确转义() {
        // 存储值：a"b\c（5 个字符：a, ", b, \, c）
        every { kvStorage.readSync("k") } returns "a\"b\\c"
        val msg = gmMessage("GM_getValue", buildJsonObject { put("key", "k") })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        // 源码转义：\ → \\，" → \"，结果为 a\"b\\c
        val confirmSlot = slot<String>()
        verify { result.confirm(capture(confirmSlot)) }
        assertThat(confirmSlot.captured).contains("a\\\"b\\\\c")
    }

    // =========================================================================
    // 10. GM_setClipboard → ClipboardManager.setPrimaryClip 被调用 + confirm("{}")
    // =========================================================================

    /** 10. GM_setClipboard 写入剪贴板 + confirm("{}")。 */
    @Test
    fun handlePrompt_GM_setClipboard_写入剪贴板() {
        val msg = gmMessage("GM_setClipboard", buildJsonObject { put("text", "hello") })
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { clipboardManager.setPrimaryClip(any()) }
        verify { result.confirm("{}") }
    }

    // =========================================================================
    // 11. GM_notification → 立即 confirm({"cbId":"cb1"}) + 返回 true（异步不阻塞）
    // =========================================================================

    /** 11. GM_notification 立即 confirm 返回 cbId，异步 handleNotification 不阻塞 onJsPrompt。 */
    @Test
    fun handlePrompt_GM_notification_confirm返回cbId() {
        val msg = gmMessage("GM_notification", buildJsonObject {
            put("title", "T")
            put("text", "X")
        }, cbId = "cb1")
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("""{"cbId":"cb1"}""") }
    }

    // =========================================================================
    // 12. GM_xmlhttpRequest cbId 为 null → confirm("{}") + 返回 true（不启动 XHR）
    // =========================================================================

    /** 12. GM_xmlhttpRequest cbId 为 null → confirm("{}") + 返回 true，不启动 XHR。 */
    @Test
    fun handlePrompt_GM_xmlhttpRequest_cbId为null_confirm空JSON() {
        val msg = gmMessage("GM_xmlhttpRequest", buildJsonObject { put("url", "http://x") }, cbId = null)
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("{}") }
        // cbId 为 null 不启动 XHR → 不调 evaluateJavascript
        verify(exactly = 0) { webview.evaluateJavascript(any(), any()) }
    }

    // =========================================================================
    // 13. GM_xmlhttpRequest 非 http/https → confirm({"cbId":"cb1"}) + 异步 callbackError
    // =========================================================================

    /** 13. GM_xmlhttpRequest 非 http/https scheme → 异步 callbackError("only http/https allowed")。 */
    @Test
    fun handlePrompt_GM_xmlhttpRequest_非httpScheme_回调error() = runBlocking {
        val msg = gmMessage(
            "GM_xmlhttpRequest",
            buildJsonObject { put("url", "file:///etc/passwd") },
            cbId = "cb1",
        )

        val evalDeferred = CompletableDeferred<String>()
        every { webview.evaluateJavascript(any(), any()) } answers {
            evalDeferred.complete(firstArg<String>())
            Unit
        }

        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("""{"cbId":"cb1"}""") }

        // 等待异步 callbackError 触发 evaluateJavascript
        val js = withTimeout(5000L) { evalDeferred.await() }
        assertThat(js).contains("__gmCbError")
        assertThat(js).contains("only http/https allowed")
    }

    // =========================================================================
    // 14. GM_xmlhttpRequest 成功（MockWebServer）→ 回调 __gmCbSuccess 含 status + responseText
    // =========================================================================

    /** 14. GM_xmlhttpRequest 成功 → 回调 __gmCbSuccess 含 status=200 + responseText。 */
    @Test
    fun handlePrompt_GM_xmlhttpRequest_成功_回调success() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("hello body"))
        server.start()
        try {
            val url = server.url("/api").toString()
            val msg = gmMessage("GM_xmlhttpRequest", buildJsonObject { put("url", url) }, cbId = "cb1")

            val evalDeferred = CompletableDeferred<String>()
            every { webview.evaluateJavascript(any(), any()) } answers {
                evalDeferred.complete(firstArg<String>())
                Unit
            }

            val ret = bridge.handlePrompt(msg, result)
            assertThat(ret).isTrue()
            verify { result.confirm("""{"cbId":"cb1"}""") }

            val js = withTimeout(5000L) { evalDeferred.await() }
            assertThat(js).contains("__gmCbSuccess")
            assertThat(js).contains("\"status\":200")
            assertThat(js).contains("hello body")
        } finally {
            server.shutdown()
        }
    }

    // =========================================================================
    // 15. GM_xmlhttpRequest 服务器错误（500）→ 回调含 status=500
    // =========================================================================

    /** 15. GM_xmlhttpRequest 服务器 500 → 回调 __gmCbSuccess 含 status=500。 */
    @Test
    fun handlePrompt_GM_xmlhttpRequest_服务器500_回调status500() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(500).setBody("err"))
        server.start()
        try {
            val url = server.url("/err").toString()
            val msg = gmMessage("GM_xmlhttpRequest", buildJsonObject { put("url", url) }, cbId = "cb1")

            val evalDeferred = CompletableDeferred<String>()
            every { webview.evaluateJavascript(any(), any()) } answers {
                evalDeferred.complete(firstArg<String>())
                Unit
            }

            bridge.handlePrompt(msg, result)
            verify { result.confirm("""{"cbId":"cb1"}""") }

            val js = withTimeout(5000L) { evalDeferred.await() }
            assertThat(js).contains("__gmCbSuccess")
            assertThat(js).contains("\"status\":500")
        } finally {
            server.shutdown()
        }
    }

    // =========================================================================
    // 16. GM_xhrAbort → 取消进行中的 XHR → call.cancel() → callbackError（v3 修复 F2）
    // =========================================================================

    /** 16. GM_xhrAbort 取消进行中的 XHR：先启动 XHR（挂起），再 abort → call.cancel → callbackError。 */
    @Test
    fun handlePrompt_GM_xhrAbort_取消进行中的XHR() = runBlocking {
        val server = MockWebServer()
        server.start()  // 不 enqueue 响应，请求挂起等待
        try {
            val url = server.url("/hang").toString()

            val evalDeferred = CompletableDeferred<String>()
            every { webview.evaluateJavascript(any(), any()) } answers {
                evalDeferred.complete(firstArg<String>())
                Unit
            }

            // 1. 启动 XHR（cbId=cb1，请求连接 MockWebServer 后阻塞等待响应）
            bridge.handlePrompt(
                gmMessage("GM_xmlhttpRequest", buildJsonObject { put("url", url) }, "cb1"),
                result,
            )
            verify { result.confirm("""{"cbId":"cb1"}""") }

            // 2. 等待 XHR 请求到达 MockWebServer（确保 pendingXhrs[cb1]=call 已注册，execute in-flight）
            withTimeout(5000L) {
                while (server.requestCount == 0) delay(50)
            }

            // 3. 中止 XHR
            val r2 = mockk<JsPromptResult>(relaxed = true)
            bridge.handlePrompt(
                gmMessage("GM_xhrAbort", buildJsonObject { put("id", "cb1") }),
                r2,
            )
            verify { r2.confirm("{}") }

            // 4. call.cancel() 触发 IOException("Canceled") → catch → callbackError
            val js = withTimeout(5000L) { evalDeferred.await() }
            assertThat(js).contains("__gmCbError")
        } finally {
            server.shutdown()
        }
    }

    // =========================================================================
    // 17. 未知 API 兜底 → confirm("{}") + 返回 true（不挂起 WebView）
    // =========================================================================

    /** 17. 未知 API 兜底 → confirm("{}") + 返回 true（防止恶意 JS 探测分支）。 */
    @Test
    fun handlePrompt_未知API_confirm空JSON() {
        val msg = gmMessage("GM_unknown", buildJsonObject {})
        val ret = bridge.handlePrompt(msg, result)
        assertThat(ret).isTrue()
        verify { result.confirm("{}") }
    }

    // =========================================================================
    // 18. xhrClient 30s callTimeout（M4 修复 P2）→ 反射验证内部 xhrClient 超时配置
    // =========================================================================

    /** 18. xhrClient callTimeout 为 30s（M4 修复 P2：避免 XHR 永久挂起）。 */
    @Test
    fun xhrClient_callTimeout为30秒_P2修复() {
        val field = GmApiBridge::class.java.getDeclaredField("xhrClient")
        field.isAccessible = true
        val xhrClient = field.get(bridge) as OkHttpClient
        assertThat(xhrClient.callTimeoutMillis).isEqualTo(30_000)
    }
}
