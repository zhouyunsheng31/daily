package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.livingdashboard.data.entity.HistoryEntity
import kotlinx.coroutines.flow.Flow

/**
 * 浏览历史 DAO（Spec 3.1.6 / Room M1）。
 */
@Dao
interface HistoryDao {

    /** 观察所有历史记录（按 visited_at DESC） */
    @Query("SELECT * FROM history ORDER BY visited_at DESC")
    fun getAll(): Flow<List<HistoryEntity>>

    /** 搜索历史（按 URL / title 模糊匹配，按 visited_at DESC） */
    @Query("""
        SELECT * FROM history
        WHERE url LIKE '%' || :query || '%' OR title LIKE '%' || :query || '%'
        ORDER BY visited_at DESC
    """)
    fun search(query: String): Flow<List<HistoryEntity>>

    /** 按 URL 查历史记录（去重判断用），不存在返回 null */
    @Query("SELECT * FROM history WHERE url = :url LIMIT 1")
    suspend fun findByUrl(url: String): HistoryEntity?

    /** 插入一条历史记录，返回主键 id */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(history: HistoryEntity): Long

    /** 更新历史记录（recordVisit 去重时调） */
    @Update
    suspend fun update(history: HistoryEntity)

    /** 删除单条历史记录 */
    @Delete
    suspend fun delete(history: HistoryEntity)

    /** 清空所有历史记录 */
    @Query("DELETE FROM history")
    suspend fun deleteAll()
}
