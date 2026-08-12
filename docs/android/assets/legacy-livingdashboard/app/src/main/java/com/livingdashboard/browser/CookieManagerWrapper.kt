package com.livingdashboard.browser

import android.webkit.CookieManager

/**
 * Cookie 管理封装（Spec 3.2.4）。
 *
 * 文件名与类名一致（CookieManagerWrapper.kt），避免与 Android 系统
 * android.webkit.CookieManager 混淆。
 *
 * 由 Hilt 注入为单例（见 DatabaseModule.provideCookieManager）。
 * 初始化时自动启用 Cookie 接受（setAcceptCookie(true)）。
 */
class CookieManagerWrapper {
    private val cm = CookieManager.getInstance()

    init {
        cm.setAcceptCookie(true)
    }

    /**
     * 获取指定 URL 的 Cookie 字符串。
     * @param url 目标 URL
     * @return Cookie 字符串（格式：key=value; key2=value2），无 Cookie 返回空字符串
     */
    fun getCookies(url: String): String = cm.getCookie(url) ?: ""

    /**
     * 设置指定 URL 的 Cookie，并立即 flush 到持久化存储。
     * @param url 目标 URL
     * @param cookie Cookie 字符串（格式：key=value）
     */
    fun setCookie(url: String, cookie: String) {
        cm.setCookie(url, cookie)
        cm.flush()
    }

    /**
     * 移除所有 Cookie，并立即 flush。
     * 注意：removeAllCookies 是异步操作，回调 null 表示不关心完成时机。
     */
    fun removeAllCookies() {
        cm.removeAllCookies(null)
        cm.flush()
    }

    /** 强制把内存中的 Cookie 写入持久化存储 */
    fun flush() {
        cm.flush()
    }
}
