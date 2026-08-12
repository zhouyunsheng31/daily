package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.TabDao
import com.livingdashboard.data.entity.TabEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID
import javax.inject.Inject

/**
 * 标签页 Repository（Spec 3.1.5，NC6 完整实现）。
 *
 * 由 Hilt 注入 TabDao（AppModule.provideTabRepository 提供）。
 *
 * M1 标签页状态策略：
 * - M1 只存 URL + title，不存 webViewState
 * - 切换标签时：保存当前标签的 URL + title 到 Room
 * - 切回标签时：从 Room 读 URL，重新加载页面
 */
class TabRepository @Inject constructor(
    private val tabDao: TabDao
) {
    /** 所有标签页（按 sortOrder ASC，等价于按创建顺序） */
    fun getAll(): Flow<List<TabEntity>> = tabDao.getAll()

    /**
     * 按 ID 观察单个标签页（返回 Flow，支持 ViewModel 持续收集）。
     * TabDao.getById 返回 Flow<TabEntity?>，DAO 层用 @Query + Flow 返回类型。
     */
    fun getById(id: String): Flow<TabEntity?> = tabDao.getById(id)

    /** 插入新标签页 */
    suspend fun insert(tab: TabEntity) = tabDao.insert(tab)

    /** 更新标签页（全字段） */
    suspend fun update(tab: TabEntity) = tabDao.update(tab)

    /** 删除标签页 */
    suspend fun delete(tab: TabEntity) = tabDao.delete(tab)

    /** 删除所有标签页 */
    suspend fun deleteAll() = tabDao.deleteAll()

    /** 仅更新 URL（便捷方法，BrowserViewModel.onUrlChange 调用） */
    suspend fun updateUrl(tabId: String, url: String) {
        tabDao.updateUrl(tabId, url)
    }

    /** 仅更新标题（便捷方法，BrowserViewModel.onTitleChange 调用） */
    suspend fun updateTitle(tabId: String, title: String) {
        tabDao.updateTitle(tabId, title)
    }

    /**
     * 创建新标签页（便捷方法）。
     *
     * 时序（Spec M22）：先生成 UUID → 插入 Room → 返回 tabId。
     * 调用方拿到 tabId 后再导航到 browser/{tabId}，保证导航时 tabId 已存在。
     *
     * @param url 初始 URL（空=主页）
     * @param title 初始标题（默认"新标签页"）
     * @return 新标签页的 id（UUID 字符串）
     */
    suspend fun createTab(url: String = "", title: String = "新标签页"): String {
        val newTabId = UUID.randomUUID().toString()
        val tab = TabEntity(
            id = newTabId,
            title = title,
            url = url,
            sortOrder = System.currentTimeMillis().toInt()
        )
        tabDao.insert(tab)
        return newTabId
    }
}
