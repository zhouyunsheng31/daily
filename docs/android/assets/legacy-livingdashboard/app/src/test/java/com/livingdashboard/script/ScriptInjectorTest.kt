package com.livingdashboard.script

import android.content.Context
import android.content.res.AssetManager
import android.webkit.WebView
import com.google.common.truth.Truth.assertThat
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4
import java.io.ByteArrayInputStream
import java.util.concurrent.TimeUnit

/**
 * Phase M4 T4 单元测试：ScriptInjector（Spec 2.4 / 2.10 / 第四章验收标准）。
 *
 * 覆盖：
 * 1. document-start / document-end / document-idle 三档注入时机（Spec 2.4.1）
 * 2. runAt 过滤：只注入匹配 runAt 的脚本，不注入其他时机
 * 3. gm_api_init.js 优先注入（IIFE 包裹 `(function(){...})();`）
 * 4. 脚本正文 IIFE 包裹（`(function(){try{<code>}catch(e){...}})();`）
 * 5. URL 匹配过滤：matches / includes / excludes 规则；无 matches+includes 默认不注入
 * 6. lastInjectedUrl 去重（B1 修复：URL 未变化且非 document-start 跳过；document-start 重新注入）
 * 7. 空脚本列表不注入（evaluateJavascript 不被调用）
 * 8. .user.js URL 拦截（onUserScriptUrlDetected）：MockWebServer 模拟下载 → importEvents 发射 ImportResult
 * 9. enabled=false 脚本不注入（snapshot() 在 repository 层过滤）
 *
 * 技术栈：JUnit 4 + MockK 1.13.10 + Truth 1.1.5 + MockWebServer 4.12.0 +
 * kotlinx-coroutines-test 1.7.3（纯 JVM，不依赖 Robolectric）。
 *
 * Context.assets.open 用 MockK 模拟返回 gm_api_init.js 内容（避免 Robolectric 依赖）。
 * WebView / UserScriptRepository / GmApiBridge 用 MockK mock。
 *
 * 注意：onUserScriptUrlDetected 实际实现为下载 + 解析 + repository.insert + 发射 ImportResult，
 * importEvents 类型为 MutableSharedFlow<ImportResult>（按 Spec 2.10 / 实际代码为准）。
 */
@RunWith(JUnit4::class)
class ScriptInjectorTest {

    private lateinit var repository: UserScriptRepository
    private lateinit var context: Context
    private lateinit var okHttpClient: OkHttpClient
    private lateinit var gmApiBridge: GmApiBridge
    private lateinit var view: WebView

    /** Mock 的 gm_api_init.js 内容（用于验证注入参数）。 */
    private val gmApiInitJsContent = "// GM_API_INIT_JS_MOCK_CONTENT"

    @Before
    fun setup() {
        repository = mockk()
        context = mockk()
        okHttpClient = mockk()
        gmApiBridge = mockk(relaxed = true)
        view = mockk(relaxed = true)

        // mock Context.assets.open("scripts/gm_api_init.js")
        val assetManager = mockk<AssetManager>()
        every { context.assets } returns assetManager
        every { assetManager.open("scripts/gm_api_init.js") } returns
            ByteArrayInputStream(gmApiInitJsContent.toByteArray())
    }

    /** 创建 ScriptInjector 实例，可指定 scope 和 okHttpClient（onUserScriptUrlDetected 测试用真实 OkHttp）。 */
    private fun createInjector(
        scope: CoroutineScope,
        okHttpClient: OkHttpClient = this.okHttpClient,
    ): ScriptInjector = ScriptInjector(
        repository = repository,
        json = Json,
        okHttpClient = okHttpClient,
        coroutineScope = scope,
        gmApiBridge = gmApiBridge,
        context = context,
    )

    /** 测试用 UserScriptEntity 工厂。 */
    private fun scriptEntity(
        id: String = "script-1",
        name: String = "TestScript",
        runAt: String = "document-end",
        matches: List<String> = listOf("https://example.com/*"),
        includes: List<String> = emptyList(),
        excludes: List<String> = emptyList(),
        code: String = "console.log('hello');",
        enabled: Boolean = true,
    ): UserScriptEntity = UserScriptEntity(
        id = id,
        name = name,
        namespace = "test-ns",
        version = "1.0",
        description = "desc",
        author = "tester",
        matches = matches,
        includes = includes,
        excludes = excludes,
        grants = emptyList(),
        runAt = runAt,
        code = code,
        rawMetadata = "",
        enabled = enabled,
        source = "manual",
        createdAt = 1000L,
        updatedAt = 1000L,
        versionCode = 1,
    )

    // =========================================================================
    // 1. document-start 脚本在 onPageStarted 时被注入
    // =========================================================================

    @Test
    fun injectForUrl_document_start_脚本被注入() = runTest {
        val script = scriptEntity(runAt = "document-start", code = "console.log('start');")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_START)

        // gm_api_init.js + 脚本正文 = 2 次调用
        assertThat(slot).hasSize(2)
        assertThat(slot[0]).isEqualTo("(function(){${gmApiInitJsContent}})();")
        assertThat(slot[1]).contains("console.log('start');")
    }

    // =========================================================================
    // 2. document-end 脚本在 onPageFinished 时被注入
    // =========================================================================

    @Test
    fun injectForUrl_document_end_脚本被注入() = runTest {
        val script = scriptEntity(runAt = "document-end", code = "console.log('end');")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).hasSize(2)
        assertThat(slot[0]).isEqualTo("(function(){${gmApiInitJsContent}})();")
        assertThat(slot[1]).contains("console.log('end');")
    }

    // =========================================================================
    // 3. document-idle 脚本在 onPageFinished + postDelayed(100ms) 时被注入
    // =========================================================================

    @Test
    fun injectForUrl_document_idle_脚本被注入() = runTest {
        val script = scriptEntity(runAt = "document-idle", code = "console.log('idle');")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_IDLE)

        assertThat(slot).hasSize(2)
        assertThat(slot[0]).isEqualTo("(function(){${gmApiInitJsContent}})();")
        assertThat(slot[1]).contains("console.log('idle');")
    }

    // =========================================================================
    // 4. runAt 过滤：只注入匹配 runAt 的脚本，不注入其他时机
    // =========================================================================

    @Test
    fun injectForUrl_runAt过滤_只注入匹配runAt的脚本() = runTest {
        val startScript = scriptEntity(
            id = "s1", name = "StartScript",
            runAt = "document-start", code = "console.log('start');",
        )
        val endScript = scriptEntity(
            id = "s2", name = "EndScript",
            runAt = "document-end", code = "console.log('end');",
        )
        every { repository.snapshot() } returns listOf(startScript, endScript)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        // 注入 DOCUMENT_START，应只注入 startScript（endScript 不注入）
        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_START)

        // gm_api_init.js + startScript = 2 次（EndScript 被 runAt 过滤掉）
        assertThat(slot).hasSize(2)
        assertThat(slot[1]).contains("console.log('start');")
        assertThat(slot[1]).doesNotContain("console.log('end');")
    }

    // =========================================================================
    // 5. gm_api_init.js 优先注入（在任何脚本正文之前）
    // =========================================================================

    @Test
    fun injectForUrl_gm_api_init_js优先注入() = runTest {
        val script1 = scriptEntity(id = "s1", name = "First", code = "first();")
        val script2 = scriptEntity(id = "s2", name = "Second", code = "second();")
        every { repository.snapshot() } returns listOf(script1, script2)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        // 第一次必须是 gm_api_init.js（IIFE 包裹）
        assertThat(slot[0]).isEqualTo("(function(){${gmApiInitJsContent}})();")
        // 之后是脚本正文（按顺序）
        assertThat(slot[1]).contains("first();")
        assertThat(slot[2]).contains("second();")
        // 总共 3 次（gm_api_init + 2 个脚本）
        assertThat(slot).hasSize(3)
    }

    // =========================================================================
    // 6. 脚本正文 IIFE 包裹：(function(){try{<code>}catch(e){...}})();
    // =========================================================================

    @Test
    fun injectForUrl_脚本正文IIFE包裹() = runTest {
        val script = scriptEntity(name = "MyScript", code = "doSomething();")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        // 第二次调用是脚本正文
        val scriptWrap = slot[1]
        assertThat(scriptWrap).startsWith("(function(){try{")
        assertThat(scriptWrap).contains("doSomething();")
        assertThat(scriptWrap).contains("catch(e){console.error('[userscript MyScript]',e)}")
        assertThat(scriptWrap).endsWith("})();")
    }

    // =========================================================================
    // 7. URL 匹配过滤（Spec 2.4.2）
    // =========================================================================

    @Test
    fun injectForUrl_matches匹配_注入脚本() = runTest {
        val script = scriptEntity(matches = listOf("https://example.com/*"))
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).hasSize(2)  // gm_api_init + 脚本
    }

    @Test
    fun injectForUrl_matches不匹配_不注入() = runTest {
        val script = scriptEntity(matches = listOf("https://example.com/*"))
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://other.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).isEmpty()  // matches 不匹配，不注入
    }

    @Test
    fun injectForUrl_excludes匹配_不注入() = runTest {
        val script = scriptEntity(
            matches = listOf("https://example.com/*"),
            excludes = listOf("https://example.com/admin/*"),
        )
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/admin/page", RunAt.DOCUMENT_END)

        assertThat(slot).isEmpty()  // excludes 命中，不注入（excludes 优先级最高）
    }

    @Test
    fun injectForUrl_includes匹配_注入() = runTest {
        // matches 为空时，includes 兜底（正则匹配）
        val script = scriptEntity(
            matches = emptyList(),
            includes = listOf("https://.*\\.example\\.com/.*"),
        )
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://sub.example.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).hasSize(2)  // includes 正则匹配，注入
    }

    @Test
    fun injectForUrl_无matches和includes_默认不注入() = runTest {
        val script = scriptEntity(matches = emptyList(), includes = emptyList())
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).isEmpty()  // 无 matches/includes 默认不注入（避免误注入到所有页面）
    }

    // =========================================================================
    // 8. lastInjectedUrl 去重（B1 修复）
    // =========================================================================

    @Test
    fun injectForUrl_url未变化且非document_start_跳过注入_B1修复() = runTest {
        val script = scriptEntity(runAt = "document-end")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        // 第一次注入（URL 变化：lastInjectedUrl=null → url）
        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)
        assertThat(slot).hasSize(2)  // gm_api_init + 脚本

        // 第二次注入（URL 未变化，非 document-start）→ 跳过（B1 修复：return 语句）
        slot.clear()
        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)
        assertThat(slot).isEmpty()  // 跳过，evaluateJavascript 未被调用
    }

    @Test
    fun injectForUrl_document_start_总是重新注入_B1修复() = runTest {
        val script = scriptEntity(runAt = "document-start")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        // 第一次注入（document-start）
        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_START)
        assertThat(slot).hasSize(2)

        // 第二次注入（同 URL，document-start）→ 重新注入
        // （B1 修复：document-start 不跳过，新页面需要重新注入）
        slot.clear()
        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_START)
        assertThat(slot).hasSize(2)  // 重新注入
    }

    @Test
    fun injectForUrl_url变化时_重新注入() = runTest {
        val script = scriptEntity(runAt = "document-end")
        every { repository.snapshot() } returns listOf(script)
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        // 第一次注入 URL1
        injector.injectForUrl(view, "https://example.com/page1", RunAt.DOCUMENT_END)
        assertThat(slot).hasSize(2)

        // 第二次注入 URL2（URL 变化）→ 重新注入
        slot.clear()
        injector.injectForUrl(view, "https://example.com/page2", RunAt.DOCUMENT_END)
        assertThat(slot).hasSize(2)  // URL 变化，重新注入
    }

    // =========================================================================
    // 9. 空脚本列表不注入
    // =========================================================================

    @Test
    fun injectForUrl_空脚本列表不注入() = runTest {
        every { repository.snapshot() } returns emptyList()
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).isEmpty()
        verify(exactly = 0) { view.evaluateJavascript(any(), any()) }
    }

    // =========================================================================
    // 10. .user.js URL 拦截（onUserScriptUrlDetected）：MockWebServer 模拟下载
    //     验证：下载 + 解析 + repository.insert 后，importEvents 发射 ImportResult(success=true)
    // =========================================================================

    @Test
    fun onUserScriptUrlDetected_下载user_js_发射importEvents() = runBlocking {
        val userJsSource = """
            // ==UserScript==
            // @name Downloaded Script
            // @match https://example.com/*
            // ==/UserScript==
            console.log('downloaded');
        """.trimIndent()

        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(userJsSource))
        server.start()
        val url = server.url("/test.user.js").toString()

        // 用真实 OkHttpClient + Dispatchers.IO（OkHttp execute 阻塞，需 IO 线程）
        val realOkHttp = OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .build()

        // mock repository.insert（onUserScriptUrlDetected 会调用 insert 持久化，
        // importEvents 发射的是 ImportResult）
        coEvery { repository.insert(any()) } returns Unit

        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        try {
            val injector = createInjector(scope, realOkHttp)

            val deferred = CompletableDeferred<ImportResult>()
            val collectJob = scope.launch {
                injector.importEvents.collect { deferred.complete(it) }
            }

            injector.onUserScriptUrlDetected(url)

            // 等待 importEvents 发射 ImportResult（5 秒超时）
            val result = withTimeout(5000L) { deferred.await() }

            assertThat(result.success).isTrue()
            assertThat(result.name).isEqualTo("Downloaded Script")
            assertThat(result.error).isNull()

            collectJob.cancel()
        } finally {
            scope.cancel()
            server.shutdown()
        }
    }

    // =========================================================================
    // 11. enabled=false 的脚本不注入（snapshot() 在 repository 层过滤）
    // =========================================================================

    @Test
    fun injectForUrl_enabled_false的脚本不注入_repository层过滤() = runTest {
        // repository.snapshot() 仅返回 enabled=true 的脚本
        // 模拟 enabled=false 脚本被过滤后 snapshot 返回空列表
        every { repository.snapshot() } returns emptyList()
        val injector = createInjector(backgroundScope)

        val slot = mutableListOf<String>()
        every { view.evaluateJavascript(capture(slot), any()) } returns Unit

        injector.injectForUrl(view, "https://example.com/page", RunAt.DOCUMENT_END)

        assertThat(slot).isEmpty()
        verify(exactly = 0) { view.evaluateJavascript(any(), any()) }
    }
}
