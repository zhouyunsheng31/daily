package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.livingdashboard.data.entity.TabEntity
import kotlinx.coroutines.flow.Flow

/**
 * 标签页 DAO（Spec 3.1.1 / Room M1）。
 */
@Dao
interface TabDao {

    /** 观察所有标签页（按 sort_order ASC，等价于按创建顺序） */
    @Query("SELECT * FROM tabs ORDER BY sort_order ASC")
    fun getAll(): Flow<List<TabEntity>>

    /** 按 id 观察单个标签页（标签页被 update 时 Flow 自动推送新值） */
    @Query("SELECT * FROM tabs WHERE id = :id LIMIT 1")
    fun getById(id: String): Flow<TabEntity?>

    /** 插入标签页 */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(tab: TabEntity)

    /** 更新标签页 */
    @Update
    suspend fun update(tab: TabEntity)

    /** 删除标签页 */
    @Delete
    suspend fun delete(tab: TabEntity)

    /** 清空所有标签页 */
    @Query("DELETE FROM tabs")
    suspend fun deleteAll()

    /** 更新标签页 URL（地址栏变化时调） */
    @Query("UPDATE tabs SET url = :url WHERE id = :id")
    suspend fun updateUrl(id: String, url: String)

    /** 更新标签页标题（页面加载完成时调） */
    @Query("UPDATE tabs SET title = :title WHERE id = :id")
    suspend fun updateTitle(id: String, title: String)
}
