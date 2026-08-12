package com.livingdashboard.ai

import android.content.SharedPreferences

/**
 * 纯内存版 [SharedPreferences] fake，用于 ApiKeyStoreTest 等 JVM 单元测试。
 *
 * 设计目的：
 * - 替代 Robolectric 提供的 SharedPreferences 实现，避免 Robolectric 启动时
 *   下载 android-all.jar 失败（MavenDependencyResolver FileNotFoundException）。
 * - ApiKeyStore 只依赖 [SharedPreferences] 接口，不依赖 EncryptedSharedPreferences
 *   或 AndroidKeyStore JCE Provider，因此纯 JVM 实现足以覆盖测试路径。
 *
 * 行为契约（与 Android SharedPreferences 一致）：
 * - 同一对象同时实现 [SharedPreferences] 与 [SharedPreferences.Editor]，`edit()` 返回 `this`。
 * - `putXxx` / `remove` / `clear` 返回 `this` 支持链式调用。
 * - `apply()` 同步写入内存 map；`commit()` 同 `apply` 但返回 `true`。
 * - `getAll()` 返回 map 的副本，避免外部直接修改内部状态。
 * - `getXxx(key, defValue)` 缺失时返回 `defValue`，类型不匹配时返回 `defValue`（参考 Android 行为）。
 * - `contains(key)` 检查 key 是否存在。
 * - 不触发 [OnSharedPreferenceChangeListener]（ApiKeyStore 未使用，且单线程测试无需通知）。
 */
class InMemorySharedPreferences : SharedPreferences, SharedPreferences.Editor {

    private val map: MutableMap<String, Any?> = mutableMapOf()

    // ===== SharedPreferences =====

    override fun getAll(): Map<String, *> = map.toMap()

    override fun getString(key: String, defValue: String?): String? {
        val v = map[key]
        return if (v is String) v else defValue
    }

    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? {
        val v = map[key]
        return if (v is Set<*>) v as Set<String> else defValues
    }

    override fun getInt(key: String, defValue: Int): Int {
        val v = map[key]
        return if (v is Int) v else defValue
    }

    override fun getLong(key: String, defValue: Long): Long {
        val v = map[key]
        return if (v is Long) v else defValue
    }

    override fun getFloat(key: String, defValue: Float): Float {
        val v = map[key]
        return if (v is Float) v else defValue
    }

    override fun getBoolean(key: String, defValue: Boolean): Boolean {
        val v = map[key]
        return if (v is Boolean) v else defValue
    }

    override fun contains(key: String): Boolean = map.containsKey(key)

    override fun edit(): SharedPreferences.Editor = this

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        // 测试无需通知，no-op
    }

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        // 测试无需通知，no-op
    }

    // ===== SharedPreferences.Editor =====

    override fun putString(key: String, value: String?): SharedPreferences.Editor {
        map[key] = value
        return this
    }

    override fun putStringSet(key: String, values: Set<String>?): SharedPreferences.Editor {
        map[key] = values
        return this
    }

    override fun putInt(key: String, value: Int): SharedPreferences.Editor {
        map[key] = value
        return this
    }

    override fun putLong(key: String, value: Long): SharedPreferences.Editor {
        map[key] = value
        return this
    }

    override fun putFloat(key: String, value: Float): SharedPreferences.Editor {
        map[key] = value
        return this
    }

    override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor {
        map[key] = value
        return this
    }

    override fun remove(key: String): SharedPreferences.Editor {
        map.remove(key)
        return this
    }

    override fun clear(): SharedPreferences.Editor {
        map.clear()
        return this
    }

    override fun commit(): Boolean {
        // 内存模式：数据已直接写入 map，返回 true 表示提交成功
        return true
    }

    override fun apply() {
        // 内存模式：数据已直接写入 map，无需异步刷盘
    }
}
