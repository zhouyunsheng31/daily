package com.livingdashboard.data.prefs

/**
 * User-Agent 模式枚举（Spec 3.2.1 / 3.3.9）。
 *
 * - [MOBILE]：移动端 UA（默认），网站返回移动版页面
 * - [DESKTOP]：桌面端 UA，用于"请求桌面版网站"
 *
 * 在 [com.livingdashboard.browser.LivingWebView] 中根据 [UaMode] 选择 [MOBILE_UA] / [DESKTOP_UA]，
 * 由 [com.livingdashboard.data.prefs.SettingsStore.uaMode] Flow 持久化。
 */
enum class UaMode {
    MOBILE,
    DESKTOP,
}
