package com.livingdashboard.script

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * GM_* API 桥接调用数据类（Spec 2.3.4 / 2.3.7 / Phase M4 T1 数据层）。
 *
 * JS 侧通过 `prompt('__GM_CALL__|' + JSON.stringify({api, args, cbId}))` 调用，
 * Kotlin 侧 [com.livingdashboard.script.GmApiBridge.handlePrompt] 用
 * `Json.decodeFromString(GmCall.serializer(), json)` 反序列化。
 *
 * 字段：
 * - [api]：API 名称（必填 String）
 *   合法值：`GM_addStyle` / `GM_setValue` / `GM_getValue` / `GM_setClipboard`
 *           / `GM_notification` / `GM_xmlhttpRequest` / `GM_xhrAbort`
 *   （Spec 2.3.2 表格，v3 修复 F2 含 GM_xhrAbort 共 7 个）
 * - [args]：参数对象（必填 JsonObject，kotlinx.serialization.json.JsonObject）
 *   各 API 的字段见 Spec 2.3.2：
 *     - GM_addStyle: { css }
 *     - GM_setValue: { key, value }
 *     - GM_getValue: { key, default }（v3 修复 B2：JS 侧补发 default 字段）
 *     - GM_setClipboard: { text }
 *     - GM_notification: details（title/text/onclick 等）
 *     - GM_xmlhttpRequest: details（url/method/headers/data/onload/onerror 等）
 *     - GM_xhrAbort: { id }
 * - [cbId]：回调 ID（可空，仅异步 API 携带）
 *   - 同步 API（GM_addStyle/GM_setValue/GM_getValue/GM_setClipboard/GM_xhrAbort）为 null
 *   - 异步 API（GM_xmlhttpRequest/GM_notification）由 JS 侧生成 'cb' + (++cbId)
 *
 * 安全约束（Spec 2.3.1 v3 修复 M7）：
 * - `@Serializable` 保证 `api` 必填 String、`args` 必填 JsonObject；
 *   JSON 缺字段或类型不符时 `Json.decodeFromString` 抛异常，
 *   GmApiBridge.handlePrompt 用 try-catch 捕获后 `result.cancel()` 返回 false。
 * - `api` 为空字符串时由 GmApiBridge.handlePrompt 显式校验并 cancel。
 *
 * ProGuard/R8（Spec 2.3.8 v3 修复 L4）：
 * - kotlinx-serialization 编译器插件自动为 @Serializable 类生成 keep 规则，
 *   R8 `isMinifyEnabled = true` 不会裁剪本类。
 */
@Serializable
data class GmCall(
    val api: String,
    val args: JsonObject,
    val cbId: String? = null,
)
