package com.livingdashboard.script

/**
 * 脚本注入时机枚举（Spec 2.4.3 / 2.6.2 / Phase M4 T4 脚本注入器）。
 *
 * 对应油猴 `@run-at` 元数据字段的三种合法值：
 * - [DOCUMENT_START]：DOM 构造前（onPageStarted 时立即注入）
 * - [DOCUMENT_END]：DOM 构造完成（onPageFinished 时注入）
 * - [DOCUMENT_IDLE]：DOM 完成后空闲（onPageFinished 后 postDelayed(100ms) 注入）
 *
 * [value] 与 [com.livingdashboard.data.entity.UserScriptEntity.runAt] 字段存储的字符串一致
 *（"document-start" / "document-end" / "document-idle"）。
 *
 * [fromString] 容错：非法值回退 [DOCUMENT_END]（与 ScriptMetadataParser 的回退逻辑一致，
 * Spec 2.2.2 第 4 条）。
 *
 * 调用方：
 * - [com.livingdashboard.script.ScriptInjector.injectForUrl] 按 runAt 分组注入
 * - [com.livingdashboard.browser.LivingWebViewClient] 在 onPageStarted / onPageFinished 中传入
 */
enum class RunAt(val value: String) {
    DOCUMENT_START("document-start"),
    DOCUMENT_END("document-end"),
    DOCUMENT_IDLE("document-idle");

    companion object {
        /**
         * 字符串转 [RunAt]：匹配 [value]；非法值回退 [DOCUMENT_END]。
         *
         * 与 [com.livingdashboard.script.ScriptMetadataParser] 中 VALID_RUN_AT 校验一致，
         * 保证 DB 中存储的 runAt 字符串能稳定还原为枚举。
         */
        fun fromString(s: String): RunAt = entries.firstOrNull { it.value == s } ?: DOCUMENT_END
    }
}
