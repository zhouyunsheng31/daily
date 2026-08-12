package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.livingdashboard.data.entity.FavoriteEntity
import kotlinx.coroutines.flow.Flow

/**
 * 收藏组件 DAO（Spec 6.5 / Room M2）。
 */
@Dao
interface FavoriteDao {

    /** 观察所有收藏（按 widget_id ASC） */
    @Query("SELECT * FROM favorites ORDER BY widget_id ASC")
    fun observeAll(): Flow<List<FavoriteEntity>>

    /** 按 widgetId 查收藏（isFavorite 判断用），不存在返回 null */
    @Query("SELECT * FROM favorites WHERE widget_id = :widgetId LIMIT 1")
    suspend fun get(widgetId: String): FavoriteEntity?

    /** 插入收藏（toggleFavorite 时调） */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(favorite: FavoriteEntity)

    /** 按 widgetId 删除收藏（toggleFavorite 时调） */
    @Query("DELETE FROM favorites WHERE widget_id = :widgetId")
    suspend fun delete(widgetId: String)
}
