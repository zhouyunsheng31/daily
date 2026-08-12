package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.HistoryDao
import com.livingdashboard.data.entity.HistoryEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * 历史记录 Repository（Spec 3.1.5，NC6 完整实现）。
 *
 * 由 Hilt 注入 HistoryDao（AppModule.provideHistoryRepository 提供）。
 *
 * 去重逻辑（recordVisit）：
 * - 同 URL 合并（不限天），保留最新访问时间，更新 title
 * - 存在 → update（visitedAt = now，title 取最新）
 * - 不存在 → insert
 */
class HistoryRepository @Inject constructor(
    private val historyDao: HistoryDao
) {
    /** 所有历史记录（按 visitedAt DESC） */
    fun getAll(): Flow<List<HistoryEntity>> = historyDao.getAll()

    /**
     * 记录一次访问（去重逻辑：同 URL 合并，不限天）。
     * - 存在 → update（visitedAt = now，title 取最新）
     * - 不存在 → insert
     *
     * @param url 访问的 URL
     * @param title 页面标题
     */
    suspend fun recordVisit(url: String, title: String) {
        val existing = historyDao.findByUrl(url)
        if (existing != null) {
            historyDao.update(
                existing.copy(
                    title = title,
                    visitedAt = System.currentTimeMillis()
                )
            )
        } else {
            historyDao.insert(HistoryEntity(
                title = title,
                url = url,
                visitedAt = System.currentTimeMillis()
            ))
        }
    }

    suspend fun delete(entity: HistoryEntity) = historyDao.delete(entity)

    suspend fun deleteAll() = historyDao.deleteAll()

    /** 搜索历史（按 title/url 模糊匹配） */
    fun search(query: String): Flow<List<HistoryEntity>> = historyDao.search(query)
}
