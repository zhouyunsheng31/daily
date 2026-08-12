package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.livingdashboard.data.entity.WidgetEntity
import kotlinx.coroutines.flow.Flow

/**
 * 画布组件 DAO（Spec 6.3 / Room M2）。
 */
@Dao
interface WidgetDao {

    /** 观察指定面板下的组件（不含聚合面板 JOIN） */
    @Query("SELECT * FROM widgets WHERE panel_id = :panelId ORDER BY created_at ASC")
    fun observeByPanel(panelId: String): Flow<List<WidgetEntity>>

    /** 观察所有组件（聚合面板 combine 查询用） */
    @Query("SELECT * FROM widgets ORDER BY created_at ASC")
    fun observeAll(): Flow<List<WidgetEntity>>

    /** 按 id 观察单个组件 */
    @Query("SELECT * FROM widgets WHERE id = :id LIMIT 1")
    fun observeById(id: String): Flow<WidgetEntity?>

    /**
     * 观察所有收藏组件（聚合面板用）。
     *
     * JOIN favorites + widgets，返回所有收藏的组件。
     * 聚合面板不复制组件数据，而是通过此 JOIN 查询展示所有收藏。
     */
    @Query("""
        SELECT w.* FROM widgets w
        INNER JOIN favorites f ON w.id = f.widget_id
        ORDER BY w.created_at ASC
    """)
    fun observeAggregateWidgets(): Flow<List<WidgetEntity>>

    /** 按 id 取组件（同步，用于 updateHtmlWidget 等检查存在性） */
    @Query("SELECT * FROM widgets WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): WidgetEntity?

    /** 插入组件 */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(widget: WidgetEntity)

    /** 更新组件 */
    @Update
    suspend fun update(widget: WidgetEntity)

    /** 删除组件（widget_positions 外键 CASCADE 自动删除位置） */
    @Delete
    suspend fun delete(widget: WidgetEntity)

    /** 按 id 删除组件（idempotent：不存在时静默不报错） */
    @Query("DELETE FROM widgets WHERE id = :id")
    suspend fun deleteById(id: String)

    /** 删除指定面板下的所有组件 */
    @Query("DELETE FROM widgets WHERE panel_id = :panelId")
    suspend fun deleteByPanel(panelId: String)

    /** 更新组件状态 JSON */
    @Query("UPDATE widgets SET state_json = :stateJson WHERE id = :id")
    suspend fun updateStateJson(id: String, stateJson: String)

    /** 更新组件标题 */
    @Query("UPDATE widgets SET title = :title WHERE id = :id")
    suspend fun updateTitle(id: String, title: String)
}
