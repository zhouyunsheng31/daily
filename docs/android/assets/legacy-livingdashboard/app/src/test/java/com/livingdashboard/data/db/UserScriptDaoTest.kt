package com.livingdashboard.data.db

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.livingdashboard.data.entity.UserScriptEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * UserScriptDao 单元测试（Spec 2.6 / Phase M4 T1 数据层，6 用例）。
 *
 * 用 Robolectric + 内存 Room 数据库（Room.inMemoryDatabaseBuilder）+ 真实 SQLite。
 * 内存数据库测试完即销毁，不污染磁盘。
 *
 * application = Application::class：覆盖 AndroidManifest 中声明的 LivingDashboardApp，
 * 阻止 Robolectric 实例化它（LivingDashboardApp.onCreate 会启动数据库协程，在
 * Robolectric 沙箱下因线程局部连接指针不匹配而崩溃）。本测试自建内存数据库，无需
 * LivingDashboardApp/Hilt。
 *
 * LivingDatabase 已注册 [Converters]（@TypeConverters），List<String> 字段
 * （matches/includes/excludes/grants）会通过 Converters.stringListToString 自动转换。
 *
 * 用例：
 * 1. insert + findById → 返回相同 entity（含 List<String> 字段往返一致性）
 * 2. update → 数据库反映字段变更
 * 3. deleteById → 删除后 findById 返回 null
 * 4. observeAll → 返回 Flow 列表（按 updated_at DESC 排序）
 * 5. observeEnabled → 只返回 enabled=true 的脚本
 * 6. getAllOnce → 一次性返回所有脚本
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class UserScriptDaoTest {

    private lateinit var db: LivingDatabase
    private lateinit var dao: UserScriptDao

    @Before
    fun setup() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, LivingDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.userScriptDao()
    }

    @After
    fun teardown() {
        db.close()
    }

    private fun entity(
        id: String = "script-1",
        name: String = "TestScript",
        enabled: Boolean = true,
        updatedAt: Long = 1000L,
        versionCode: Int = 1,
    ): UserScriptEntity = UserScriptEntity(
        id = id,
        name = name,
        namespace = "test-ns",
        version = "1.0",
        description = "desc",
        author = "tester",
        matches = listOf("https://example.com/*"),
        includes = emptyList(),
        excludes = emptyList(),
        grants = listOf("GM_setValue"),
        runAt = "document-end",
        code = "console.log('hi');",
        rawMetadata = "",
        enabled = enabled,
        source = "manual",
        createdAt = 500L,
        updatedAt = updatedAt,
        versionCode = versionCode,
    )

    // =========================================================================
    // 1. insert + findById → 返回相同 entity
    // =========================================================================

    @Test
    fun insert_andFindById_返回相同entity() = runTest {
        val e = entity()
        dao.insert(e)

        val found = dao.findById("script-1")

        assertThat(found).isNotNull()
        assertThat(found!!.id).isEqualTo("script-1")
        assertThat(found.name).isEqualTo("TestScript")
        assertThat(found.namespace).isEqualTo("test-ns")
        assertThat(found.version).isEqualTo("1.0")
        assertThat(found.description).isEqualTo("desc")
        assertThat(found.author).isEqualTo("tester")
        // List<String> 字段经 Converters 往返一致
        assertThat(found.matches).containsExactly("https://example.com/*")
        assertThat(found.includes).isEmpty()
        assertThat(found.excludes).isEmpty()
        assertThat(found.grants).containsExactly("GM_setValue")
        assertThat(found.runAt).isEqualTo("document-end")
        assertThat(found.code).isEqualTo("console.log('hi');")
        assertThat(found.rawMetadata).isEmpty()
        assertThat(found.enabled).isTrue()
        assertThat(found.source).isEqualTo("manual")
        assertThat(found.createdAt).isEqualTo(500L)
        assertThat(found.updatedAt).isEqualTo(1000L)
        assertThat(found.versionCode).isEqualTo(1)
    }

    // =========================================================================
    // 2. update → 数据库反映字段变更
    // =========================================================================

    @Test
    fun update_更新字段_数据库反映变更() = runTest {
        val original = entity()
        dao.insert(original)

        val updated = original.copy(
            name = "UpdatedName",
            enabled = false,
            code = "// new code",
            grants = listOf("GM_setValue", "GM_getValue"),
            updatedAt = 2000L,
            versionCode = 2,
        )
        dao.update(updated)

        val found = dao.findById("script-1")
        assertThat(found).isNotNull()
        assertThat(found!!.id).isEqualTo("script-1") // id 不变（@Update 按 PrimaryKey 匹配）
        assertThat(found.name).isEqualTo("UpdatedName")
        assertThat(found.enabled).isFalse()
        assertThat(found.code).isEqualTo("// new code")
        assertThat(found.grants).containsExactly("GM_setValue", "GM_getValue").inOrder()
        assertThat(found.updatedAt).isEqualTo(2000L)
        assertThat(found.versionCode).isEqualTo(2)
        // 未改字段保留
        assertThat(found.author).isEqualTo("tester")
        assertThat(found.source).isEqualTo("manual")
    }

    // =========================================================================
    // 3. deleteById → 删除后 findById 返回 null
    // =========================================================================

    @Test
    fun deleteById_删除后findById返回null() = runTest {
        dao.insert(entity(id = "s1"))
        dao.insert(entity(id = "s2"))

        // 删除前都能查到
        assertThat(dao.findById("s1")).isNotNull()
        assertThat(dao.findById("s2")).isNotNull()

        dao.deleteById("s1")

        // s1 已删除，s2 不受影响
        assertThat(dao.findById("s1")).isNull()
        assertThat(dao.findById("s2")).isNotNull()
    }

    // =========================================================================
    // 4. observeAll → 返回 Flow 列表（按 updated_at DESC 排序）
    // =========================================================================

    @Test
    fun observeAll_返回Flow列表() = runTest {
        dao.insert(entity(id = "s1", updatedAt = 1000))
        dao.insert(entity(id = "s2", updatedAt = 2000))
        dao.insert(entity(id = "s3", updatedAt = 500))

        val list = dao.observeAll().first()

        assertThat(list).hasSize(3)
        // ORDER BY updated_at DESC：s2(2000) → s1(1000) → s3(500)
        assertThat(list[0].id).isEqualTo("s2")
        assertThat(list[1].id).isEqualTo("s1")
        assertThat(list[2].id).isEqualTo("s3")
    }

    // =========================================================================
    // 5. observeEnabled → 只返回 enabled=true 的脚本
    // =========================================================================

    @Test
    fun observeEnabled_只返回enabled_true的脚本() = runTest {
        dao.insert(entity(id = "s1", enabled = true, updatedAt = 1000))
        dao.insert(entity(id = "s2", enabled = false, updatedAt = 2000))
        dao.insert(entity(id = "s3", enabled = true, updatedAt = 3000))

        val list = dao.observeEnabled().first()

        assertThat(list).hasSize(2)
        assertThat(list.all { it.enabled }).isTrue()
        // ORDER BY updated_at DESC：s3(3000) → s1(1000)，s2(disabled) 被过滤
        assertThat(list[0].id).isEqualTo("s3")
        assertThat(list[1].id).isEqualTo("s1")
    }

    // =========================================================================
    // 6. getAllOnce → 返回所有脚本
    // =========================================================================

    @Test
    fun getAllOnce_返回所有脚本() = runTest {
        dao.insert(entity(id = "s1"))
        dao.insert(entity(id = "s2"))
        dao.insert(entity(id = "s3"))

        val all = dao.getAllOnce()

        assertThat(all).hasSize(3)
        assertThat(all.map { it.id }).containsExactly("s1", "s2", "s3")
        // getAllOnce 无 ORDER BY，验证能拿到全部即可
    }
}
