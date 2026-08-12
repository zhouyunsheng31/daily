package com.livingdashboard.ai.tools

import com.google.common.truth.Truth.assertThat
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ParsedScript
import com.livingdashboard.script.ScriptMetadata
import com.livingdashboard.script.ScriptMetadataParser
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Test

/**
 * CreateUserScriptTool 单元测试（Phase M4 T5）。
 *
 * 用 MockK mock [UserScriptRepository]（普通类）+ [ScriptMetadataParser]（Kotlin object，
 * 用 mockk<ScriptMetadataParser>() 创建 mock 实例注入构造器）。
 *
 * companion object @BeforeClass 预热 MockK agent，避免首个 runTest 测试因 agent
 * 首次初始化（>10s）触发 UncompletedCoroutinesError。
 *
 * 覆盖：
 * - 正常创建 + repository.insert 调用 + 返回 id/name/version
 * - 表单字段覆盖代码元数据（description/matches/grants/runAt/enabled）
 * - 代码无 ==UserScript== 块时用表单字段构造（默认值回退）
 * - matches 数组字段正确传递
 * - definition.name == "create_userscript"
 * - definition.parameters 含 required=[name, code]
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CreateUserScriptToolTest {

    private lateinit var repository: UserScriptRepository
    private lateinit var parser: ScriptMetadataParser

    @Before
    fun setUp() {
        repository = mockk()
        parser = mockk()
    }

    @Test
    fun execute_正常创建_调用repository_insert_返回id和name() = runTest {
        val code = "console.log('hi');"
        val parsed = ParsedScript(
            rawMetadata = "",
            metadata = ScriptMetadata(),
            code = code,
        )
        every { parser.parse(code) } returns parsed
        val entitySlot = slot<UserScriptEntity>()
        coEvery { repository.insert(capture(entitySlot)) } just Runs

        val tool = CreateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("name", "TestScript")
            put("code", code)
        })

        assertThat(result.success).isTrue()
        // 返回 id / name / version
        assertThat(result.data!!["id"]!!.jsonPrimitive.content).isNotEmpty()
        assertThat(result.data!!["name"]!!.jsonPrimitive.content).isEqualTo("TestScript")
        assertThat(result.data!!["version"]!!.jsonPrimitive.content).isEqualTo("1.0")
        // repository.insert 被调用，关键字段正确
        val entity = entitySlot.captured
        assertThat(entity.id).isNotEmpty()
        assertThat(entity.name).isEqualTo("TestScript")
        assertThat(entity.code).isEqualTo(code)
        assertThat(entity.author).isEqualTo("AI")
        assertThat(entity.source).isEqualTo("ai")
        assertThat(entity.versionCode).isEqualTo(1)
        coVerify(exactly = 1) { repository.insert(any()) }
    }

    @Test
    fun execute_带表单字段_表单字段覆盖代码元数据() = runTest {
        val code = "// ==UserScript==\n// @name ParsedName\n// ==/UserScript==\nconsole.log('parsed');"
        val parsed = ParsedScript(
            rawMetadata = "// ==UserScript==\n// ==/UserScript==",
            metadata = ScriptMetadata(
                name = "ParsedName",
                description = "parsed-desc",
                matches = listOf("https://parsed.com/*"),
                grants = listOf("GM_setValue"),
                runAt = "document-start",
            ),
            code = "console.log('parsed');",
        )
        every { parser.parse(code) } returns parsed
        val entitySlot = slot<UserScriptEntity>()
        coEvery { repository.insert(capture(entitySlot)) } just Runs

        val tool = CreateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("name", "FormName")
            put("code", code)
            put("description", "form-desc")
            putJsonArray("matches") { add("https://form.com/*") }
            putJsonArray("grants") { add("GM_getValue") }
            put("runAt", "document-idle")
            put("enabled", false)
        })

        assertThat(result.success).isTrue()
        val entity = entitySlot.captured
        // 表单字段覆盖解析值
        assertThat(entity.name).isEqualTo("FormName")
        assertThat(entity.description).isEqualTo("form-desc")
        assertThat(entity.matches).containsExactly("https://form.com/*")
        assertThat(entity.grants).containsExactly("GM_getValue")
        assertThat(entity.runAt).isEqualTo("document-idle")
        assertThat(entity.enabled).isFalse()
        // 表单未覆盖的字段保留解析值
        assertThat(entity.version).isEqualTo("1.0")
        assertThat(entity.namespace).isEmpty()
    }

    @Test
    fun execute_代码无UserScript块_用表单字段构造() = runTest {
        val code = "console.log('plain');"
        // 无 ==UserScript== 块：parse 返回默认 metadata（全默认值）
        val parsed = ParsedScript(
            rawMetadata = "",
            metadata = ScriptMetadata(),
            code = code,
        )
        every { parser.parse(code) } returns parsed
        val entitySlot = slot<UserScriptEntity>()
        coEvery { repository.insert(capture(entitySlot)) } just Runs

        val tool = CreateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("name", "PlainScript")
            put("code", code)
            put("description", "plain-desc")
            putJsonArray("matches") { add("https://example.com/*") }
            put("runAt", "document-end")
        })

        assertThat(result.success).isTrue()
        val entity = entitySlot.captured
        // 表单字段被采用
        assertThat(entity.name).isEqualTo("PlainScript")
        assertThat(entity.description).isEqualTo("plain-desc")
        assertThat(entity.matches).containsExactly("https://example.com/*")
        assertThat(entity.runAt).isEqualTo("document-end")
        // 缺省字段使用默认值
        assertThat(entity.enabled).isTrue() // 默认 true
        assertThat(entity.author).isEqualTo("AI")
        assertThat(entity.source).isEqualTo("ai")
        assertThat(entity.rawMetadata).isEmpty()
        assertThat(entity.grants).isEmpty()
    }

    @Test
    fun execute_matches字段_正确传递() = runTest {
        val code = "console.log('m');"
        val parsed = ParsedScript(
            rawMetadata = "",
            metadata = ScriptMetadata(),
            code = code,
        )
        every { parser.parse(code) } returns parsed
        val entitySlot = slot<UserScriptEntity>()
        coEvery { repository.insert(capture(entitySlot)) } just Runs

        val tool = CreateUserScriptTool(repository, parser)

        val result = tool.execute(buildJsonObject {
            put("name", "MultiMatch")
            put("code", code)
            putJsonArray("matches") {
                add("https://a.com/*")
                add("https://b.com/*")
                add("*://c.com/*")
            }
        })

        assertThat(result.success).isTrue()
        assertThat(entitySlot.captured.matches)
            .containsExactly("https://a.com/*", "https://b.com/*", "*://c.com/*")
            .inOrder()
    }

    @Test
    fun definition_name为create_userscript() {
        val tool = CreateUserScriptTool(repository, parser)
        assertThat(tool.definition.name).isEqualTo("create_userscript")
    }

    @Test
    fun definition_schema含必填字段name和code() {
        val tool = CreateUserScriptTool(repository, parser)
        // required 数组含 name 和 code
        val required = tool.definition.parameters["required"]!!.jsonArray
        val requiredList = required.map { it.jsonPrimitive.content }
        assertThat(requiredList).containsExactly("name", "code")
        // properties 中含 name 和 code 字段定义
        val properties = tool.definition.parameters["properties"]!!.jsonObject
        assertThat(properties["name"]).isNotNull()
        assertThat(properties["code"]).isNotNull()
    }

    companion object {
        @BeforeClass
        @JvmStatic
        fun warmUpMockk() {
            // 预热 MockK agent：首次 mockk<T>() 会触发字节码插桩 agent 初始化（耗时数秒），
            // 若发生在 runTest 内会超过 10s 默认超时导致 UncompletedCoroutinesError。
            // 在 @BeforeClass 中触发（不受 runTest 超时约束），后续测试内 mockk 调用即可瞬时返回。
            mockk<UserScriptRepository>()
            mockk<ScriptMetadataParser>()
        }
    }
}
