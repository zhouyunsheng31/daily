package com.livingdashboard.data.dao

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.livingdashboard.data.db.LivingDatabase
import com.livingdashboard.data.entity.AiConversationEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * AiConversationDao 单元测试（Spec 8.1 节，6 用例）。
 *
 * 用 Robolectric + 内存 Room 数据库（Room.inMemoryDatabaseBuilder）。
 * 内存数据库测试完即销毁，不污染磁盘。
 *
 * application = Application::class：覆盖 AndroidManifest 中声明的 LivingDashboardApp，
 * 阻止 Robolectric 实例化它。LivingDashboardApp.onCreate 会启动数据库协程
 * （CanvasRepository.createAggregatePanel），在 Robolectric 的 ShadowLegacySQLiteConnection
 * 下因线程局部连接指针不匹配而崩溃（Illegal connection pointer），导致
 * UncaughtExceptionsBeforeTest。本测试自建内存数据库，无需 LivingDashboardApp/Hilt。
 *
 * 注意：真实 DAO 没有 countByPanel 方法（Spec 8.1 描述的 countByPanel 与实际 API 不符），
 * 故用 getRecent(panelId, largeLimit).size 验证条数。
 *
 * 用例：
 * 1. insert 一条 → getRecent().size == 1
 * 2. insert 三条不同 panelId → observeByPanel("p1") 只收到 p1 的
 * 3. getRecent("p1", 10) 返回按 createdAt DESC 排序
 * 4. deleteByPanel("p1") → p1 清空，其他 panel 不受影响
 * 5. getRecent("p1", 3) 尊重 limit 参数（取最近 3 条）
 * 6. insert 返回自增主键 id，且后续 id 递增
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AiConversationDaoTest {

    private lateinit var db: LivingDatabase
    private lateinit var dao: AiConversationDao

    @Before
    fun setup() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, LivingDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.aiConversationDao()
    }

    @After
    fun teardown() {
        db.close()
    }

    private fun entity(
        panelId: String,
        role: String = "user",
        content: String = "msg",
        createdAt: Long = System.currentTimeMillis(),
    ): AiConversationEntity = AiConversationEntity(
        panelId = panelId,
        role = role,
        content = content,
        createdAt = createdAt,
    )

    // =========================================================================
    // 1. insert 一条 → getRecent().size == 1
    // =========================================================================

    @Test
    fun `insert one entity makes count one`() = runTest {
        dao.insert(entity("p1", content = "hello"))

        val all = dao.getRecent("p1", 100)
        assertEquals(1, all.size)
        assertEquals("hello", all[0].content)
    }

    // =========================================================================
    // 2. insert 三条不同 panelId → observeByPanel("p1") 只收到 p1 的
    // =========================================================================

    @Test
    fun `observeByPanel only returns entries for specified panel`() = runTest {
        dao.insert(entity("p1", content = "m1", createdAt = 1000))
        dao.insert(entity("p2", content = "m2", createdAt = 2000))
        dao.insert(entity("p1", content = "m3", createdAt = 3000))

        val p1List = dao.observeByPanel("p1").first()

        assertEquals(2, p1List.size)
        assertTrue("all entries should be panel p1", p1List.all { it.panelId == "p1" })
        // observeByPanel 用 ASC 排序（按 created_at ASC，便于按时间顺序展示）
        assertEquals(1000L, p1List[0].createdAt)
        assertEquals(3000L, p1List[1].createdAt)
    }

    // =========================================================================
    // 3. getRecent("p1", 10) 返回按 createdAt DESC 排序
    // =========================================================================

    @Test
    fun `getRecent returns entries ordered by createdAt DESC`() = runTest {
        dao.insert(entity("p1", content = "old", createdAt = 1000))
        dao.insert(entity("p1", content = "newest", createdAt = 3000))
        dao.insert(entity("p1", content = "mid", createdAt = 2000))

        val recent = dao.getRecent("p1", 10)

        assertEquals(3, recent.size)
        // DESC 排序：newest(3000) → mid(2000) → old(1000)
        assertEquals("newest", recent[0].content)
        assertEquals(3000L, recent[0].createdAt)
        assertEquals("mid", recent[1].content)
        assertEquals(2000L, recent[1].createdAt)
        assertEquals("old", recent[2].content)
        assertEquals(1000L, recent[2].createdAt)
    }

    // =========================================================================
    // 4. deleteByPanel("p1") → p1 清空，其他 panel 不受影响
    // =========================================================================

    @Test
    fun `deleteByPanel removes only entries for specified panel`() = runTest {
        dao.insert(entity("p1", createdAt = 1000))
        dao.insert(entity("p2", createdAt = 2000))
        dao.insert(entity("p1", createdAt = 3000))

        dao.deleteByPanel("p1")

        assertEquals(0, dao.getRecent("p1", 100).size)
        assertEquals(1, dao.getRecent("p2", 100).size)
    }

    // =========================================================================
    // 5. getRecent("p1", 3) 尊重 limit 参数
    // =========================================================================

    @Test
    fun `getRecent respects limit parameter`() = runTest {
        for (i in 1..5) {
            dao.insert(entity("p1", content = "m$i", createdAt = i.toLong() * 1000))
        }

        val recent = dao.getRecent("p1", 3)

        assertEquals(3, recent.size)
        // DESC 排序，取最近 3 条：m5(5000), m4(4000), m3(3000)
        assertEquals("m5", recent[0].content)
        assertEquals("m4", recent[1].content)
        assertEquals("m3", recent[2].content)
    }

    // =========================================================================
    // 6. insert 返回自增主键 id，且后续 id 递增
    // =========================================================================

    @Test
    fun `insert returns auto-incremented id`() = runTest {
        val id1 = dao.insert(entity("p1", createdAt = 1000))
        val id2 = dao.insert(entity("p1", createdAt = 2000))

        assertTrue("id1 should be > 0, got $id1", id1 > 0)
        assertTrue("id2 should be > 0, got $id2", id2 > 0)
        assertTrue("id2 ($id2) should be greater than id1 ($id1)", id2 > id1)
    }
}
