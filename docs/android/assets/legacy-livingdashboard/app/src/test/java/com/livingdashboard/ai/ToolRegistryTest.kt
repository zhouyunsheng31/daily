package com.livingdashboard.ai

import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 6 用例（Spec 8.1 节）：
 * - register/get/listDefinitions/execute：4 用例
 * - tool.execute 抛异常 → ToolResult.error：1 用例
 * - listDefinitions 顺序：1 用例
 *
 * 纯 JVM 测试，不需要 Robolectric。用 MockK mock Tool。
 */
class ToolRegistryTest {

    private fun makeTool(name: String, description: String = ""): Tool = object : Tool {
        override val definition = ToolDefinition(name = name, description = description, parameters = buildJsonObject {
            put("type", "object")
        })
        override suspend fun execute(args: JsonObject): ToolResult = ToolResult.success(buildJsonObject {
            put("echo", name)
        })
    }

    // ==================== register / get / listDefinitions / execute ====================

    @Test
    fun `register then get returns the tool`() {
        val registry = ToolRegistry()
        val tool = makeTool("list_widgets")
        registry.register(tool)
        val got = registry.get("list_widgets")
        assertNotNull(got)
        assertEquals("list_widgets", got!!.definition.name)
    }

    @Test
    fun `get unknown tool returns null`() {
        val registry = ToolRegistry()
        assertNull(registry.get("nonexistent"))
    }

    @Test
    fun `listDefinitions returns all registered definitions`() {
        val registry = ToolRegistry()
        registry.register(makeTool("list_widgets"))
        registry.register(makeTool("create_html_widget"))
        registry.register(makeTool("storage_read"))

        val defs = registry.listDefinitions()
        assertEquals(3, defs.size)
        val names = defs.map { it.name }.toSet()
        assertTrue("list_widgets" in names)
        assertTrue("create_html_widget" in names)
        assertTrue("storage_read" in names)
    }

    @Test
    fun `execute invokes registered tool and returns its result`() = runTest {
        val registry = ToolRegistry()
        registry.register(makeTool("storage_read"))
        val args = buildJsonObject { put("key", "foo") }

        val result = registry.execute("storage_read", args)

        assertTrue(result.success)
        assertEquals("storage_read", result.data!!["echo"]!!.jsonPrimitive.content)
    }

    // ==================== 异常转 ToolResult.error ====================

    @Test
    fun `execute returns ToolResult error when tool throws exception`() = runTest {
        val registry = ToolRegistry()
        val throwingTool = mockk<Tool>()
        val throwingDef = ToolDefinition(name = "boom", description = "", parameters = buildJsonObject {
            put("type", "object")
        })
        every { throwingTool.definition } returns throwingDef
        coEvery { throwingTool.execute(any()) } throws RuntimeException("boom-bang")

        registry.register(throwingTool)
        val result = registry.execute("boom", JsonObject(emptyMap()))

        assertFalse(result.success)
        assertEquals("boom-bang", result.error)
    }

    // ==================== listDefinitions 顺序 ====================

    @Test
    fun `listDefinitions returns definitions sorted by name`() {
        // ToolRegistry.listDefinitions 按 name 字典序排序，
        // 保证 LLM 看到的 tools 数组顺序稳定（与注册顺序无关）
        val registry = ToolRegistry()
        // 故意乱序注册
        registry.register(makeTool("delta"))
        registry.register(makeTool("alpha"))
        registry.register(makeTool("charlie"))
        registry.register(makeTool("bravo"))
        registry.register(makeTool("echo"))

        val defs = registry.listDefinitions()
        assertEquals(5, defs.size)
        // 按 name 字典序：alpha, bravo, charlie, delta, echo
        assertEquals(
            listOf("alpha", "bravo", "charlie", "delta", "echo"),
            defs.map { it.name },
        )
    }
}
