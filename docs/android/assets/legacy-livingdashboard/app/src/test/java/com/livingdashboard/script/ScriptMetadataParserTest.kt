package com.livingdashboard.script

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/**
 * Phase M4 T2 单元测试：ScriptMetadataParser（Spec 2.2 / v3.1）。
 *
 * 覆盖：
 * - parse 正常/无块/部分缺失/未识别字段/run-at 非法值
 * - rewriteMetadata 重写块/保留正文/新增块（v3 修复 M4：表单字段为 source of truth）
 *
 * 使用 JUnit 4 + Truth（build.gradle.kts 已引入 testImplementation）。
 */
class ScriptMetadataParserTest {

    // ===== parse =====

    @Test
    fun parse_正常脚本_返回完整元数据_含多行match_exclude_grant() {
        val source = """
            // ==UserScript==
            // @name Test Script
            // @namespace https://example.com/ns
            // @version 1.2.3
            // @description A test script
            // @author Tester
            // @match https://example.com/*
            // @match https://test.com/*
            // @include https://include.com/*
            // @exclude https://example.com/admin/*
            // @exclude https://example.com/login
            // @grant GM_setValue
            // @grant GM_getValue
            // @run-at document-start
            // ==/UserScript==
            console.log("hello");
        """.trimIndent()

        val parsed = ScriptMetadataParser.parse(source)

        assertThat(parsed.metadata.name).isEqualTo("Test Script")
        assertThat(parsed.metadata.namespace).isEqualTo("https://example.com/ns")
        assertThat(parsed.metadata.version).isEqualTo("1.2.3")
        assertThat(parsed.metadata.description).isEqualTo("A test script")
        assertThat(parsed.metadata.author).isEqualTo("Tester")
        assertThat(parsed.metadata.matches).containsExactly(
            "https://example.com/*",
            "https://test.com/*",
        ).inOrder()
        assertThat(parsed.metadata.includes).containsExactly("https://include.com/*")
        assertThat(parsed.metadata.excludes).containsExactly(
            "https://example.com/admin/*",
            "https://example.com/login",
        ).inOrder()
        assertThat(parsed.metadata.grants).containsExactly(
            "GM_setValue",
            "GM_getValue",
        ).inOrder()
        assertThat(parsed.metadata.runAt).isEqualTo("document-start")
        assertThat(parsed.code).isEqualTo("""console.log("hello");""")
        assertThat(parsed.rawMetadata).contains("// ==UserScript==")
        assertThat(parsed.rawMetadata).contains("// ==/UserScript==")
    }

    @Test
    fun parse_无UserScript块_返回默认metadata() {
        val source = """console.log("no metadata");"""

        val parsed = ScriptMetadataParser.parse(source)

        assertThat(parsed.rawMetadata).isEmpty()
        assertThat(parsed.metadata).isEqualTo(ScriptMetadata())
        assertThat(parsed.code).isEqualTo("""console.log("no metadata");""")
    }

    @Test
    fun parse_部分字段缺失_用默认值() {
        val source = """
            // ==UserScript==
            // @name Partial
            // @match https://example.com/*
            // ==/UserScript==
            code();
        """.trimIndent()

        val parsed = ScriptMetadataParser.parse(source)

        assertThat(parsed.metadata.name).isEqualTo("Partial")
        assertThat(parsed.metadata.namespace).isEmpty()
        assertThat(parsed.metadata.version).isEqualTo("1.0")
        assertThat(parsed.metadata.description).isEmpty()
        assertThat(parsed.metadata.author).isEmpty()
        assertThat(parsed.metadata.matches).containsExactly("https://example.com/*")
        assertThat(parsed.metadata.includes).isEmpty()
        assertThat(parsed.metadata.excludes).isEmpty()
        assertThat(parsed.metadata.grants).isEmpty()
        assertThat(parsed.metadata.runAt).isEqualTo("document-end")
        assertThat(parsed.code).isEqualTo("code();")
    }

    @Test
    fun parse_未识别字段_忽略() {
        val source = """
            // ==UserScript==
            // @name Test
            // @unknownfield somevalue
            // @customField another
            // @match https://example.com/*
            // ==/UserScript==
            body();
        """.trimIndent()

        val parsed = ScriptMetadataParser.parse(source)

        assertThat(parsed.metadata.name).isEqualTo("Test")
        assertThat(parsed.metadata.matches).containsExactly("https://example.com/*")
        // 未识别字段不影响其他字段解析
        assertThat(parsed.metadata.runAt).isEqualTo("document-end")
        assertThat(parsed.metadata.version).isEqualTo("1.0")
        assertThat(parsed.code).isEqualTo("body();")
    }

    @Test
    fun parse_runAt非法值_回退document_end() {
        val source = """
            // ==UserScript==
            // @name Test
            // @run-at invalid-value
            // ==/UserScript==
            body();
        """.trimIndent()

        val parsed = ScriptMetadataParser.parse(source)

        assertThat(parsed.metadata.runAt).isEqualTo("document-end")
    }

    // ===== rewriteMetadata =====

    @Test
    fun rewriteMetadata_用表单字段重写块_M4修复验证() {
        val original = """
            // ==UserScript==
            // @name Old Name
            // @version 0.1
            // @match https://old.com/*
            // ==/UserScript==
            console.log("old");
        """.trimIndent()

        val newMetadata = ScriptMetadata(
            name = "New Name",
            namespace = "https://new.com",
            version = "2.0",
            description = "Updated",
            author = "Author",
            matches = listOf("https://new.com/*"),
            includes = emptyList(),
            excludes = listOf("https://new.com/admin/*"),
            grants = listOf("GM_setValue"),
            runAt = "document-start",
        )

        val rewritten = ScriptMetadataParser.rewriteMetadata(original, newMetadata)

        // 重新解析验证元数据一致（表单字段为 source of truth，M4 修复核心）
        val reparsed = ScriptMetadataParser.parse(rewritten)
        assertThat(reparsed.metadata).isEqualTo(newMetadata)
        // 代码正文保留
        assertThat(reparsed.code).isEqualTo("""console.log("old");""")
        // rawMetadata 块包含新字段
        assertThat(reparsed.rawMetadata).contains("// @name New Name")
        assertThat(reparsed.rawMetadata).contains("// @namespace https://new.com")
        assertThat(reparsed.rawMetadata).contains("// @version 2.0")
        assertThat(reparsed.rawMetadata).contains("// @description Updated")
        assertThat(reparsed.rawMetadata).contains("// @author Author")
        assertThat(reparsed.rawMetadata).contains("// @match https://new.com/*")
        assertThat(reparsed.rawMetadata).contains("// @exclude https://new.com/admin/*")
        assertThat(reparsed.rawMetadata).contains("// @grant GM_setValue")
        assertThat(reparsed.rawMetadata).contains("// @run-at document-start")
        // 旧字段已替换
        assertThat(reparsed.rawMetadata).doesNotContain("Old Name")
        assertThat(reparsed.rawMetadata).doesNotContain("https://old.com/*")
    }

    @Test
    fun rewriteMetadata_保留代码正文不变() {
        val original = """
            // ==UserScript==
            // @name Old
            // ==/UserScript==
            function foo() {
                return 42;
            }
            foo();
        """.trimIndent()

        val newMetadata = ScriptMetadata(name = "New")
        val originalParsed = ScriptMetadataParser.parse(original)
        val expectedBody = originalParsed.code

        val rewritten = ScriptMetadataParser.rewriteMetadata(original, newMetadata)

        // 代码正文（含换行/缩进）原样保留
        val reparsed = ScriptMetadataParser.parse(rewritten)
        assertThat(reparsed.code).isEqualTo(expectedBody)
        // 新元数据生效
        assertThat(reparsed.metadata.name).isEqualTo("New")
        // 正文内容完整保留
        assertThat(rewritten).contains("function foo() {")
        assertThat(rewritten).contains("    return 42;")
        assertThat(rewritten).contains("foo();")
    }

    @Test
    fun rewriteMetadata_无原块时新增块() {
        val original = """console.log("no block");"""

        val newMetadata = ScriptMetadata(name = "New Script", version = "2.5")

        val rewritten = ScriptMetadataParser.rewriteMetadata(original, newMetadata)

        // 头部新增 ==UserScript== 块
        assertThat(rewritten).startsWith("// ==UserScript==\n")
        assertThat(rewritten).contains("// @name New Script\n")
        assertThat(rewritten).contains("// @version 2.5\n")
        assertThat(rewritten).contains("// ==/UserScript==\n")
        // 原代码作为正文保留
        val reparsed = ScriptMetadataParser.parse(rewritten)
        assertThat(reparsed.metadata.name).isEqualTo("New Script")
        assertThat(reparsed.metadata.version).isEqualTo("2.5")
        assertThat(reparsed.code).isEqualTo("""console.log("no block");""")
    }
}
