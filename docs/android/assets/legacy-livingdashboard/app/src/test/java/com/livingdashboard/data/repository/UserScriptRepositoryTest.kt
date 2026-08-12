package com.livingdashboard.data.repository

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.livingdashboard.data.db.LivingDatabase
import com.livingdashboard.data.db.UserScriptDao
import com.livingdashboard.data.entity.UserScriptEntity
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * UserScriptRepository 单元测试（Spec 2.4 / Phase M4 T1 数据层，6 用例）。
 *
 * 用 Robolectric + 内存 Room 数据库 + 真实 UserScriptDao（Room 编译期生成实现）+ 真实
 * kotlinx.serialization.json.Json。不 mock DAO，端到端验证 Repository 的缓存层、
 * updatedAt/versionCode 自动维护、preload 启动预加载等业务逻辑。
 *
 * application = Application::class：覆盖 AndroidManifest 中声明的 LivingDashboardApp，
 * 阻止 Robolectric 实例化它（同 [com.livingdashboard.data.dao.AiConversationDaoTest]）。
 *
 * Json 实例配置与 [com.livingdashboard.di.AppModule.provideJson] 一致
 * （ignoreUnknownKeys = true, isLenient = true）。
 *
 * 用例：
 * 1. insert + getById → 返回相同 entity（缓存命中路径）
 * 2. update → 自动维护 updatedAt = now，versionCode +1（DB 持久化验证，非仅缓存）
 * 3. deleteById → 删除后 getById 返回 null（DB + 缓存双清）
 * 4. snapshot → 仅返回 enabled=true 的脚本
 * 5. preload → 加载所有脚本到缓存（DB → cache）
 * 6. snapshot 在 preload 前返回空列表，preload 后返回脚本
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class UserScriptRepositoryTest {

    private lateinit var db: LivingDatabase
    private lateinit var dao: UserScriptDao
    private lateinit var repo: UserScriptRepository

    @Before
    fun setup() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, LivingDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.userScriptDao()
        // 与 AppModule.provideJson 配置一致
        repo = UserScriptRepository(dao, Json {
            ignoreUnknownKeys = true
            isLenient = true
        })
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
    // 1. insert + getById → 返回相同 entity
    // =========================================================================

    @Test
    fun insert_andGetById_返回相同entity() = runTest {
        val e = entity()

        repo.insert(e)

        val found = repo.getById("script-1")
        assertThat(found).isNotNull()
        assertThat(found!!.id).isEqualTo("script-1")
        assertThat(found.name).isEqualTo("TestScript")
        assertThat(found.matches).containsExactly("https://example.com/*")
        assertThat(found.grants).containsExactly("GM_setValue")
        assertThat(found.enabled).isTrue()
        assertThat(found.versionCode).isEqualTo(1)
    }

    // =========================================================================
    // 2. update → 自动维护 updatedAt 和 versionCode 递增
    //    直接读 DAO 验证 DB 持久化了自动维护的字段（非仅缓存）。
    //    System.currentTimeMillis() 是真实墙钟时间（runTest 仅控制虚拟时间），
    //    远大于原始 updatedAt=1000L（1970-01-01），无需 sleep。
    // =========================================================================

    @Test
    fun update_自动维护updatedAt和versionCode递增() = runTest {
        val original = entity(versionCode = 5, updatedAt = 1000L)
        repo.insert(original)

        repo.update(original.copy(name = "Updated"))

        // 直接从 DAO 读取，验证 DB 持久化了自动维护的字段
        val found = dao.findById("script-1")
        assertThat(found).isNotNull()
        assertThat(found!!.name).isEqualTo("Updated")
        assertThat(found.versionCode).isEqualTo(6) // 5 + 1
        // updatedAt 自动维护为 now，远大于原始 1000L
        assertThat(found.updatedAt).isGreaterThan(1000L)
        assertThat(found.updatedAt).isGreaterThan(original.updatedAt)
        // 通过 repo.getById 验证缓存也同步了 updated entity
        val cached = repo.getById("script-1")
        assertThat(cached).isNotNull()
        assertThat(cached!!.versionCode).isEqualTo(6)
        assertThat(cached.updatedAt).isEqualTo(found.updatedAt)
    }

    // =========================================================================
    // 3. deleteById → 删除后 getById 返回 null（DB + 缓存双清）
    // =========================================================================

    @Test
    fun deleteById_删除后getById返回null() = runTest {
        repo.insert(entity(id = "s1"))
        repo.insert(entity(id = "s2"))

        assertThat(repo.getById("s1")).isNotNull()
        assertThat(repo.getById("s2")).isNotNull()

        repo.deleteById("s1")

        // s1 已删除（DB + 缓存），s2 不受影响
        assertThat(repo.getById("s1")).isNull()
        assertThat(repo.getById("s2")).isNotNull()
        // 验证 DB 层也清了
        assertThat(dao.findById("s1")).isNull()
    }

    // =========================================================================
    // 4. snapshot → 仅返回 enabled=true 的脚本
    // =========================================================================

    @Test
    fun snapshot_返回所有enabled脚本() = runTest {
        repo.insert(entity(id = "s1", enabled = true))
        repo.insert(entity(id = "s2", enabled = false))
        repo.insert(entity(id = "s3", enabled = true))

        val snap = repo.snapshot()

        assertThat(snap).hasSize(2)
        assertThat(snap.all { it.enabled }).isTrue()
        assertThat(snap.map { it.id }).containsExactly("s1", "s3")
    }

    // =========================================================================
    // 5. preload → 加载所有脚本到缓存
    //    通过 dao.insert 直接写入 DB（绕过 repo 缓存），验证 preload 能从 DB 拉取。
    // =========================================================================

    @Test
    fun preload_加载所有脚本到缓存() = runTest {
        // 直接通过 dao insert（绕过 repo 缓存）
        dao.insert(entity(id = "s1", enabled = true))
        dao.insert(entity(id = "s2", enabled = false))
        dao.insert(entity(id = "s3", enabled = true))

        // preload 前 snapshot 应该是空（cache 空）
        assertThat(repo.snapshot()).isEmpty()

        repo.preload()

        // preload 后 snapshot 返回 enabled 的（s1, s3），s2(disabled) 被过滤
        val snap = repo.snapshot()
        assertThat(snap).hasSize(2)
        assertThat(snap.map { it.id }).containsExactly("s1", "s3")
        // getById 也应命中缓存（包括 disabled 的 s2）
        assertThat(repo.getById("s2")?.enabled).isFalse()
        assertThat(repo.getById("s1")?.enabled).isTrue()
    }

    // =========================================================================
    // 6. snapshot 在 preload 前返回空列表，preload 后返回脚本
    // =========================================================================

    @Test
    fun snapshot_preload前返回空列表_preload后返回脚本() = runTest {
        // preload 前即使 DB 有数据，snapshot 也返回空（cache 未填充）
        assertThat(repo.snapshot()).isEmpty()

        dao.insert(entity(id = "s1", enabled = true))
        dao.insert(entity(id = "s2", enabled = true))

        // 仍然空（未 preload，cache 未填充）
        assertThat(repo.snapshot()).isEmpty()

        repo.preload()

        // preload 后 snapshot 返回脚本
        val snap = repo.snapshot()
        assertThat(snap).hasSize(2)
        assertThat(snap.map { it.id }).containsExactly("s1", "s2")
    }
}
