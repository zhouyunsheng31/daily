package com.livingdashboard.ui.nav

/**
 * 路由常量表（Spec 附录 B）。
 *
 * M2 新增：保留 M1 路由字符串值（"home"/"browser/{tabId}"/"tabs"/"bookmarks"/"history"/"settings"）不变，
 * 新增画布相关路由：CANVAS_HOME / CANVAS / WEBOS / AGGREGATE。
 *
 * 提供 `browser(tabId)` / `canvas(panelId)` / `webos(widgetId)` 三个 helper 方法，
 * 替代 M1 中硬编码的 `"browser/$tabId"` 字符串拼接，统一管理。
 */
object Routes {
    // ===== M1 路由（保留字符串值不变） =====
    const val BROWSER_HOME = "home"
    const val BROWSER = "browser/{tabId}"
    const val TABS = "tabs"
    const val BOOKMARKS = "bookmarks"
    const val HISTORY = "history"
    const val SETTINGS = "settings"

    // ===== M2 新增路由 =====
    /** 画布主页（Spec T1） */
    const val CANVAS_HOME = "canvas_home"

    /** 画布页（Spec T3，分层画布） */
    const val CANVAS = "canvas/{panelId}"

    /** WebOS 收藏组件全屏页（Spec T11） */
    const val WEBOS = "webos/{widgetId}"

    /** 聚合面板（Spec T12） */
    const val AGGREGATE = "aggregate"

    /** M8：AI 配置页（Spec 6.11.3 节） */
    const val AI_CONFIG = "aiConfig"

    // ===== M4 新增路由（Spec 2.6.4） =====

    /** 脚本管理列表页 */
    const val SCRIPT_LIST = "scriptList"

    /** 脚本新建页（scriptId = null 模式） */
    const val SCRIPT_NEW = "scriptNew"

    /** 脚本编辑页（带 scriptId 参数） */
    const val SCRIPT_EDIT = "scriptEdit/{scriptId}"

    // ===== Helper 方法（替代字符串拼接） =====

    /** 拼接脚本编辑页路由：scriptEdit/{scriptId} → "scriptEdit/<scriptId>" */
    fun scriptEdit(scriptId: String) = "scriptEdit/$scriptId"

    /** 拼接浏览器页路由：browser/{tabId} → "browser/<tabId>" */
    fun browser(tabId: String) = "browser/$tabId"

    /** 拼接画布页路由：canvas/{panelId} → "canvas/<panelId>" */
    fun canvas(panelId: String) = "canvas/$panelId"

    /** 拼接 WebOS 收藏页路由：webos/{widgetId} → "webos/<widgetId>" */
    fun webos(widgetId: String) = "webos/$widgetId"
}
