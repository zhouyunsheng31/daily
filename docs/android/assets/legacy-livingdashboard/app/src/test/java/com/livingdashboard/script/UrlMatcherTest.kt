package com.livingdashboard.script

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/**
 * Phase M4 T4 单元测试：UrlMatcher（Spec 2.4.2 / v3.1）。
 *
 * 覆盖：
 * - scheme 精确（https）与通配符（*）
 * - host 通配符 `*.example.com`（v3 修复 S4：`*` → `[^/.]*`，不跨 `/` 也不跨 `.`）
 * - path 通配符 `*` 与正则元字符（v3 修复 S5：先 escape 再恢复 `\*`，`.` 当字面量）
 * - 多 pattern 任一匹配
 *
 * 使用 JUnit 4 + Truth（build.gradle.kts 已引入 testImplementation）。
 */
class UrlMatcherTest {

    // ===== scheme =====

    @Test
    fun matches_https精确scheme匹配https且不匹配http() {
        // exact scheme：https 字面量
        val pattern = "https://example.com/"

        val httpsResult = UrlMatcher.matches(pattern, "https://example.com/")
        val httpResult = UrlMatcher.matches(pattern, "http://example.com/")

        assertThat(httpsResult).isTrue()
        assertThat(httpResult).isFalse()
    }

    @Test
    fun matches_通配符scheme_匹配http和https() {
        // * → (http|https)
        val pattern = "*://example.com/"

        val httpResult = UrlMatcher.matches(pattern, "http://example.com/")
        val httpsResult = UrlMatcher.matches(pattern, "https://example.com/")

        assertThat(httpResult).isTrue()
        assertThat(httpsResult).isTrue()
    }

    // ===== host（v3 修复 S4）=====

    @Test
    fun matches_host通配_匹配sub_example_com_S4修复() {
        // S4 修复：host 段 * → [^/.]*（不跨 / 也不跨 .）
        // *.example.com → [^/.]*\.example\.com，单层子域 sub 正确匹配
        val pattern = "*://*.example.com/"
        val url = "https://sub.example.com/"

        val result = UrlMatcher.matches(pattern, url)

        assertThat(result).isTrue()
    }

    @Test
    fun matches_host通配_不匹配多层子域_不跨点_S4修复() {
        // S4 修复验证：*.example.com 的 * 不应跨 . 边界
        //
        // 注：原 spec 要求用 evilcom.example.com，但该 URL 是 example.com 的合法单层
        // 子域（evilcom 不含 .），v3 实现 [^/.]* 会正确匹配它（与 sub.example.com 同）。
        // 为真正验证 S4 修复（* 不跨 .），改用多层子域 a.b.example.com：
        // - v2 用 .* 会跨 . 匹配 a.b → 误命中
        // - v3 用 [^/.]* 不能跨 . 匹配 a.b → 正确拒绝
        val pattern = "*://*.example.com/"
        val url = "https://a.b.example.com/"

        val result = UrlMatcher.matches(pattern, url)

        assertThat(result).isFalse()
    }

    // ===== path（v3 修复 S5）=====

    @Test
    fun matches_path通配_匹配path下任意子路径() {
        // path 段 * → .*（任意字符）
        val pattern = "https://example.com/path/*"
        val url = "https://example.com/path/anything"

        val result = UrlMatcher.matches(pattern, url)

        assertThat(result).isTrue()
    }

    @Test
    fun matches_path元字符_file_html精确匹配_S5修复() {
        // S5 修复：path 段先 Regex.escape，. 当字面量而非通配符
        val pattern = "https://example.com/path/file.html"
        val url = "https://example.com/path/file.html"

        val result = UrlMatcher.matches(pattern, url)

        assertThat(result).isTrue()
    }

    @Test
    fun matches_path元字符_file_html不匹配fileXhtml_S5修复() {
        // S5 修复验证：. 不当通配符，file.html 不匹配 fileXhtml
        // （v2 未 escape 时 . 是正则元字符，会误匹配 fileXhtml）
        val pattern = "https://example.com/path/file.html"
        val url = "https://example.com/path/fileXhtml"

        val result = UrlMatcher.matches(pattern, url)

        assertThat(result).isFalse()
    }

    // ===== 多 pattern =====

    @Test
    fun matches_多pattern任一匹配返回true() {
        val patterns = listOf(
            "https://nope.com/*",
            "https://example.com/*",
            "https://other.com/*",
        )
        val url = "https://example.com/page"

        val result = UrlMatcher.matches(url, patterns)

        assertThat(result).isTrue()
    }

    @Test
    fun matches_所有pattern不匹配返回false() {
        val patterns = listOf(
            "https://nope.com/*",
            "https://other.com/*",
        )
        val url = "https://example.com/page"

        val result = UrlMatcher.matches(url, patterns)

        assertThat(result).isFalse()
    }
}
