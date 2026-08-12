package com.livingdashboard.script

/**
 * 用户脚本元数据解析器（Spec 2.2 / Phase M4 T2 元数据解析器）。
 *
 * 解析油猴 `.user.js` 脚本头 `// ==UserScript== ... // ==/UserScript==` 块，
 * 提取元数据字段（@name / @namespace / @version / @description / @author /
 * @match / @include / @exclude / @grant / @run-at），并支持用表单字段值
 * 重写代码中的元数据块（v3 修复 M4：表单字段为 source of truth）。
 *
 * 解析算法（Spec 2.2.2）：
 * 1. [METADATA_BLOCK_REGEX] 匹配元数据块（要求 `==UserScript==` 后无其他字符，行尾锚定）
 * 2. 块内逐行扫描 `// @key value`，key 转小写
 * 3. 多值 key（@match/@include/@exclude/@grant）累加到 List
 * 4. `@run-at` 校验枚举值（document-start/document-end/document-idle），非法值回退 `document-end`
 * 5. [ParsedScript.code] = 原文去掉元数据块后的部分（trim 前后空行）
 * 6. 无元数据块：metadata 全默认值，code = 原文 trim，rawMetadata = ""
 *
 * 容错：
 * - 重复 @key 单值取最后、多值全累加
 * - @key 拼写错误忽略
 * - value 含 `//` 时从 `// @key` 后第一个空格到行尾整段作为 value
 *
 * 调用方：
 * - [com.livingdashboard.script.ScriptInjector.onUserScriptUrlDetected]（导入 .user.js 时解析）
 * - [com.livingdashboard.ui.script.ScriptEditViewModel]（加载时解析填充表单 / 保存时重写）
 * - [com.livingdashboard.ai.tools.CreateUserscriptTool] 等 AI 工具（AI 生成脚本不含元数据块，用默认值）
 */
object ScriptMetadataParser {
    // 正则常量：匹配 ==UserScript== ... ==/UserScript== 块
    // (?s) 开启 DOTALL；要求 ==UserScript== 后无其他字符（行尾锚定），==/UserScript== 同理
    private val METADATA_BLOCK_REGEX = Regex(
        """(?s)//\s*==UserScript==\s*\n(.*?)//\s*==/UserScript=="""
    )
    // 行内 @key value 解析：// @key value（key 转小写；value 从 @key 后第一个空格到行尾）
    private val KEY_VALUE_REGEX = Regex("""^\s*//\s*@(\S+)\s*(.*)$""")

    // 多值 key 集合（每个 @match/@include/@exclude/@grant 都累加）
    private val MULTI_VALUE_KEYS = setOf("match", "include", "exclude", "grant")

    // @run-at 合法值
    private val VALID_RUN_AT = setOf("document-start", "document-end", "document-idle")

    /**
     * 解析脚本源码，提取元数据与代码正文。
     *
     * @param source 完整的 .user.js 源码
     * @return [ParsedScript]（无元数据块时返回默认值：metadata 全默认、code = source.trim、rawMetadata = ""）
     */
    fun parse(source: String): ParsedScript {
        val match = METADATA_BLOCK_REGEX.find(source) ?: return ParsedScript(
            rawMetadata = "",
            metadata = ScriptMetadata(),
            code = source.trim(),
        )

        val rawMetadata = match.value
        val block = match.groupValues[1]
        val code = source.removeRange(match.range).trim()

        // 解析块内每行 @key value
        val singles = mutableMapOf<String, String>()
        val multis = mutableMapOf<String, MutableList<String>>()

        block.lineSequence().forEach { line ->
            val kv = KEY_VALUE_REGEX.find(line) ?: return@forEach
            val key = kv.groupValues[1].lowercase()
            val value = kv.groupValues[2].trim()
            if (key.isEmpty()) return@forEach

            if (key in MULTI_VALUE_KEYS) {
                multis.getOrPut(key) { mutableListOf() }.add(value)
            } else {
                singles[key] = value  // 单值 key 重复时取最后
            }
        }

        val runAt = singles["run-at"]?.let { if (it in VALID_RUN_AT) it else "document-end" } ?: "document-end"

        val metadata = ScriptMetadata(
            name = singles["name"] ?: "Unnamed",
            namespace = singles["namespace"] ?: "",
            version = singles["version"] ?: "1.0",
            description = singles["description"] ?: "",
            author = singles["author"] ?: "",
            matches = multis["match"] ?: emptyList(),
            includes = multis["include"] ?: emptyList(),
            excludes = multis["exclude"] ?: emptyList(),
            grants = multis["grant"] ?: emptyList(),
            runAt = runAt,
        )
        return ParsedScript(rawMetadata = rawMetadata, metadata = metadata, code = code)
    }

    /**
     * v3 修复 M4：用表单元数据重写代码中的 ==UserScript== 块（表单字段为 source of truth）。
     *
     * 保持代码正文不变，仅同步元数据块。确保下次解析时表单与代码块一致。
     *
     * @param code 原始代码（可能含旧 ==UserScript== 块）
     * @param metadata 表单字段值组装的元数据
     * @return 新代码（含更新后的 ==UserScript== 块 + 原代码正文）
     */
    fun rewriteMetadata(code: String, metadata: ScriptMetadata): String {
        val body = METADATA_BLOCK_REGEX.find(code)?.let { code.removeRange(it.range).trim() } ?: code.trim()
        val sb = StringBuilder()
        sb.append("// ==UserScript==\n")
        sb.append("// @name ${metadata.name}\n")
        if (metadata.namespace.isNotEmpty()) sb.append("// @namespace ${metadata.namespace}\n")
        sb.append("// @version ${metadata.version}\n")
        if (metadata.description.isNotEmpty()) sb.append("// @description ${metadata.description}\n")
        if (metadata.author.isNotEmpty()) sb.append("// @author ${metadata.author}\n")
        metadata.matches.forEach { sb.append("// @match $it\n") }
        metadata.includes.forEach { sb.append("// @include $it\n") }
        metadata.excludes.forEach { sb.append("// @exclude $it\n") }
        metadata.grants.forEach { sb.append("// @grant $it\n") }
        sb.append("// @run-at ${metadata.runAt}\n")
        sb.append("// ==/UserScript==\n\n")
        sb.append(body)
        return sb.toString()
    }
}

/**
 * 用户脚本元数据（Spec 2.2.1）。
 *
 * 油猴 `// ==UserScript==` 块解析结果。所有字段带默认值，无元数据块或字段缺失时使用默认值。
 *
 * 字段：
 * - [name]：脚本名称（默认 "Unnamed"）
 * - [namespace]：命名空间（默认空）
 * - [version]：版本号（默认 "1.0"）
 * - [description]：描述（默认空）
 * - [author]：作者（默认空）
 * - [matches]：@match URL 模式列表（多值，默认空）
 * - [includes]：@include URL 模式列表（多值，默认空）
 * - [excludes]：@exclude URL 模式列表（多值，默认空）
 * - [grants]：@grant GM_* 权限列表（多值，默认空）
 * - [runAt]：注入时机（document-start/document-end/document-idle，默认 document-end）
 *
 * 与 [com.livingdashboard.data.entity.UserScriptEntity] 的字段一一对应，
 * 由 [ScriptMetadataParser.parse] 提取，由 ScriptEditViewModel 在保存时通过
 * [ScriptMetadataParser.rewriteMetadata] 重写回代码块。
 */
data class ScriptMetadata(
    val name: String = "Unnamed",
    val namespace: String = "",
    val version: String = "1.0",
    val description: String = "",
    val author: String = "",
    val matches: List<String> = emptyList(),
    val includes: List<String> = emptyList(),
    val excludes: List<String> = emptyList(),
    val grants: List<String> = emptyList(),
    val runAt: String = "document-end",
)

/**
 * 解析后的用户脚本（Spec 2.2.1）。
 *
 * @param rawMetadata 原始元数据块文本（含 `// ==UserScript==` 和 `// ==/UserScript==` 行）；
 *   无元数据块时为空字符串。持久化到 [com.livingdashboard.data.entity.UserScriptEntity.rawMetadata]。
 * @param metadata 解析后的结构化元数据
 * @param code 代码正文（已剥离元数据块，trim 前后空行）；无元数据块时为原文 trim。
 *   持久化到 [com.livingdashboard.data.entity.UserScriptEntity.code]。
 */
data class ParsedScript(
    val rawMetadata: String,
    val metadata: ScriptMetadata,
    val code: String,
)
