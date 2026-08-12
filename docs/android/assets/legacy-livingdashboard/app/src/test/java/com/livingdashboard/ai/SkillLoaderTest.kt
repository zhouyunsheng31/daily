package com.livingdashboard.ai

import android.content.Context
import android.content.res.AssetManager
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

/**
 * 6 用例（Spec 8.1 节）：
 * - YAML frontmatter 解析：1 用例
 * - Markdown 正文：1 用例
 * - 格式错误跳过：1 用例
 * - assets 目录不存在：1 用例
 * - 空目录：1 用例
 * - SKILL.md 文件名缺失：1 用例
 *
 * 用 MockK mock Context + AssetManager（不依赖 Robolectric，纯 JVM 测试更快）。
 */
class SkillLoaderTest {

    private fun makeLoader(
        topList: Array<String>? = null,
        filesByDir: Map<String, Array<String>> = emptyMap(),
        contentByPath: Map<String, String> = emptyMap(),
    ): SkillLoader {
        val context = mockk<Context>()
        val assets = mockk<AssetManager>()
        every { context.assets } returns assets
        if (topList != null) {
            every { assets.list("pi/skills") } returns topList
        } else {
            every { assets.list("pi/skills") } returns null
        }
        for ((dir, files) in filesByDir) {
            every { assets.list("pi/skills/$dir") } returns files
        }
        for ((path, content) in contentByPath) {
            every { assets.open(path) } returns ByteArrayInputStream(content.toByteArray(Charsets.UTF_8))
        }
        return SkillLoader(context)
    }

    private val validSkillMd = """
        ---
        name: product-guide
        description: Guide users about the product.
        version: 1.2
        ---
        # Product Guide

        Use this skill when users ask about product features.
    """.trimIndent() + "\n"

    // ==================== 正例 ====================

    @Test
    fun `parses YAML frontmatter into name description version`() {
        val loader = makeLoader(
            topList = arrayOf("product-guide"),
            filesByDir = mapOf("product-guide" to arrayOf("SKILL.md")),
            contentByPath = mapOf("pi/skills/product-guide/SKILL.md" to validSkillMd),
        )
        val skills = loader.loadAll()
        assertEquals(1, skills.size)
        val skill = skills[0]
        assertEquals("product-guide", skill.name)
        assertEquals("Guide users about the product.", skill.description)
        assertEquals("1.2", skill.version)
    }

    @Test
    fun `extracts Markdown body after frontmatter`() {
        val md = """
            ---
            name: md-test
            description: body test
            version: 0.1
            ---
            # Title

            - bullet 1
            - bullet 2

            ```kotlin
            val x = 1
            ```
        """.trimIndent() + "\n"
        val loader = makeLoader(
            topList = arrayOf("md-test"),
            filesByDir = mapOf("md-test" to arrayOf("SKILL.md")),
            contentByPath = mapOf("pi/skills/md-test/SKILL.md" to md),
        )
        val skills = loader.loadAll()
        assertEquals(1, skills.size)
        val body = skills[0].content
        assertTrue("body should contain # Title", body.contains("# Title"))
        assertTrue("body should contain bullet 1", body.contains("- bullet 1"))
        assertTrue("body should contain code fence", body.contains("```kotlin"))
        // body 不应包含 frontmatter 的 key
        assertTrue("body should not contain 'name: md-test'", !body.contains("name: md-test"))
    }

    // ==================== 格式错误跳过 ====================

    @Test
    fun `skips skill whose SKILL_md lacks frontmatter`() {
        val plain = "Just plain Markdown content without frontmatter.\n"
        val loader = makeLoader(
            topList = arrayOf("no-frontmatter"),
            filesByDir = mapOf("no-frontmatter" to arrayOf("SKILL.md")),
            contentByPath = mapOf("pi/skills/no-frontmatter/SKILL.md" to plain),
        )
        val skills = loader.loadAll()
        // 无 frontmatter → parseSkill 返回 null → 跳过
        assertEquals(0, skills.size)
    }

    // ==================== assets 目录异常场景 ====================

    @Test
    fun `returns empty list when assets pi_skills returns null`() {
        val loader = makeLoader(topList = null)
        val skills = loader.loadAll()
        assertTrue(skills.isEmpty())
    }

    @Test
    fun `returns empty list when pi_skills has no subdirectories`() {
        val loader = makeLoader(topList = emptyArray())
        val skills = loader.loadAll()
        assertTrue(skills.isEmpty())
    }

    @Test
    fun `skips directory when SKILL_md file is missing`() {
        // 两个目录：一个有 SKILL.md，一个没有
        val loader = makeLoader(
            topList = arrayOf("with-skill", "without-skill"),
            filesByDir = mapOf(
                "with-skill" to arrayOf("SKILL.md"),
                "without-skill" to arrayOf("README.md"),
            ),
            contentByPath = mapOf("pi/skills/with-skill/SKILL.md" to validSkillMd),
        )
        val skills = loader.loadAll()
        assertEquals(1, skills.size)
        assertEquals("product-guide", skills[0].name)
    }
}
