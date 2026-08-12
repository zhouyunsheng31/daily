package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.BookmarkDao
import com.livingdashboard.data.entity.BookmarkEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

/**
 * 书签 Repository（Spec 3.1.5）。
 *
 * 由 Hilt 注入 BookmarkDao（AppModule.provideBookmarkRepository 提供）。
 * Repository 用 @Inject constructor，DAO 由 DatabaseModule 提供。
 */
class BookmarkRepository @Inject constructor(
    private val bookmarkDao: BookmarkDao
) {
    /** 所有书签（按 sortOrder ASC） */
    fun getAll(): Flow<List<BookmarkEntity>> = bookmarkDao.getAll()

    /** 主页快捷图标（showOnHome=true） */
    fun getHomeShortcuts(): Flow<List<BookmarkEntity>> = bookmarkDao.getHomeShortcuts()

    /** 按 URL 查书签（判断是否已收藏） */
    suspend fun findByUrl(url: String): BookmarkEntity? = bookmarkDao.findByUrl(url)

    /** 添加书签，返回新插入的 id */
    suspend fun insert(bookmark: BookmarkEntity): Long = bookmarkDao.insert(bookmark)

    /** 更新书签（编辑标题、URL、showOnHome 等） */
    suspend fun update(bookmark: BookmarkEntity) = bookmarkDao.update(bookmark)

    /** 删除书签 */
    suspend fun delete(bookmark: BookmarkEntity) = bookmarkDao.delete(bookmark)

    /**
     * 切换主页显示状态（便捷方法）。
     * @return 切换后的 showOnHome 值（供 UI 立即更新）
     */
    suspend fun toggleShowOnHome(bookmark: BookmarkEntity): Boolean {
        val updated = bookmark.copy(showOnHome = !bookmark.showOnHome)
        bookmarkDao.update(updated)
        return updated.showOnHome
    }
}
