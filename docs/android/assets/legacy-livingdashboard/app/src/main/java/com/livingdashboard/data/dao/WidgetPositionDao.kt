package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.livingdashboard.data.entity.WidgetPositionEntity
import kotlinx.coroutines.flow.Flow

/**
 * 组件位置 DAO（Spec 6.3 / Room M2）。
 *
 * 用 UPSERT 语义（INSERT OR REPLACE）实现"无则插入，有则更新"。
 */
@Dao
interface WidgetPositionDao {

    /** 观察指定面板下所有位置（按 z_index ASC，再按 widget_id ASC） */
    @Query("SELECT * FROM widget_positions WHERE panel_id = :panelId ORDER BY z_index ASC, widget_id ASC")
    fun observeByPanel(panelId: String): Flow<List<WidgetPositionEntity>>

    /** 取单个位置（同步，用于 moveWidget 时取当前 x/y） */
    @Query("SELECT * FROM widget_positions WHERE panel_id = :panelId AND widget_id = :widgetId LIMIT 1")
    suspend fun get(panelId: String, widgetId: String): WidgetPositionEntity?

    /** UPSERT 位置（无则插入，有则替换） */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(position: WidgetPositionEntity)

    /** 更新位置 x/y（moveWidget 时调） */
    @Query("UPDATE widget_positions SET x = :x, y = :y WHERE panel_id = :panelId AND widget_id = :widgetId")
    suspend fun updatePosition(panelId: String, widgetId: String, x: Float, y: Float)

    /** 删除指定面板下所有位置（面板删除时调） */
    @Query("DELETE FROM widget_positions WHERE panel_id = :panelId")
    suspend fun deleteByPanel(panelId: String)

    /** 删除指定组件的位置（widgetId 在所有面板上的位置都删除） */
    @Query("DELETE FROM widget_positions WHERE widget_id = :widgetId")
    suspend fun deleteByWidget(widgetId: String)

    /** 删除指定面板下指定组件的位置（取消收藏时调） */
    @Query("DELETE FROM widget_positions WHERE panel_id = :panelId AND widget_id = :widgetId")
    suspend fun deleteByPanelAndWidget(panelId: String, widgetId: String)

    /** 统计指定面板下的位置数量（toggleFavorite 自动布局用） */
    @Query("SELECT COUNT(*) FROM widget_positions WHERE panel_id = :panelId")
    suspend fun countByPanel(panelId: String): Int
}
