package com.livingdashboard.script

import android.content.Context
import android.webkit.WebView
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * .user.js 导入结果（M4 修复 P1，方式 C 自动导入通知）。
 *
 * [ScriptInjector.onUserScriptUrlDetected] 下载 + 解析 + insert 后，
 * 通过 [ScriptInjector.importEvents] 发射此结果，UI 层（ScriptImportViewModel）
 * 订阅后用 Snackbar 显示"已导入脚本: XXX"或"导入失败: XXX"。
 *
 * @param name 脚本名（成功时非空，失败时可能为空字符串）
 * @param success 是否成功
 * @param error 失败时的错误信息（成功时为 null）
 */
data class ImportResult(
    val name: String,
    val success: Boolean,
    val error: String? = null,
)

/**
 * 用户脚本注入器（Spec 2.4.1 / 2.10 / 2.7 / Phase M4 T4 脚本注入器）。
 *
 * 职责：
 * 1. 在 WebView 页面加载的三个时机（document-start / document-end / document-idle）
 *    注入匹配的用户脚本
 * 2. 注入 GM_* API 初始化 JS（[getGmApiInitJs] 从 assets 读取，首次缓存）
 * 3. 拦截 `.user.js` URL（[onUserScriptUrlDetected]）：下载 → 解析 → insert → 发 [importEvents]
 *    通知 UI 层显示 Snackbar（M4 修复 P1，方式 C 自动导入 + 全局通知）
 *
 * 注入流程（Spec 2.4.1）：
 * ```
 * WebView.onPageStarted(url) → injectForUrl(view, url, DOCUMENT_START)
 *   1. repository.snapshot() 同步读 enabled=true 的脚本
 *   2. 过滤 runAt == DOCUMENT_START 且 matchesUrl(script, url)
 *   3. 注入顺序：gm_api_init.js → 每个脚本（IIFE 包裹 try-catch）
 * WebView.onPageFinished(url) → injectForUrl(view, url, DOCUMENT_END)
 *   → view.postDelayed(100ms) → injectForUrl(view, url, DOCUMENT_IDLE)
 * ```
 *
 * 关键修复（v3.1）：
 * - **S3 修复**：[lastInjectedUrl] 跟踪上次注入的 URL，避免重定向 / 多次 onPageFinished
 *   触发同一 URL 的脚本重复注入（document-start 或 URL 变化时才更新）
 * - **M4 修复 P1**：[onUserScriptUrlDetected] 拦截 `.user.js` URL，触发下载 + 解析 + insert 持久化
 *   + 发 [ImportResult] 通知 UI 显示 Snackbar（方式 C 自动导入，无需用户确认）
 *
 * DI（Spec 2.7.2）：
 * - @Singleton @Inject constructor，由 Hilt 自动解析依赖图
 * - [repository] 来自 DatabaseModule.provideUserScriptRepository
 * - [json] 来自 AppModule.provideJson（M5 同步 / 元数据序列化预留）
 * - [okHttpClient] 来自 AppModule.provideOkHttpClient
 * - [coroutineScope] 来自 AppModule.provideApplicationScope
 * - [gmApiBridge] 来自 AppModule.provideGmApiBridge（T3 同步创建中）
 * - [context] 由 @ApplicationContext 注入，用于 assets.open("scripts/gm_api_init.js")
 *
 * 调用方：
 * - [com.livingdashboard.browser.LivingWebViewClient.onPageStarted] / [onPageFinished]
 *   / [shouldOverrideUrlLoading]（.user.js 拦截）
 * - [com.livingdashboard.ui.widget.WebviewWidget] 通过
 *   [ScriptInjectorEntryPoint] 获取实例（非 ViewModel 体系内的 Composable）
 *
 * @param repository 用户脚本 Repository（snapshot 同步读 enabled 脚本）
 * @param json kotlinx.serialization.json.Json 实例（M5 同步 / 元数据序列化预留）
 * @param okHttpClient OkHttp 客户端（[onUserScriptUrlDetected] 下载 .user.js 用）
 * @param coroutineScope 应用级协程作用域（异步下载 + [importEvents] 发射）
 * @param gmApiBridge GM_* API 桥接（WebviewWidget 通过 EntryPoint 暴露给 LivingWebChromeClient）
 * @param context 应用 Context（assets 读取 gm_api_init.js）
 */
@Singleton
class ScriptInjector @Inject constructor(
    private val repository: UserScriptRepository,
    private val json: Json,
    private val okHttpClient: OkHttpClient,
    private val coroutineScope: CoroutineScope,
    private val gmApiBridge: GmApiBridge,
    @ApplicationContext private val context: Context,
) {
    /** GM_* API 初始化 JS 缓存（首次 [getGmApiInitJs] 时从 assets 读取后缓存）。 */
    private var gmApiInitJs: String? = null

    /**
     * v3 修复 S3：跟踪上次注入的 URL，避免同一 URL 重复注入脚本。
     *
     * - 初始 null：首次注入任意 URL 都视为"URL 变化"
     * - document-start 阶段：无论 URL 是否变化都更新（新页面需要重新注入）
     * - 非 document-start 阶段：仅 URL 变化时更新（重定向/pushState 触发的多次 onPageFinished 跳过）
     */
    private var lastInjectedUrl: String? = null

    /**
     * .user.js 导入事件流（M4 修复 P1，方式 C 自动导入 + 全局 Snackbar 通知）。
     *
     * [onUserScriptUrlDetected] 下载 + 解析 + repository.insert 后，通过 [tryEmit] 发射
     * [ImportResult]，UI 层（ScriptImportViewModel）监听此 Flow 用 Snackbar 显示导入结果。
     *
     * - extraBufferCapacity = 4：允许短时间内多次发射不丢失（用户连点多个 .user.js 链接）
     * - tryEmit：非挂起函数，可在任意线程调用（OkHttp 回调线程 / 协程内）
     * - UI 层用 StateFlow 订阅，每条通知消费后清空（consumeNotification）
     */
    val importEvents: MutableSharedFlow<ImportResult> = MutableSharedFlow(extraBufferCapacity = 4)

    /**
     * 为指定 URL 注入匹配的用户脚本（Spec 2.4.1 / 2.10）。
     *
     * 调用时机（由 [com.livingdashboard.browser.LivingWebViewClient] 触发）：
     * - onPageStarted → [RunAt.DOCUMENT_START]
     * - onPageFinished → [RunAt.DOCUMENT_END]
     * - onPageFinished + postDelayed(100ms) → [RunAt.DOCUMENT_IDLE]
     *
     * v3 修复 S3（[lastInjectedUrl] 去重）：
     * - URL 未变化且非 document-start → 直接 return（避免重定向 / 多次 onPageFinished 重复注入）
     * - document-start 或 URL 变化 → 更新 [lastInjectedUrl] 并继续注入
     *
     * 注入顺序：
     * 1. GM_* API 初始化 JS（[getGmApiInitJs]）—— IIFE 包裹
     *    （v3 修复 S2：gm_api_init.js 内部有 `__gmApiInitialized` 守卫，重复注入也安全）
     * 2. 每个匹配脚本正文 —— IIFE 包裹 + try-catch
     *    （try-catch 防止单个脚本异常影响后续脚本）
     *
     * @param WebView 实例（evaluateJavascript 注入 JS）
     * @param url 当前页面 URL
     * @param runAt 注入时机
     */
    fun injectForUrl(view: WebView, url: String, runAt: RunAt) {
        // v3 修复 S3 / B1：URL 未变化且非 document-start 时直接 return，避免重复注入
        // （原 v3 if 块为空体仅注释无 return，B1 修复补 return 语句）
        if (url == lastInjectedUrl && runAt != RunAt.DOCUMENT_START) {
            return
        }
        lastInjectedUrl = url  // 仅 document-start 或 URL 变化时更新

        val scripts = repository.snapshot().filter { script ->
            script.runAt == runAt.value && matchesUrl(script, url)
        }
        if (scripts.isEmpty()) return

        // 1. 注入 GM_* API init（v3 修复 S2：JS 侧有 __gmApiInitialized 守卫，重复注入也安全）
        view.evaluateJavascript("(function(){${getGmApiInitJs()}})();", null)

        // 2. 注入每个脚本（IIFE 包裹 + try-catch，单个脚本异常不影响后续）
        scripts.forEach { script ->
            val wrapped = "(function(){try{${script.code}}catch(e){console.error('[userscript ${script.name}]',e)}})();"
            view.evaluateJavascript(wrapped, null)
        }
    }

    /**
     * 获取 GM_* API 初始化 JS（Spec 2.10 / v3 修复 L5）。
     *
     * 从 assets 读取 `scripts/gm_api_init.js`（完整路径 `src/main/assets/scripts/gm_api_init.js`），
     * 首次读取后缓存在 [gmApiInitJs]，后续注入直接返回缓存值（避免每次 onPageStarted 都做 IO）。
     *
     * assets 路径无需在 build.gradle.kts sourceSets 中显式声明（`src/main/assets` 是默认路径）。
     *
     * @return GM_* API 初始化 JS 源码（含 `__gmApiInitialized` 守卫）
     */
    fun getGmApiInitJs(): String {
        gmApiInitJs?.let { return it }
        val js = context.assets.open("scripts/gm_api_init.js").bufferedReader().use { it.readText() }
        gmApiInitJs = js
        return js
    }

    /**
     * 拦截 `.user.js` URL 时调用（M4 修复 P1，方式 C 自动导入 + Snackbar 通知）。
     *
     * 由 [com.livingdashboard.browser.LivingWebViewClient.shouldOverrideUrlLoading] 检测 URL
     * 以 `.user.js` 结尾时调用。本方法异步下载 + 解析 + insert 持久化脚本，通过 [importEvents]
     * 发射 [ImportResult]，UI 层（ScriptImportViewModel）监听后用 Snackbar 显示导入结果。
     *
     * 流程：
     * 1. OkHttp 同步执行 GET 请求下载 .user.js 源码（在 [coroutineScope] 协程内）
     * 2. [ScriptMetadataParser.parse] 解析元数据块 + 提取代码正文
     * 3. [repository.insert] 持久化脚本（source="import", enabled=true，同 id 覆盖）
     * 4. [importEvents.tryEmit] 发射 [ImportResult]（含脚本名 + 成功/失败标志）
     *
     * 异常处理：下载 / 解析 / 写库失败时发射失败 [ImportResult]，UI 层显示"导入失败: XXX"
     *
     * @param url `.user.js` 文件 URL（http/https）
     */
    fun onUserScriptUrlDetected(url: String) {
        coroutineScope.launch {
            try {
                val resp = okHttpClient.newCall(Request.Builder().url(url).build()).execute()
                val body = resp.body?.string() ?: run {
                    importEvents.tryEmit(
                        ImportResult(name = "", success = false, error = "empty response body")
                    )
                    return@launch
                }
                val parsed = ScriptMetadataParser.parse(body)
                // 自动导入：直接 insert 持久化（source="import", enabled=true）
                val id = UUID.randomUUID().toString()
                val now = System.currentTimeMillis()
                repository.insert(
                    UserScriptEntity(
                        id = id,
                        name = parsed.metadata.name,
                        namespace = parsed.metadata.namespace,
                        version = parsed.metadata.version,
                        description = parsed.metadata.description,
                        author = parsed.metadata.author,
                        matches = parsed.metadata.matches,
                        includes = parsed.metadata.includes,
                        excludes = parsed.metadata.excludes,
                        grants = parsed.metadata.grants,
                        runAt = parsed.metadata.runAt,
                        code = parsed.code,
                        rawMetadata = parsed.rawMetadata,
                        enabled = true,
                        source = "import",
                        createdAt = now,
                        updatedAt = now,
                        versionCode = 1,
                    )
                )
                // 通知 UI 显示"已导入脚本: XXX"
                importEvents.tryEmit(
                    ImportResult(name = parsed.metadata.name, success = true)
                )
            } catch (e: Exception) {
                // 通知 UI 显示"导入失败: XXX"
                importEvents.tryEmit(
                    ImportResult(name = "", success = false, error = e.message ?: "import failed")
                )
            }
        }
    }

    /**
     * 判断脚本是否匹配 URL（Spec 2.4.2 匹配规则）。
     *
     * 规则：
     * 1. [UserScriptEntity.excludes] 任一匹配 → 拒绝（最高优先级）
     * 2. [UserScriptEntity.matches] 非空时，任一匹配 → 通过
     * 3. [UserScriptEntity.matches] 为空且 [UserScriptEntity.includes] 非空时，
     *    includes 任一匹配 → 通过
     * 4. matches 和 includes 都为空 → 默认不注入（避免误注入到所有页面）
     *
     * @param script 用户脚本 Entity
     * @param url 当前页面 URL
     * @return true 表示脚本应注入到该 URL
     */
    private fun matchesUrl(script: UserScriptEntity, url: String): Boolean {
        if (script.excludes.any { UrlMatcher.matches(it, url) }) return false
        if (script.matches.isNotEmpty()) {
            return script.matches.any { UrlMatcher.matches(it, url) }
        }
        if (script.includes.isNotEmpty()) {
            return script.includes.any { UrlMatcher.includes(it, url) }
        }
        return false  // 无 matches/includes 默认不注入
    }
}
