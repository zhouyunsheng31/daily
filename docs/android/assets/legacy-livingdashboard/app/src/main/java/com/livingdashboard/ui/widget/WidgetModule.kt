package com.livingdashboard.ui.widget

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Widget DI 模块（Spec 5.3）。
 *
 * 提供 [WidgetRegistry] 单例，并在创建时注册 5 个 MVP 组件（D10）：
 * - AI_ASSISTANT → [AIAssistantWidget]
 * - WEBVIEW → [WebviewWidget]
 * - CALCULATOR → [CalculatorWidget]
 * - FOCUS_TIMER → [FocusTimerWidget]
 * - HTML_CANVAS → [HtmlCanvasWidget]
 *
 * 使用方式：
 * 1. Hilt 自动注入 WidgetRegistry 到 ViewModel/Activity
 * 2. 在 Compose 树顶层用 `CompositionLocalProvider(LocalWidgetRegistry provides registry)` 注入
 * 3. 子组件用 `LocalWidgetRegistry.current` 访问，或直接调用 [WidgetRenderer]
 *
 * 注意：渲染函数 lambda 是 `@Composable (WidgetRenderParams) -> Unit` 类型，
 * 存储在 registry 的 map 中，只在 Compose 树内调用时才执行（不在 DI 容器中执行）。
 */
@Module
@InstallIn(SingletonComponent::class)
object WidgetModule {

    @Provides
    @Singleton
    fun provideWidgetRegistry(): WidgetRegistry {
        return WidgetRegistry().apply {
            // D10：注册 5 个 MVP 组件渲染函数
            register(WidgetType.AI_ASSISTANT) { params -> AIAssistantWidget(params) }
            register(WidgetType.WEBVIEW) { params -> WebviewWidget(params) }
            register(WidgetType.CALCULATOR) { params -> CalculatorWidget(params) }
            register(WidgetType.FOCUS_TIMER) { params -> FocusTimerWidget(params) }
            register(WidgetType.HTML_CANVAS) { params -> HtmlCanvasWidget(params) }
            register(WidgetType.FREE_HTML) { params -> FreeHtmlWidget(params) }
        }
    }
}
