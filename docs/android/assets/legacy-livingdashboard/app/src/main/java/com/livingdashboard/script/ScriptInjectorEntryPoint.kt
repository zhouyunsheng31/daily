package com.livingdashboard.script

import com.livingdashboard.ai.ActiveWebViewHolder
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * Hilt EntryPoint 用于在非 ViewModel 体系内的 Composable 中获取脚本系统依赖
 * （Spec 2.4.7 / 2.8 / Phase M4 T4 脚本注入器）。
 *
 * **用途**：[com.livingdashboard.ui.widget.WebviewWidget] 是画布 widget，不在 Hilt ViewModel
 * 体系内（无法用 `@HiltViewModel` + `hiltViewModel()` 获取依赖）。通过 EntryPoint 可从
 * Application Context 直接获取 Singleton 作用域的实例。
 *
 * **v3 修复 M3**：用 `EntryPointAccessors.fromApplication(context.applicationContext, ...)`
 * 替代 `EntryPoints.get`，避免 Activity context 在某些 Hilt 版本下抛
 * `IllegalStateException: Given component holder class does not implement ...`。
 *
 * **v3 修复 S8**：[activeWebViewHolder] 必须暴露，否则 WebviewWidget 内的 GM 异步回调
 * （GM_xmlhttpRequest / GM_notification）会路由到错误的 WebView（BrowserViewModel 的 holder
 * 而非 widget 自己创建的 WebView）。
 *
 * 使用示例：
 * ```kotlin
 * @Composable
 * private fun rememberScriptDeps(): Triple<ScriptInjector?, GmApiBridge?, ActiveWebViewHolder?> {
 *     val context = LocalContext.current
 *     val entryPoint = remember(context) {
 *         EntryPointAccessors.fromApplication(
 *             context.applicationContext,
 *             ScriptInjectorEntryPoint::class.java
 *         )
 *     }
 *     return Triple(entryPoint.scriptInjector(), entryPoint.gmApiBridge(), entryPoint.activeWebViewHolder())
 * }
 * ```
 *
 * 调用方：
 * - [com.livingdashboard.ui.widget.WebviewWidget]：rememberScriptDeps() 获取后传给 LivingWebView
 * - 单元测试可通过 HiltAndroidTestRule + EntryPointAccessors 验证绑定
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface ScriptInjectorEntryPoint {
    /**
     * 脚本注入器（Spec 2.10）。
     *
     * - 注入 gm_api_init.js + 匹配脚本到 WebView
     * - 拦截 .user.js URL 触发导入流程
     *
     * 由 AppModule.provideScriptInjector 提供（@Singleton）。
     */
    fun scriptInjector(): ScriptInjector

    /**
     * GM_* API 桥接（Spec 2.3.3）。
     *
     * - 拦截 onJsPrompt `__GM_CALL__|` 前缀分发到 7 个 API
     * - 异步 API 用 evaluateJavascript 回调（GM_xmlhttpRequest / GM_notification）
     *
     * 由 AppModule.provideGmApiBridge 提供（@Singleton）。
     */
    fun gmApiBridge(): GmApiBridge

    /**
     * 活跃 WebView 持有者（v3 修复 S8）。
     *
     * - 持有当前活跃的 [android.webkit.WebView]（BrowserViewModel / CanvasHomeViewModel 写入）
     * - GmApiBridge 异步回调通过 `holder.value.value?.evaluateJavascript(...)` 路由到当前 WebView
     * - WebviewWidget 必须传自己的 holder，否则回调会路由到错误 WebView
     *
     * 由 AppModule.provideActiveWebViewHolder 提供（@Singleton）。
     */
    fun activeWebViewHolder(): ActiveWebViewHolder
}
