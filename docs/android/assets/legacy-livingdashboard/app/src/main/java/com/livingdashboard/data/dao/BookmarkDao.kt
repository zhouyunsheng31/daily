package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.livingdashboard.data.entity.BookmarkEntity
import kotlinx.coroutines.flow.Flow

/**
 * 书签 DAO（Spec 3.1.5 / Room M1）。
 *
 * 所有方法默认 suspend（Room 自动调度到 IO Dispatcher），返回值用 Flow 支持 Compose 订阅。
 */
@Dao
interface BookmarkDao {

    /** 观察所有书签（按 id ASC，等价于按添加顺序） */
    @Query("SELECT * FROM bookmarks ORDER BY id ASC")
    fun getAll(): Flow<List<BookmarkEntity>>

    /** 观察主页快捷书签（showOnHome=true，按 id ASC） */
    @Query("SELECT * FROM bookmarks WHERE show_on_home = 1 ORDER BY id ASC")
    fun getHomeShortcuts(): Flow<List<BookmarkEntity>>

    /** 按 URL 查书签（去重判断用），不存在返回 null */
    @Query("SELECT * FROM bookmarks WHERE url = :url LIMIT 1")
    suspend fun findByUrl(url: String): BookmarkEntity?

    /** 插入书签（冲突时替换，主键 autoGenerate 用 0） */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(bookmark: BookmarkEntity): Long

    /** 更新书签 */
    @Update
    suspend fun update(bookmark: BookmarkEntity)

    /** 删除书签 */
    @Delete
    suspend fun delete(bookmark: BookmarkEntity)

    /** 切换主页显示状态 */
    @Query("UPDATE bookmarks SET show_on_home = :showOnHome WHERE id = :id")
    suspend fun updateShowOnHome(id: Long, showOnHome: Boolean)
}
