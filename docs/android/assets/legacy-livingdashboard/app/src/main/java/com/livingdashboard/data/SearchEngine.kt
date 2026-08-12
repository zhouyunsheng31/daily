package com.livingdashboard.data

/**
 * 搜索引擎枚举（Spec 3.3.9）。
 *
 * 用于 [com.livingdashboard.browser.buildUrlFromInput] 把搜索词拼接成完整 URL。
 * 在设置页 SettingsScreen.RadioButton 中显示 [displayName]。
 *
 * 取值与桌面端一致，覆盖中文用户常用场景。
 *
 * @param displayName 设置页显示名（中文）
 * @param searchUrlTemplate 搜索 URL 模板，`{q}` 占位符由 [buildSearchUrl] 替换为搜索词
 */
enum class SearchEngine(
    val displayName: String,
    private val searchUrlTemplate: String,
) {
    BAIDU("百度", "https://www.baidu.com/s?wd={q}"),
    GOOGLE("Google", "https://www.google.com/search?q={q}"),
    BING("Bing", "https://www.bing.com/search?q={q}"),
    BING_CN("Bing（国内）", "https://cn.bing.com/search?q={q}"),
    SO_360("360", "https://www.so.com/s?q={q}"),
    ;

    /**
     * 把搜索词拼接成完整搜索 URL。
     *
     * @param query 搜索词（已 trim，非空）
     * @return 完整 URL（已对 query 做 URL encode）
     */
    fun buildSearchUrl(query: String): String {
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        return searchUrlTemplate.replace("{q}", encoded)
    }
}
