package com.livingdashboard.script

/**
 * 油猴 `@match` / `@include` / `@exclude` URL 模式匹配器
 * （Spec 2.4.2 / 2.5.1 / Phase M4 T4 脚本注入器）。
 *
 * 油猴 `@match` 规范：`scheme://host/path` 三段。
 * - scheme：`*` → `(http|https)`；其他字面量
 * - host：`*` → `[^/.]*`（v3 修复 S4：不跨 `/` 也不跨 `.`，与注释一致）；
 *   `*.example.com` → `[^/.]*\.example\.com`
 * - path：先 `Regex.escape(path)` 再 `.replace("\\*", ".*")`
 *   （v3 修复 S5：Tampermonkey 规范 path 段只有 `*` 是通配符，其他正则元字符按字面量）
 *
 * `@include` 更宽松（支持正则）；`@exclude` 同 `@match` 语义。
 *
 * 调用方：
 * - [com.livingdashboard.script.ScriptInjector.matchesUrl] 判断脚本是否匹配当前 URL
 * - 单元测试 UrlMatcherTest 覆盖典型/边界 case
 */
object UrlMatcher {
    /**
     * 批量匹配：任一 pattern 命中 url 即返回 true（Spec 2.5.1 / Phase M4 T4 任务签名）。
     *
     * 用于 [com.livingdashboard.script.ScriptInjector.matchesUrl] 中
     * `script.matches.any { UrlMatcher.matches(it, url) }` 的便捷封装。
     *
     * @param url 待匹配的完整 URL
     * @param patterns `@match` 模式列表（任一匹配即通过）
     * @return 任一 pattern 匹配返回 true；patterns 为空返回 false
     */
    fun matches(url: String, patterns: List<String>): Boolean =
        patterns.any { matches(it, url) }

    /**
     * 单 pattern 匹配（Spec 2.4.2）：将 pattern 转为正则后 `Regex.matches(url)`。
     *
     * @param pattern `@match` 模式（scheme://host/path）
     * @param url 待匹配的完整 URL
     * @return 匹配返回 true；pattern 非法或正则编译失败返回 false（容错，不抛异常）
     */
    fun matches(pattern: String, url: String): Boolean {
        return try {
            patternToRegex(pattern).matches(url)
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 将 `@match` pattern 转为正则（Spec 2.4.2 + v3 修复 S4/S5）。
     *
     * 解析 `scheme://host/path` 三段：
     * - scheme：`*` → `(http|https)`；其他用 [Regex.escape] 转义
     * - host：先 [Regex.escape] 转义所有正则元字符（含 `.`），再把 `\*` 替换为 `[^/.]*`
     *   （v3 修复 S4：`*` 不跨 `/` 也不跨 `.`，与注释一致；
     *    原 v2 用 `.*` 会跨 `.` 导致 `*.evil.com` 误匹配 `good.example.com`）
     * - path：先 [Regex.escape] 转义所有正则元字符，再把 `\*` 替换为 `.*`
     *   （v3 修复 S5：Tampermonkey 规范 path 段只有 `*` 是通配符；
     *    原 v2 未 escape 导致 `?` `+` `(` `)` 等元字符按正则语义而非字面量）
     *
     * 无 `://` 的 pattern 按字面量匹配（[Regex.escape]）。
     *
     * @param pattern `@match` 模式
     * @return 锚定首尾的正则（`^...$`）
     */
    fun patternToRegex(pattern: String): Regex {
        // 解析 scheme://host/path
        val schemeEnd = pattern.indexOf("://")
        if (schemeEnd < 0) return Regex(escapeLiteral(pattern))
        val scheme = pattern.substring(0, schemeEnd)
        val rest = pattern.substring(schemeEnd + 3)
        val slashIdx = rest.indexOf('/')
        val host = if (slashIdx < 0) rest else rest.substring(0, slashIdx)
        val path = if (slashIdx < 0) "" else rest.substring(slashIdx)

        val schemeRegex = if (scheme == "*") "(http|https)" else escapeLiteral(scheme)
        // v3 修复 S4：host 段 * 替换为 [^/.]*（不跨 / 也不跨 .）
        val hostRegex = escapeKeepStar(host, "[^/.]*")
        // v3 修复 S5：path 段只保留 * 为通配符，其他正则元字符按字面量
        val pathRegex = escapeKeepStar(path, ".*")

        return Regex("^$schemeRegex://$hostRegex$pathRegex$")
    }

    /**
     * 纯字面量转义：将所有正则元字符（含 `*`）转义为字面量。
     *
     * 用于无 `://` 的 pattern 和 scheme 段。
     * 手动实现而非 [Regex.escape]，因为后者在 JVM 上用 `Pattern.quote` 生成 `\Q...\E`，
     * 导致后续无法用 `.replace` 恢复 `*`。
     */
    private fun escapeLiteral(s: String): String {
        val sb = StringBuilder(s.length * 2)
        for (c in s) {
            if (c in "\\.[]{}()*+-?^\$|&~:#<>=,/") sb.append('\\')
            sb.append(c)
        }
        return sb.toString()
    }

    /**
     * 转义正则元字符但保留 `*` 为通配符（v3 修复 S4/S5 的关键）。
     *
     * [Regex.escape] 在 JVM 上调用 [java.util.regex.Pattern.quote]，将整个字符串
     * 包裹在 `\Q...\E` 中，`*` 未被反斜杠转义，导致后续 `.replace("\\*", ...)`
     * 无法匹配，S4/S5 修复静默失效。本函数逐字符转义，绕过此问题。
     *
     * @param s 待转义的字符串（host 或 path 段）
     * @param starReplacement `*` 的正则替换值（host → `[^/.]*`，path → `.*`）
     */
    private fun escapeKeepStar(s: String, starReplacement: String): String {
        val sb = StringBuilder(s.length * 2)
        for (c in s) {
            when (c) {
                '*' -> sb.append(starReplacement)
                in "\\.[]{}()+-?^\$|&~:#<>=,/," -> { sb.append('\\'); sb.append(c) }
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }

    /**
     * `@include` 匹配（Spec 2.4.2）：比 `@match` 更宽松，支持正则表达式。
     *
     * - pattern 作为正则尝试 [Regex.containsMatchIn]（部分匹配即可）
     * - pattern 非法正则时回退到 [matches]（字面量 `@match` 语义）
     *
     * @param pattern `@include` 模式（正则或 `@match` 风格）
     * @param url 待匹配的完整 URL
     * @return 匹配返回 true；正则编译失败时回退到字面量匹配
     */
    fun includes(pattern: String, url: String): Boolean {
        return try {
            Regex(pattern).containsMatchIn(url)
        } catch (e: Exception) {
            matches(pattern, url)
        }
    }
}
