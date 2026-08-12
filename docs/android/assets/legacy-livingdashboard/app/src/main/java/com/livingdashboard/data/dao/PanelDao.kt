package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.livingdashboard.data.entity.PanelEntity
import com.livingdashboard.data.entity.PanelType
import kotlinx.coroutines.flow.Flow

/**
 * 面板 DAO（Spec 6.7 / Room M2）。
 */
@Dao
interface PanelDao {

    /** 观察所有面板（按 sort_order ASC） */
    @Query("SELECT * FROM panels ORDER BY sort_order ASC")
    fun getAll(): Flow<List<PanelEntity>>

    /** 按 id 观察单个面板 */
    @Query("SELECT * FROM panels WHERE id = :id LIMIT 1")
    fun observeById(id: String): Flow<PanelEntity?>

    /** 观察聚合面板（type=AGGREGATE），不存在返回 null */
    @Query("SELECT * FROM panels WHERE type = :type LIMIT 1")
    fun observeByType(type: PanelType = PanelType.AGGREGATE): Flow<PanelEntity?>

    /** 查询聚合面板（type=AGGREGATE），不存在返回 null */
    @Query("SELECT * FROM panels WHERE type = :type LIMIT 1")
    suspend fun getByType(type: PanelType = PanelType.AGGREGATE): PanelEntity?

    /** 插入面板 */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(panel: PanelEntity)

    /** 删除面板 */
    @Delete
    suspend fun delete(panel: PanelEntity)

    /** 删除指定面板及其下所有 widgets（widget_positions 外键 CASCADE 自动清理） */
    @Query("DELETE FROM widgets WHERE panel_id = :panelId")
    suspend fun deleteWidgetsByPanel(panelId: String)
}
