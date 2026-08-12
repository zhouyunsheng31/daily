package com.livingdashboard.ai.tools

import android.webkit.ValueCallback
import android.webkit.WebView
import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.KvStorage
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.entity.WidgetType
import com.livingdashboard.data.repository.CanvasRepository
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * M8 Spec 8.1 行 1719：10 工具 × 3 用例（正常/参数错/边界）= 30 用例。
 *
 * 用 MockK mock [CanvasRepository]/[KvStorage]/[WebView]。
 * [AskUserDialogState] 是真实实例（无依赖，可直接 new）。
 *
 * 注意：MockK 依赖由后续 sub-agent 在 build.gradle.kts 统一加（testImplementation "io.mockk:mockk:1.13.x"）。
 * Tool/ToolResult/ToolDefinition/toolObjectSchema 由其他 sub-agent 写在 ai/Tool.kt，本测试 import 即可。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ToolsTest {

    // ===== ListWidgetsTool =====

    @Test
    fun list_widgets_normal_returns_widgets_list() = runTest {
        val repo = mockk<CanvasRepository>()
        val widget1 = WidgetEntity(
            id = "w1", panelId = "p1", type = WidgetType.HTML_CANVAS,
            title = "Widget 1", stateJson = "{}", width = 400f, height = 300f,
        )
        val widget2 = WidgetEntity(
            id = "w2", panelId = "p1", type = WidgetType.WEBVIEW,
            title = "Widget 2", stateJson = "{}", width = 300f, height = 200f,
        )
        every { repo.observeWidgets("p1") } returns flowOf(listOf(widget1, widget2))
        val tool = ListWidgetsTool(repo) { "p1" }

        val result = tool.execute(buildJsonObject {})

        assertTrue(result.success)
        val widgets = result.data!!["widgets"]!!.jsonArray
        assertEquals(2, widgets.size)
        assertEquals("w1", widgets[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("HTML_CANVAS", widgets[0].jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals("Widget 1", widgets[0].jsonObject["title"]!!.jsonPrimitive.content)
        assertEquals("w2", widgets[1].jsonObject["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun list_widgets_no_active_panel_returns_error() = runTest {
        val repo = mockk<CanvasRepository>()
        val tool = ListWidgetsTool(repo) { null }

        val result = tool.execute(buildJsonObject {})

        assertFalse(result.success)
        assertEquals("no active panel", result.error)
    }

    @Test
    fun list_widgets_empty_list_returns_empty_widgets() = runTest {
        val repo = mockk<CanvasRepository>()
        every { repo.observeWidgets("p1") } returns flowOf(emptyList())
        val tool = ListWidgetsTool(repo) { "p1" }

        val result = tool.execute(buildJsonObject {})

        assertTrue(result.success)
        val widgets = result.data!!["widgets"]!!.jsonArray
        assertEquals(0, widgets.size)
    }

    // ===== StorageReadTool =====

    @Test
    fun storage_read_normal_returns_value() = runTest {
        val kv = mockk<KvStorage>()
        coEvery { kv.read("foo") } returns "bar"
        val tool = StorageReadTool(kv)

        val result = tool.execute(buildJsonObject { put("key", "foo") })

        assertTrue(result.success)
        assertEquals("foo", result.data!!["key"]!!.jsonPrimitive.content)
        assertEquals("bar", result.data!!["value"]!!.jsonPrimitive.content)
    }

    @Test
    fun storage_read_missing_key_returns_error() = runTest {
        val kv = mockk<KvStorage>()
        val tool = StorageReadTool(kv)

        val result = tool.execute(buildJsonObject {})

        assertFalse(result.success)
        assertEquals("missing key", result.error)
    }

    @Test
    fun storage_read_nonexistent_key_returns_empty_value() = runTest {
        val kv = mockk<KvStorage>()
        coEvery { kv.read("nope") } returns null
        val tool = StorageReadTool(kv)

        val result = tool.execute(buildJsonObject { put("key", "nope") })

        assertTrue(result.success)
        assertEquals("", result.data!!["value"]!!.jsonPrimitive.content)
    }

    // ===== StorageWriteTool =====

    @Test
    fun storage_write_normal_writes_and_returns_success() = runTest {
        val kv = mockk<KvStorage>()
        coEvery { kv.write("foo", "bar") } just Runs
        val tool = StorageWriteTool(kv)

        val result = tool.execute(buildJsonObject {
            put("key", "foo")
            put("value", "bar")
        })

        assertTrue(result.success)
        assertEquals(true, result.data!!["success"]!!.jsonPrimitive.boolean)
        coVerify { kv.write("foo", "bar") }
    }

    @Test
    fun storage_write_missing_key_returns_error() = runTest {
        val kv = mockk<KvStorage>()
        val tool = StorageWriteTool(kv)

        val result = tool.execute(buildJsonObject { put("value", "bar") })

        assertFalse(result.success)
        assertEquals("missing key", result.error)
    }

    @Test
    fun storage_write_long_string_succeeds() = runTest {
        val kv = mockk<KvStorage>()
        val longValue = "x".repeat(100_000)
        coEvery { kv.write("long", longValue) } just Runs
        val tool = StorageWriteTool(kv)

        val result = tool.execute(buildJsonObject {
            put("key", "long")
            put("value", longValue)
        })

        assertTrue(result.success)
        coVerify { kv.write("long", longValue) }
    }

    // ===== CreateHtmlWidgetTool =====

    @Test
    fun create_html_widget_normal_creates_widget() = runTest {
        val repo = mockk<CanvasRepository>()
        coEvery {
            repo.createHtmlWidget("p1", "<h1>hi</h1>", 50f, 60f, 200f, 100f, "T")
        } returns "w1"
        val tool = CreateHtmlWidgetTool(repo) { "p1" }

        val result = tool.execute(buildJsonObject {
            put("html", "<h1>hi</h1>")
            put("x", 50.0)
            put("y", 60.0)
            put("width", 200.0)
            put("height", 100.0)
            put("title", "T")
        })

        assertTrue(result.success)
        assertEquals("w1", result.data!!["id"]!!.jsonPrimitive.content)
        assertEquals(200.0, result.data!!["width"]!!.jsonPrimitive.double, 0.01)
        assertEquals(100.0, result.data!!["height"]!!.jsonPrimitive.double, 0.01)
        coVerify { repo.createHtmlWidget("p1", "<h1>hi</h1>", 50f, 60f, 200f, 100f, "T") }
    }

    @Test
    fun create_html_widget_missing_html_returns_error() = runTest {
        val repo = mockk<CanvasRepository>()
        val tool = CreateHtmlWidgetTool(repo) { "p1" }

        val result = tool.execute(buildJsonObject { put("title", "T") })

        assertFalse(result.success)
        assertEquals("missing html", result.error)
    }

    @Test
    fun create_html_widget_uses_defaults_when_optional_params_missing() = runTest {
        val repo = mockk<CanvasRepository>()
        coEvery {
            repo.createHtmlWidget(
                "p1", "<h1>default</h1>",
                100f, 100f, 400f, 300f, "HTML Widget",
            )
        } returns "w1"
        val tool = CreateHtmlWidgetTool(repo) { "p1" }

        val result = tool.execute(buildJsonObject {
            put("html", "<h1>default</h1>")
        })

        assertTrue(result.success)
        assertEquals("w1", result.data!!["id"]!!.jsonPrimitive.content)
        assertEquals(400.0, result.data!!["width"]!!.jsonPrimitive.double, 0.01)
        assertEquals(300.0, result.data!!["height"]!!.jsonPrimitive.double, 0.01)
        coVerify {
            repo.createHtmlWidget(
                "p1", "<h1>default</h1>",
                100f, 100f, 400f, 300f, "HTML Widget",
            )
        }
    }

    // ===== UpdateHtmlWidgetTool =====

    @Test
    fun update_html_widget_normal_updates() = runTest {
        val repo = mockk<CanvasRepository>()
        coEvery { repo.updateHtmlWidget("w1", "<p>new</p>", "New Title") } returns true
        val tool = UpdateHtmlWidgetTool(repo)

        val result = tool.execute(buildJsonObject {
            put("widget_id", "w1")
            put("html", "<p>new</p>")
            put("title", "New Title")
        })

        assertTrue(result.success)
        assertEquals(true, result.data!!["success"]!!.jsonPrimitive.boolean)
        coVerify { repo.updateHtmlWidget("w1", "<p>new</p>", "New Title") }
    }

    @Test
    fun update_html_widget_missing_widget_id_returns_error() = runTest {
        val repo = mockk<CanvasRepository>()
        val tool = UpdateHtmlWidgetTool(repo)

        val result = tool.execute(buildJsonObject { put("html", "<p>x</p>") })

        assertFalse(result.success)
        assertEquals("missing widget_id", result.error)
    }

    @Test
    fun update_html_widget_not_found_returns_error() = runTest {
        val repo = mockk<CanvasRepository>()
        coEvery { repo.updateHtmlWidget("nonexistent", any(), any()) } returns false
        val tool = UpdateHtmlWidgetTool(repo)

        val result = tool.execute(buildJsonObject {
            put("widget_id", "nonexistent")
            put("html", "<p>x</p>")
        })

        assertFalse(result.success)
        assertEquals("widget not found: nonexistent", result.error)
    }

    // ===== DeleteHtmlWidgetTool =====

    @Test
    fun delete_html_widget_normal_deletes() = runTest {
        val repo = mockk<CanvasRepository>()
        coEvery { repo.deleteWidget("w1") } just Runs
        val tool = DeleteHtmlWidgetTool(repo)

        val result = tool.execute(buildJsonObject { put("widget_id", "w1") })

        assertTrue(result.success)
        assertEquals(true, result.data!!["success"]!!.jsonPrimitive.boolean)
        coVerify { repo.deleteWidget("w1") }
    }

    @Test
    fun delete_html_widget_missing_widget_id_returns_error() = runTest {
        val repo = mockk<CanvasRepository>()
        val tool = DeleteHtmlWidgetTool(repo)

        val result = tool.execute(buildJsonObject {})

        assertFalse(result.success)
        assertEquals("missing widget_id", result.error)
    }

    @Test
    fun delete_html_widget_not_found_returns_success_idempotent() = runTest {
        // deleteWidget 内部 if null return，是 idempotent 操作；
        // Spec 6.9.4 不要求 widget 不存在时报错，故工具返回 success。
        val repo = mockk<CanvasRepository>()
        coEvery { repo.deleteWidget("nonexistent") } just Runs
        val tool = DeleteHtmlWidgetTool(repo)

        val result = tool.execute(buildJsonObject { put("widget_id", "nonexistent") })

        assertTrue(result.success)
        assertEquals(true, result.data!!["success"]!!.jsonPrimitive.boolean)
        coVerify { repo.deleteWidget("nonexistent") }
    }

    // ===== AskUserTool =====

    @Test
    fun ask_user_normal_returns_selected_values() = runTest {
        val dialogState = AskUserDialogState()
        val tool = AskUserTool(dialogState)
        val args = buildJsonObject {
            put("question", "选哪个颜色？")
            putJsonArray("options") {
                addJsonObject { put("label", "红"); put("value", "red") }
                addJsonObject { put("label", "蓝"); put("value", "blue") }
            }
        }

        // 在另一协程中模拟用户响应（test scheduler 单线程，tool.execute 挂起后此 launch 运行）
        launch {
            // state.value 在 showAndWait 内同步设置后才挂起，故此处一定能读到
            val req = dialogState.state.value
            requireNotNull(req) { "AskUserRequest should be set before tool.execute suspends" }
            dialogState.respond(req.requestId, listOf("red"))
        }

        val result = tool.execute(args)

        assertTrue(result.success)
        val selected = result.data!!["selectedValues"]!!.jsonArray
        assertEquals(1, selected.size)
        assertEquals("red", selected[0].jsonPrimitive.content)
    }

    @Test
    fun ask_user_user_responds_with_multiple_values() = runTest {
        val dialogState = AskUserDialogState()
        val tool = AskUserTool(dialogState)
        val args = buildJsonObject {
            put("question", "选多个？")
            put("allowMultiple", true)
        }

        launch {
            val req = dialogState.state.value
            requireNotNull(req)
            dialogState.respond(req.requestId, listOf("a", "b", "c"))
        }

        val result = tool.execute(args)

        assertTrue(result.success)
        val selected = result.data!!["selectedValues"]!!.jsonArray
        assertEquals(3, selected.size)
        assertEquals("a", selected[0].jsonPrimitive.content)
        assertEquals("b", selected[1].jsonPrimitive.content)
        assertEquals("c", selected[2].jsonPrimitive.content)
    }

    @Test
    fun ask_user_timeout_120s_returns_error() = runTest {
        val dialogState = AskUserDialogState()
        val tool = AskUserTool(dialogState)
        val args = buildJsonObject { put("question", "不会回答") }

        // 不响应，让 120s timeout 触发；runTest 会虚拟跳过时间
        val result = tool.execute(args)

        assertFalse(result.success)
        assertEquals("ask_user timeout (120s)", result.error)
    }

    // ===== BrowserEvalTool =====

    @Test
    fun browser_eval_normal_returns_result() = runTest {
        val webView = mockk<WebView>(relaxed = true)
        every { webView.post(any<Runnable>()) } answers {
            firstArg<Runnable>().run()
            true
        }
        every { webView.evaluateJavascript(any<String>(), any()) } answers {
            val cb = secondArg<ValueCallback<String?>>()
            cb.onReceiveValue("42")
        }
        val tool = BrowserEvalTool { webView }

        val result = tool.execute(buildJsonObject { put("script", "1+1") })

        assertTrue(result.success)
        assertEquals("42", result.data!!["result"]!!.jsonPrimitive.content)
        verify { webView.evaluateJavascript("1+1", any()) }
    }

    @Test
    fun browser_eval_missing_script_returns_error() = runTest {
        val webView = mockk<WebView>(relaxed = true)
        val tool = BrowserEvalTool { webView }

        val result = tool.execute(buildJsonObject {})

        assertFalse(result.success)
        assertEquals("missing script", result.error)
    }

    @Test
    fun browser_eval_no_active_webview_returns_error() = runTest {
        val tool = BrowserEvalTool { null }

        val result = tool.execute(buildJsonObject { put("script", "1+1") })

        assertFalse(result.success)
        assertEquals("no active webview", result.error)
    }

    // ===== BrowserNavigateTool =====

    @Test
    fun browser_navigate_normal_loads_url() = runTest {
        val webView = mockk<WebView>(relaxed = true)
        every { webView.post(any<Runnable>()) } answers {
            firstArg<Runnable>().run()
            true
        }
        every { webView.loadUrl(any<String>()) } just Runs
        val tool = BrowserNavigateTool { webView }

        val result = tool.execute(buildJsonObject { put("url", "https://example.com") })

        assertTrue(result.success)
        assertEquals("https://example.com", result.data!!["url"]!!.jsonPrimitive.content)
        assertEquals(true, result.data!!["success"]!!.jsonPrimitive.boolean)
        verify { webView.loadUrl("https://example.com") }
    }

    @Test
    fun browser_navigate_missing_url_returns_error() = runTest {
        val webView = mockk<WebView>(relaxed = true)
        val tool = BrowserNavigateTool { webView }

        val result = tool.execute(buildJsonObject {})

        assertFalse(result.success)
        assertEquals("missing url", result.error)
    }

    @Test
    fun browser_navigate_no_active_webview_returns_error() = runTest {
        val tool = BrowserNavigateTool { null }

        val result = tool.execute(buildJsonObject { put("url", "https://x") })

        assertFalse(result.success)
        assertEquals("no active webview", result.error)
    }

    // ===== BrowserGetUrlTool =====

    @Test
    fun browser_get_url_normal_returns_url() = runTest {
        val webView = mockk<WebView>(relaxed = true)
        every { webView.url } returns "https://example.com/page"
        val tool = BrowserGetUrlTool { webView }

        val result = tool.execute(buildJsonObject {})

        assertTrue(result.success)
        assertEquals("https://example.com/page", result.data!!["url"]!!.jsonPrimitive.content)
    }

    @Test
    fun browser_get_url_no_active_webview_returns_error() = runTest {
        val tool = BrowserGetUrlTool { null }

        val result = tool.execute(buildJsonObject {})

        assertFalse(result.success)
        assertEquals("no active webview", result.error)
    }

    @Test
    fun browser_get_url_null_returns_empty_string() = runTest {
        val webView = mockk<WebView>(relaxed = true)
        every { webView.url } returns null
        val tool = BrowserGetUrlTool { webView }

        val result = tool.execute(buildJsonObject {})

        assertTrue(result.success)
        assertEquals("", result.data!!["url"]!!.jsonPrimitive.content)
    }
}
