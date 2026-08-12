package com.livingdashboard.ai

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.concurrent.ConcurrentHashMap

/**
 * 本地键值存储（Spec 6.9.2 节末尾 + Spec 2.9 M4 扩展）。
 *
 * 独立类，避免污染 SettingsStore。直接持有 [DataStore]<[Preferences]>，
 * 用 [stringPreferencesKey] 实现 dynamic key 读写。
 *
 * 由 DI Module `provideKvStorage(dataStore: DataStore<Preferences>): KvStorage = KvStorage(dataStore)` 注入。
 *
 * 用途：
 * - M8 本地 agent 的 storage_read / storage_write 工具底层存储
 * - M4 GM_setValue / GM_getValue 同步读写（依赖 [memoryCache] + [preload]）
 *
 * M4 扩展（Spec 2.9 / v3 修复 S1）：
 * - [memoryCache]：内存缓存，GM_getValue 同步读、GM_setValue 同步写
 * - [readSync] / [writeSync]：同步读写内存缓存（GM_* API 用，不阻塞 WebView 线程）
 * - [preload]：启动时在 `appScope.launch { ... }` 中异步预加载所有 KV 到 [memoryCache]
 *   （不阻塞 onCreate；preload 完成前 readSync 返回 null，油猴规范允许）
 */
class KvStorage(
    private val dataStore: DataStore<Preferences>,
) {
    /** M4 新增：内存缓存，GM_getValue 同步读 / GM_setValue 同步写。 */
    private val memoryCache = ConcurrentHashMap<String, String>()

    /** 读取 key 对应的字符串值；不存在返回 null。 */
    suspend fun read(key: String): String? {
        memoryCache[key]?.let { return it }
        return dataStore.data.map { it[stringPreferencesKey(key)] }.first()
            ?.also { memoryCache[key] = it }
    }

    /** M4 新增：同步读内存缓存（GM_getValue 用，依赖 preload 提前加载）。 */
    fun readSync(key: String): String? = memoryCache[key]

    /** M4 新增：同步写内存缓存（GM_setValue 用，立即对后续 readSync 可见）。 */
    fun writeSync(key: String, value: String) {
        memoryCache[key] = value
    }

    /** 写入 key=value（覆盖已存在值）。 */
    suspend fun write(key: String, value: String) {
        memoryCache[key] = value
        dataStore.edit { it[stringPreferencesKey(key)] = value }
    }

    /** 列出所有已写入的 key（按 Preferences.Key.name 还原原字符串）。 */
    suspend fun listKeys(): List<String> =
        dataStore.data.map { it.asMap().keys.map { k -> k.name } }.first()

    /** M4 新增：预加载所有 KV 到内存（启动时调用）。 */
    suspend fun preload() {
        dataStore.data.first().asMap().forEach { (k, v) ->
            memoryCache[k.name] = v.toString()
        }
    }
}
