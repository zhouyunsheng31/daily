package com.livingdashboard.data.prefs

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.livingdashboard.data.SearchEngine
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DataStore Preferences 设置存储（Spec 3.1.4 + 4.9 M2 扩展）。
 *
 * M2 改写（Spec 4.9）：
 * - 构造函数从 `(@ApplicationContext context: Context)` 改为 `@Inject constructor(dataStore: DataStore<Preferences>)`
 * - 删除顶层 `Context.dataStore` 委托（由 DatabaseModule.provideDataStore 提供）
 * - 加 `@Singleton`
 * - 新增 `defaultHomeMode`（D4 首次启动选择的主页）
 *
 * M1 字段全部保留：themeColorIndex / searchEngine / uaMode / homeBackgroundUri /
 * homeLogoUri / showHomeShortcuts / javaScriptEnabled。
 *
 * DataStore 文件名 "settings" 与 M1 委托一致，已有用户数据自动迁移。
 */

/** 设置项键值对（Spec 3.1.4 + 4.9） */
object SettingsKeys {
    val THEME_COLOR = intPreferencesKey("theme_color")
    val SEARCH_ENGINE = stringPreferencesKey("search_engine")
    val HOME_BACKGROUND_URI = stringPreferencesKey("home_bg_uri")
    val HOME_LOGO_URI = stringPreferencesKey("home_logo_uri")
    val SHOW_HOME_SHORTCUTS = booleanPreferencesKey("show_home_shortcuts")
    val UA_MODE = stringPreferencesKey("ua_mode")
    val JAVA_SCRIPT_ENABLED = booleanPreferencesKey("js_enabled")

    /** M2 新增：首次启动选择的主页模式（"browser" / "canvas"），null = 未选择 */
    val DEFAULT_HOME_MODE = stringPreferencesKey("default_home_mode")

    /** 全允许模式：开启后所有工具调用自动执行，不再询问 */
    val ALLOW_ALL_TOOLS = booleanPreferencesKey("allow_all_tools")
}

@Singleton
class SettingsStore @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {

    /** 主题色索引 Flow（-1=跟随系统 dynamicColor，0..5=预设主题色） */
    val themeColorIndex: Flow<Int> = dataStore.data.map { it[SettingsKeys.THEME_COLOR] ?: -1 }

    /** 搜索引擎 Flow */
    val searchEngine: Flow<SearchEngine> = dataStore.data.map { prefs ->
        when (prefs[SettingsKeys.SEARCH_ENGINE]) {
            "google" -> SearchEngine.GOOGLE
            "bing" -> SearchEngine.BING
            else -> SearchEngine.BAIDU
        }
    }

    /** UA 模式 Flow */
    val uaMode: Flow<UaMode> = dataStore.data.map { prefs ->
        when (prefs[SettingsKeys.UA_MODE]) {
            "desktop" -> UaMode.DESKTOP
            else -> UaMode.MOBILE
        }
    }

    /** 主页背景图 URI Flow */
    val homeBackgroundUri: Flow<String?> = dataStore.data.map { it[SettingsKeys.HOME_BACKGROUND_URI] }

    /** 主页 Logo URI Flow */
    val homeLogoUri: Flow<String?> = dataStore.data.map { it[SettingsKeys.HOME_LOGO_URI] }

    /** 是否显示常用网站 Flow（默认 true） */
    val showHomeShortcuts: Flow<Boolean> =
        dataStore.data.map { it[SettingsKeys.SHOW_HOME_SHORTCUTS] ?: true }

    /** 是否启用 JavaScript Flow（默认 true） */
    val javaScriptEnabled: Flow<Boolean> =
        dataStore.data.map { it[SettingsKeys.JAVA_SCRIPT_ENABLED] ?: true }

    /**
     * M2 新增：D4 首次启动选择的主页模式。
     * - null = 未选择（首次启动，显示 HomeModeSelectorScreen）
     * - "browser" / "canvas"
     */
    val defaultHomeMode: Flow<String?> = dataStore.data.map { it[SettingsKeys.DEFAULT_HOME_MODE] }

    /** 是否启用全允许模式 Flow（默认 false，开启后所有工具调用自动执行不再询问） */
    val allowAllTools: Flow<Boolean> =
        dataStore.data.map { it[SettingsKeys.ALLOW_ALL_TOOLS] ?: false }

    /** 设置主题色索引（-1=跟随系统，0..5=预设色） */
    suspend fun setThemeColor(index: Int) {
        dataStore.edit { it[SettingsKeys.THEME_COLOR] = index }
    }

    /** 设置搜索引擎 */
    suspend fun setSearchEngine(engine: SearchEngine) {
        dataStore.edit { it[SettingsKeys.SEARCH_ENGINE] = engine.name.lowercase() }
    }

    /** 设置 UA 模式 */
    suspend fun setUaMode(mode: UaMode) {
        dataStore.edit { it[SettingsKeys.UA_MODE] = mode.name.lowercase() }
    }

    /** 设置主页背景图 URI（传 null 清除） */
    suspend fun setHomeBackgroundUri(uri: String?) {
        dataStore.edit {
            if (uri == null) it.remove(SettingsKeys.HOME_BACKGROUND_URI)
            else it[SettingsKeys.HOME_BACKGROUND_URI] = uri
        }
    }

    /** 设置主页 Logo URI（传 null 恢复默认） */
    suspend fun setHomeLogoUri(uri: String?) {
        dataStore.edit {
            if (uri == null) it.remove(SettingsKeys.HOME_LOGO_URI)
            else it[SettingsKeys.HOME_LOGO_URI] = uri
        }
    }

    /** 设置是否显示常用网站 */
    suspend fun setShowHomeShortcuts(show: Boolean) {
        dataStore.edit { it[SettingsKeys.SHOW_HOME_SHORTCUTS] = show }
    }

    /** 设置是否启用 JavaScript */
    suspend fun setJavaScriptEnabled(enabled: Boolean) {
        dataStore.edit { it[SettingsKeys.JAVA_SCRIPT_ENABLED] = enabled }
    }

    /** M2 新增：设置默认主页模式（"browser" / "canvas"） */
    suspend fun setDefaultHomeMode(mode: String) {
        dataStore.edit { it[SettingsKeys.DEFAULT_HOME_MODE] = mode }
    }

    /** 设置全允许模式开关 */
    suspend fun setAllowAllTools(enabled: Boolean) {
        dataStore.edit { it[SettingsKeys.ALLOW_ALL_TOOLS] = enabled }
    }
}
