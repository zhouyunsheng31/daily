package com.livingdashboard.ui.widget

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf

/**
 * 组件注册表（Spec 5.3）。
 *
 * 维护 WidgetType → 渲染函数的映射，供 WidgetRenderer 分发用。
 * 通过 WidgetModule（Hilt）提供单例，App 启动时注册 5 个 MVP 组件。
 *
 * 设计要点：
 * - 渲染函数签名 `@Composable (WidgetRenderParams) -> Unit`，组件内部根据 [WidgetRenderParams.zoomLevel]
 *   自行决定缩略图/摘要/交互/完整的呈现（D9 分层渲染）
 * - 组件不直接依赖 Room，状态变更通过 [WidgetRenderParams.onStateChange] 回调
 */
class WidgetRegistry {

    private val renderers =
        mutableMapOf<WidgetType, @Composable (WidgetRenderParams) -> Unit>()

    /** 注册组件渲染函数（重复注册同 type 会覆盖） */
    fun register(type: WidgetType, renderer: @Composable (WidgetRenderParams) -> Unit) {
        renderers[type] = renderer
    }

    /** 获取指定类型的渲染函数，未注册返回 null */
    fun getRenderer(type: WidgetType): (@Composable (WidgetRenderParams) -> Unit)? =
        renderers[type]

    /** 是否已注册指定类型 */
    fun hasRenderer(type: WidgetType): Boolean = renderers.containsKey(type)

    /** 已注册的所有类型（供调试/面板管理用） */
    fun registeredTypes(): Set<WidgetType> = renderers.keys.toSet()
}

/**
 * CompositionLocal：在 Compose 树中提供 WidgetRegistry 实例。
 *
 * 使用方式：在 Application/Activity 层用 `CompositionLocalProvider(LocalWidgetRegistry provides registry)`
 * 注入，子组件用 `LocalWidgetRegistry.current` 访问。
 *
 * 默认值抛异常，强制调用方必须显式 provide，避免遗漏导致 NPE。
 */
val LocalWidgetRegistry = compositionLocalOf<WidgetRegistry> {
    error("WidgetRegistry 未提供：请在 Application/Activity 层用 CompositionLocalProvider 注入")
}
