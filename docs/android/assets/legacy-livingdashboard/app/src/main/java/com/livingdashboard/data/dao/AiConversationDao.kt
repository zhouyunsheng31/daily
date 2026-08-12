package com.livingdashboard.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.livingdashboard.data.entity.AiConversationEntity
import kotlinx.coroutines.flow.Flow

/**
 * AI 对话历史 DAO（Spec 6.8 / Room M3）。
 *
 * v3 schema 新增（MIGRATION_2_3）。
 */
@Dao
interface AiConversationDao {

    /** 观察指定面板的对话历史（按 created_at ASC，便于按时间顺序展示） */
    @Query("SELECT * FROM ai_conversations WHERE panel_id = :panelId ORDER BY created_at ASC")
    fun observeByPanel(panelId: String): Flow<List<AiConversationEntity>>

    /** 取最近 N 条历史（按 created_at ASC，用于 Session 恢复） */
    @Query("SELECT * FROM ai_conversations WHERE panel_id = :panelId ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecent(panelId: String, limit: Int): List<AiConversationEntity>

    /** 插入一条消息，返回主键 id */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: AiConversationEntity): Long

    /** 删除指定面板的所有历史（panelId 删除时调） */
    @Query("DELETE FROM ai_conversations WHERE panel_id = :panelId")
    suspend fun deleteByPanel(panelId: String)
}
