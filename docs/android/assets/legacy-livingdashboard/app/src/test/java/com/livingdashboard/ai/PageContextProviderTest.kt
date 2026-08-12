package com.livingdashboard.ai

import android.webkit.WebView
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * PageContextProvider 单元测试（Spec 8.1 节，5 用例）。
 *
 * 用真实 [ActiveWebViewHolder] + mockk mock [WebView]（参考 LocalAgentServiceTest 第 6 个用例的成熟模式）。
 * 用 [Dispatchers.setMain] 把 Main 切换到 [UnconfinedTestDispatcher]，让 withContext(Dispatchers.Main) 在测试中可执行。
 *
 * 关键设计：
 * - holder.value.value == null 时（无活跃 WebView）返回 null
 * - WebView.url == "" 或 null 时返回 null（url 空白视为无页面）
 * - WebView.url 非空时返回 PageContext(url, title)
 * - 在非 Main 线程调用也能正确切到 Main 读取
 *
 * 用例：
 * 1. WebView 为 null → getCurrentContext() 返回 null
 * 2. WebView.url 非空 + title 非空 → 返回 PageContext(url, title)
 * 3. WebView.url 为空字符串 → 返回 null
 * 4. WebView.url 为 null → 返回 null
 * 5. 非 Main 线程调用 → withContext(Main) 切换后仍能正确读取
 */
class PageContextProviderTest {

    // =========================================================================
    // 1. WebView 为 null → 返回 null
    // =========================================================================

    @Test
    fun `getCurrentContext returns null when WebView is null`() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            val holder = ActiveWebViewHolder()
            val provider = PageContextProvider(holder)

            val ctx = provider.getCurrentContext()

            assertNull(ctx)
        } finally {
            Dispatchers.resetMain()
        }
    }

    // =========================================================================
    // 2. WebView.url 非空 + title 非空 → 返回 PageContext(url, title)
    // =========================================================================

    @Test
    fun `getCurrentContext returns PageContext with url and title`() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            val holder = ActiveWebViewHolder()
            val mockWebView = mockk<WebView>(relaxed = true)
            every { mockWebView.url } returns "https://x.com"
            every { mockWebView.title } returns "X"
            holder.value.value = mockWebView

            val provider = PageContextProvider(holder)
            val ctx = provider.getCurrentContext()

            assertNotNull(ctx)
            assertEquals("https://x.com", ctx!!.url)
            assertEquals("X", ctx.title)
        } finally {
            Dispatchers.resetMain()
        }
    }

    // =========================================================================
    // 3. WebView.url 为空字符串 → 返回 null
    // =========================================================================

    @Test
    fun `getCurrentContext returns null when url is blank`() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            val holder = ActiveWebViewHolder()
            val mockWebView = mockk<WebView>(relaxed = true)
            every { mockWebView.url } returns ""
            every { mockWebView.title } returns "title"
            holder.value.value = mockWebView

            val provider = PageContextProvider(holder)
            val ctx = provider.getCurrentContext()

            assertNull(ctx)
        } finally {
            Dispatchers.resetMain()
        }
    }

    // =========================================================================
    // 4. WebView.url 为 null → 返回 null
    // =========================================================================

    @Test
    fun `getCurrentContext returns null when url is null`() = runTest {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            val holder = ActiveWebViewHolder()
            val mockWebView = mockk<WebView>(relaxed = true)
            every { mockWebView.url } returns null
            every { mockWebView.title } returns "title"
            holder.value.value = mockWebView

            val provider = PageContextProvider(holder)
            val ctx = provider.getCurrentContext()

            assertNull(ctx)
        } finally {
            Dispatchers.resetMain()
        }
    }

    // =========================================================================
    // 5. 非 Main 线程调用 → withContext(Main) 切换后仍能正确读取
    // =========================================================================

    @Test
    fun `getCurrentContext reads url and title on Main thread via withContext`() = runTest {
        // runTest 默认跑在 TestScope 的调度器上（非 Main）。
        // PageContextProvider.getCurrentContext 内部用 withContext(Dispatchers.Main) 切到 Main。
        // 用 UnconfinedTestDispatcher 作为 Main，验证切换后能正确读取。
        val testDispatcher = UnconfinedTestDispatcher()
        Dispatchers.setMain(testDispatcher)
        try {
            val holder = ActiveWebViewHolder()
            val mockWebView = mockk<WebView>(relaxed = true)
            every { mockWebView.url } returns "https://example.com/page"
            every { mockWebView.title } returns "Example Page"
            holder.value.value = mockWebView

            val provider = PageContextProvider(holder)
            val ctx = provider.getCurrentContext()

            assertNotNull(ctx)
            assertEquals("https://example.com/page", ctx!!.url)
            assertEquals("Example Page", ctx.title)
        } finally {
            Dispatchers.resetMain()
        }
    }
}
