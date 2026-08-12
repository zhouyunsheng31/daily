package com.livingdashboard.ai.tools

import com.google.common.truth.Truth.assertThat
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ScriptMetadataParser
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test

/**
 * UpdateUserScriptTool / ListUserScriptsTool / DeleteUserScriptTool 单元测试（Phase M4 T5）。
 *
 * 用 MockK mock [UserScriptRepository]（普通类）+ [ScriptMetadataParser]（Kotlin object，
 * 用 mockk<ScriptMetadataParser>() 创建 mock 实例注入构造器；仅 UpdateUserScriptTool 用到 parser）。
 *
 * companion object @BeforeClass 预热 MockK agent（详见 CreateUserScriptToolTest 注释）。
 *
 * 覆盖：
 * - updateTool 正常更新 / 不存在 id / rewriteMetadata 重写块
 * - listTool 返回所有 enabled 脚本 / 空列表
 * - deleteTool 正常删除 / 不存在 id
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UserscriptToolsTest {

    private lateinit var repository: UserScriptRepository
    private lateinit var parser: ScriptMetadataParser

    @Before
    fun setUp() {
        repository = mockk()
        parser = mockk()
    }

    /** 构造一个完整的测试用 [UserScriptEntity]。 */
    private fun existingEntity(
        id: String = "script-1",
        name: String = "Old",
        code: String = "console.log('old');",
    ) = UserScriptEntity(
        id = id,
        name = name,
        namespace = "ns",
        version = "1.0",
        description = "old-desc",
        author = "AI",
        matches = listOf("https://old.com/*"),
        includes = emptyList(),
        excludes = emptyList(),
        grants = listOf("GM_setValue"),
        runAt = "document-end",
        code = code,
        rawMetadata = "",
        enabled = true,
        source = "ai",
        createdAt = 1000L,
        updatedAt = 2000L,
        versionCode = 1,
    )

    // ===== UpdateUserScriptTool =====

    @Test
    fun updateTool_正常更新_调用repository_update() = runTest {
        val entity = existingEntity()
        coEvery { repository.getById("script-1") } returns entity
        every { parser.rewriteMetadata(any(), any()) } returns "rewritten-code"
        val updatedSlot = slot<UserScriptEntity>()
        coEvery { repository.update(capture(updatedSlot)) } just Runs

        val tool = UpdateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("id", "script-1")
            put("name", "NewName")
            put("code", "console.log('new');")
        })

        assertThat(result.success).isTrue()
        assertThat(result.data!!["id"]!!.jsonPrimitive.content).isEqualTo("script-1")
        assertThat(result.data!!["updated"]!!.jsonPrimitive.boolean).isTrue()
        // repository.update 被调用且 name/code 已更新
        val updated = updatedSlot.captured
        assertThat(updated.name).isEqualTo("NewName")
        assertThat(updated.code).isEqualTo("rewritten-code")
        coVerify(exactly = 1) { repository.update(any()) }
    }

    @Test
    fun updateTool_不存在id_返回ToolResult_error() = runTest {
        coEvery { repository.getById("nonexistent") } returns null

        val tool = UpdateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("id", "nonexistent")
            put("name", "Whatever")
        })

        assertThat(result.success).isFalse()
        assertThat(result.error).isEqualTo("not found")
        coVerify(exactly = 0) { repository.update(any()) }
    }

    @Test
    fun updateTool_用parser_rewriteMetadata重写块() = runTest {
        val entity = existingEntity()
        coEvery { repository.getById("script-1") } returns entity
        every { parser.rewriteMetadata(any(), any()) } returns "rewritten-code"
        val updatedSlot = slot<UserScriptEntity>()
        coEvery { repository.update(capture(updatedSlot)) } just Runs

        val tool = UpdateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("id", "script-1")
            put("name", "NewName")
            put("code", "console.log('new');")
            put("description", "new-desc")
        })

        assertThat(result.success).isTrue()
        // rewriteMetadata 被调用
        verify(exactly = 1) { parser.rewriteMetadata(any(), any()) }
        // 保存的 code 是 rewriteMetadata 的返回值
        assertThat(updatedSlot.captured.code).isEqualTo("rewritten-code")
        // 其他字段也正确更新
        assertThat(updatedSlot.captured.name).isEqualTo("NewName")
        assertThat(updatedSlot.captured.description).isEqualTo("new-desc")
    }

    // ===== ListUserScriptsTool =====

    @Test
    fun listTool_返回所有enabled脚本() = runTest {
        val script1 = existingEntity(id = "s1", name = "Script1")
        val script2 = existingEntity(id = "s2", name = "Script2").copy(
            matches = listOf("https://other.com/*"),
        )
        every { repository.snapshot() } returns listOf(script1, script2)

        val tool = ListUserScriptsTool(repository)

        val result = tool.execute(buildJsonObject {})

        assertThat(result.success).isTrue()
        val scripts = result.data!!["scripts"]!!.jsonArray
        assertThat(scripts).hasSize(2)
        // 第一个脚本字段正确
        val first = scripts[0].jsonObject
        assertThat(first["id"]!!.jsonPrimitive.content).isEqualTo("s1")
        assertThat(first["name"]!!.jsonPrimitive.content).isEqualTo("Script1")
        assertThat(first["enabled"]!!.jsonPrimitive.boolean).isTrue()
        assertThat(first["matches"]!!.jsonArray).hasSize(1)
        assertThat(first["matches"]!!.jsonArray[0].jsonPrimitive.content)
            .isEqualTo("https://old.com/*")
    }

    @Test
    fun listTool_repository为空_返回空列表() = runTest {
        every { repository.snapshot() } returns emptyList()

        val tool = ListUserScriptsTool(repository)

        val result = tool.execute(buildJsonObject {})

        assertThat(result.success).isTrue()
        val scripts = result.data!!["scripts"]!!.jsonArray
        assertThat(scripts).isEmpty()
    }

    // ===== DeleteUserScriptTool =====

    @Test
    fun deleteTool_正常删除_调用repository_deleteById() = runTest {
        coEvery { repository.getById("script-1") } returns existingEntity()
        coEvery { repository.deleteById("script-1") } just Runs

        val tool = DeleteUserScriptTool(repository)

        val result = tool.execute(buildJsonObject { put("id", "script-1") })

        assertThat(result.success).isTrue()
        assertThat(result.data!!["id"]!!.jsonPrimitive.content).isEqualTo("script-1")
        assertThat(result.data!!["deleted"]!!.jsonPrimitive.boolean).isTrue()
        coVerify(exactly = 1) { repository.deleteById("script-1") }
    }

    @Test
    fun deleteTool_不存在id_返回ToolResult_error() = runTest {
        coEvery { repository.getById("nonexistent") } returns null

        val tool = DeleteUserScriptTool(repository)

        val result = tool.execute(buildJsonObject { put("id", "nonexistent") })

        assertThat(result.success).isFalse()
        assertThat(result.error).isEqualTo("not found")
        coVerify(exactly = 0) { repository.deleteById(any()) }
    }

    companion object {
        @BeforeClass
        @JvmStatic
        fun warmUpMockk() {
            // 预热 MockK agent：首次 mockk<T>() 触发字节码插桩初始化（耗时数秒），
            // 若发生在 runTest 内会超过 10s 默认超时。在 @BeforeClass 触发可避开超时。
            mockk<UserScriptRepository>()
            mockk<ScriptMetadataParser>()
        }
    }
}
