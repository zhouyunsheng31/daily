package com.livingdashboard.data.repository

import com.livingdashboard.data.db.UserScriptDao
import com.livingdashboard.data.entity.UserScriptEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 用户脚本 Repository（Spec 2.4 / Phase M4 T1 数据层）。
 *
 * 包装 [UserScriptDao]，对外提供：
 * - Flow 订阅（observeAll / observeEnabled）→ UI 列表实时刷新
 * - 同步快照（[snapshot]）→ ScriptInjector 注入时避免每次查 DB
 * - 缓存层（[cache]）→ getById 命中缓存无需回源
 * - 启动预加载（[preload]）→ LivingDashboardApp.onCreate 中 appScope.launch 调用
 *
 * 设计要点：
 * - 内部 [ConcurrentHashMap] 缓存保证多线程读写安全（ScriptInjector 在主线程读 snapshot，
 *   AI 工具/GM API 在 IO 协程写入）
 * - [update] 自动维护 [updatedAt] 与 [versionCode]（M5 乐观锁预留字段）
 * - [snapshot] 仅返回 enabled=true 的脚本（ScriptInjector 只注入启用的脚本）
 *
 * @param dao Room 生成的 DAO
 * @param json kotlinx.serialization.json.Json 实例（M5 同步 / 元数据序列化预留，
 *             由 DI 提供 [com.livingdashboard.di.AppModule] 中 provideJson）
 */
@Singleton
class UserScriptRepository @Inject constructor(
    private val dao: UserScriptDao,
    private val json: Json,
) {
    /** 内存缓存：id → entity。启动时由 [preload] 填充，CRUD 时同步维护。 */
    private val cache = ConcurrentHashMap<String, UserScriptEntity>()

    /** 观察所有脚本（按 updated_at DESC） */
    fun observeAll(): Flow<List<UserScriptEntity>> = dao.observeAll()

    /** 观察已启用脚本（按 updated_at DESC） */
    fun observeEnabled(): Flow<List<UserScriptEntity>> = dao.observeEnabled()

    /**
     * 同步快照：仅返回 enabled=true 的脚本。
     *
     * ScriptInjector 在 onPageStarted/onPageFinished 中调用，避免每次注入都查 DB
     * （DB 查询是 suspend，无法在 WebView 回调中同步调用）。
     */
    fun snapshot(): List<UserScriptEntity> = cache.values.filter { it.enabled }

    /**
     * 按 id 查脚本：先查内存缓存，未命中回源 DAO 并回填缓存。
     * @return 不存在返回 null
     */
    suspend fun getById(id: String): UserScriptEntity? =
        cache[id] ?: dao.findById(id)?.also { cache[id] = it }

    /**
     * 插入脚本：DB 写入 + 缓存同步。
     * 同 id 覆盖（DAO 用 OnConflictStrategy.REPLACE）。
     */
    suspend fun insert(entity: UserScriptEntity) {
        dao.insert(entity)
        cache[entity.id] = entity
    }

    /**
     * 更新脚本：自动维护 [UserScriptEntity.updatedAt] = now，[UserScriptEntity.versionCode] +1
     * （M5 乐观锁预留）。
     *
     * 注意：调用方传入的 entity 会被 copy 替换 updatedAt/versionCode，原始对象不变。
     */
    suspend fun update(entity: UserScriptEntity) {
        val updated = entity.copy(
            updatedAt = System.currentTimeMillis(),
            versionCode = entity.versionCode + 1,
        )
        dao.update(updated)
        cache[updated.id] = updated
    }

    /**
     * 按 id 删除：DB 删除 + 缓存移除。
     */
    suspend fun deleteById(id: String) {
        dao.deleteById(id)
        cache.remove(id)
    }

    /**
     * 启动时预加载：将所有脚本灌入内存缓存。
     *
     * 调用方：[com.livingdashboard.LivingDashboardApp.onCreate] 的 `appScope.launch { ... }` 中
     * 异步调用（Spec 2.7.3 节），不阻塞主线程。
     * preload 完成前 [snapshot] 返回空列表（ScriptInjector 不注入，符合油猴规范）。
     */
    suspend fun preload() {
        dao.getAllOnce().forEach { cache[it.id] = it }
    }
}
