package com.livingdashboard.browser

import com.livingdashboard.data.SearchEngine

/**
 * URL 工具函数（Spec 8.2）。
 *
 * 职责：
 * 1. buildUrlFromInput：把用户输入（URL 或搜索词）转换成可加载的 URL
 * 2. normalizeUrlForDisplay：把 URL 转成地址栏显示形式（隐藏协议）
 */

/**
 * 根据用户输入构建 URL。
 *
 * 判断逻辑：
 * - 已有 http:// 或 https:// 前缀 → 直接返回
 * - 看起来像域名（包含 . 且无空格）→ 补全 https:// 前缀
 * - 其他 → 当搜索词，用搜索引擎拼接
 *
 * @param input 用户输入（URL 或搜索词）
 * @param searchEngine 搜索引擎（当 input 是搜索词时使用）
 * @return 可加载的 URL，空输入返回空字符串
 */
fun buildUrlFromInput(input: String, searchEngine: SearchEngine): String {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return ""

    // 已有协议
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed
    }

    // 看起来像域名（包含 . 且无空格）
    if (trimmed.contains(".") && !trimmed.contains(" ")) {
        return "https://$trimmed"
    }

    // 搜索词
    return searchEngine.buildSearchUrl(trimmed)
}

/**
 * 把 URL 规范化为地址栏显示形式。
 *
 * - 隐藏 http:// 和 https:// 前缀
 * - 其他协议（tel:、mailto: 等）保持原样
 * - 空字符串返回空字符串
 *
 * @param url 原始 URL
 * @return 显示用 URL（例如 https://www.baidu.com → www.baidu.com）
 */
fun normalizeUrlForDisplay(url: String): String {
    if (url.isEmpty()) return ""
    return when {
        url.startsWith("https://") -> url.removePrefix("https://")
        url.startsWith("http://") -> url.removePrefix("http://")
        else -> url
    }
}
