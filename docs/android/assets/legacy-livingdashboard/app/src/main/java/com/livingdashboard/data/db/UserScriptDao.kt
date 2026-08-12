package com.livingdashboard.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.livingdashboard.data.entity.UserScriptEntity
import kotlinx.coroutines.flow.Flow

/**
 * 用户脚本 DAO（Spec 2.6 / Phase M4 T1 数据层）。
 *
 * 由 LivingDatabase.userScriptDao() 提供（abstract 函数，Room 编译期生成实现）。
 *
 * 方法语义：
 * - [observeAll] / [observeEnabled]：返回 Flow，UI 订阅列表实时刷新
 * - [getAllOnce]：一次性快照，Repository.preload() 启动时填充内存缓存用
 * - [findById]：单条查询，Repository.getById() 缓存未命中时回源
 * - [insert]：OnConflictStrategy.REPLACE（同 id 覆盖，create_userscript 工具 + 导入流程用）
 * - [update]：@Update，按 PrimaryKey 匹配（Repository.update 调用，先 copy 再 update）
 * - [deleteById]：按 id 删除（避免 @Delete 需传整个 entity）
 *
 * SQL 排序：ORDER BY updated_at DESC（与 observeAll/observeEnabled 一致，最近修改的脚本在前）。
 */
@Dao
interface UserScriptDao {

    /** 观察所有脚本（按 updated_at DESC） */
    @Query("SELECT * FROM userscripts ORDER BY updated_at DESC")
    fun observeAll(): Flow<List<UserScriptEntity>>

    /** 观察已启用脚本（按 updated_at DESC） */
    @Query("SELECT * FROM userscripts WHERE enabled = 1 ORDER BY updated_at DESC")
    fun observeEnabled(): Flow<List<UserScriptEntity>>

    /** 一次性读取所有脚本（Repository.preload 用） */
    @Query("SELECT * FROM userscripts")
    suspend fun getAllOnce(): List<UserScriptEntity>

    /** 按 id 查单条，不存在返回 null */
    @Query("SELECT * FROM userscripts WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): UserScriptEntity?

    /** 插入（同 id 覆盖） */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: UserScriptEntity)

    /** 更新（按 PrimaryKey 匹配） */
    @Update
    suspend fun update(entity: UserScriptEntity)

    /** 按 id 删除 */
    @Query("DELETE FROM userscripts WHERE id = :id")
    suspend fun deleteById(id: String)
}
