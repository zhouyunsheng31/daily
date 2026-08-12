# Phase M1 实施 Spec — 移动端浏览器主页 + WebView 浏览器

> 生成日期：2026-06-24
> 依据：[roadmap_mobile_v1.md](file:///f:/allmylife/event/docs/roadmap_mobile_v1.md) 第五章 Phase M1
> 工作流：roadmap 第九章（写 Spec → 对抗审查 → 编码 → 对抗审查 → commit）
> 前置：M0 已完成（commit `6c586e1`），项目骨架 + WS 客户端可用
>
> **产品定位**：移动端 AI 浏览器客户端（形态=浏览器+无限画布+AI，用途=日常 AI 助手）
> **M1 目标**：实现浏览器主页 + WebView 浏览器，能正常上网，具备完整浏览器基础能力

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1 | 2026-06-24 | 初版 |
| v2 | 2026-06-24 | 修复对抗审查发现的 10 个 Critical + 重要 Major 问题 |
| v3 | 2026-06-24 | 修复第二轮对抗审查发现的 6 个问题：NC1 SettingsViewModel WsClient API 不匹配、NC2 LivingWebView 闭包捕获错误（改用 rememberUpdatedState）、NC3 MainActivityContent Repository 注入错误（新增 MainViewModel）、NC4 LivingWebView 缺少 inward 控制接口（新增 WebViewController）、NC5 LivingDatabase @Database 定义缺失、NC6 Repository 类实现缺失 |

---

## 一、上下文与约束

### 1.1 项目背景

M0 已搭建安卓项目骨架（Kotlin + Compose + Hilt + WS 客户端），App 能启动、能连服务器。M1 在此基础上实现浏览器主页 + WebView 浏览器，让 App 真正能上网。M1 不涉及画布主页、AI 操控、脚本系统（M2/M3/M4）。

### 1.2 硬约束（来自 roadmap 第四章 + 用户规则）

| 约束 | 说明 |
|------|------|
| 技术栈 | Kotlin + Jetpack Compose + WebView（不用 TS/React） |
| Gradle | `F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat` |
| Java | `D:\Java`（Java 17） |
| Android SDK | `F:\Android SDK`（android-36 + build-tools 36.1.0） |
| 包体 | < 20MB（M1 验收时检查 debug APK 体积） |
| git | 所有变更走 git commit |
| 图标 | Compose 内置 Material Icons 为主 + VectorDrawable 补充（不用 PNG 位图，启动图标 WebP 除外） |
| 不下载 C 盘 | 所有下载/缓存走 F 盘或其他非 C 盘 |
| compileSdk | 36（M0 已确认，继续沿用） |
| minSdk | 26（Android 8.0） |
| 包名 | `com.livingdashboard` |

### 1.3 M0 现状（已实现，M1 在此基础上扩展）

| 模块 | 状态 | 说明 |
|------|------|------|
| 项目骨架 | ✅ | Gradle + Compose + Hilt 配置完成 |
| WS 客户端 | ✅ | `sync/WsClient.kt` + `WsMessage.kt` + `ServerConfig.kt` + `DeviceAuth.kt` |
| UI | ✅ 占位 | `ui/home/HomeScreen.kt`（M0 信息展示页，M1 归档到 `ui/debug/M0HomeScreen.kt`，WS 信息迁移到设置页"调试信息"分组） |
| 主题 | ✅ | `ui/theme/`（Color/Theme/Type，M1 扩展支持主题色定制，处理 dynamicColor 冲突） |
| DI | ✅ | `di/AppModule.kt`（M1 扩展注入 Room + Repository） |
| Room | ✅ 引入未建表 | build.gradle.kts 已引入 Room 依赖，M1 建表 |
| 图标资源 | ✅ | `ic_launcher` + `ic_logo.webp`（M1 复用） |
| Application | ✅ | `LivingDashboardApp.kt`（M1 不改，WS 连接逻辑保留） |

### 1.4 M1 任务清单（来自 roadmap 第五章 Phase M1）

| # | 任务 | 详情 | 验收标准 |
|---|------|------|----------|
| 1 | 浏览器主页 | 搜索框 + Logo/书签一体 + 常用网站（类 Via） | 主页正常显示 |
| 2 | WebView 浏览器 | WebView 封装，能打开真实网页 | 能打开贴吧/知乎等 |
| 3 | 地址栏 | 输入网址/搜索，支持搜索建议 | 地址栏正常工作 |
| 4 | 标签页管理 | 多标签页，新建/关闭/切换 | 标签页正常 |
| 5 | 底部栏 | 5 按钮（后退/前进/Home/标签/更多） | 底部栏正常 |
| 6 | 更多菜单 | 半屏面板展开（书签/历史/下载/设置等） | 菜单正常 |
| 7 | 书签 | 添加/管理/显示在主页 | 书签功能正常 |
| 8 | 历史 | 访问记录管理 | 历史功能正常 |
| 9 | 主页定制 | 背景图/Logo/主题色自定义 | 定制功能正常 |
| 10 | Cookie 管理 | CookieManager 读写 Cookie | Cookie 正常 |
| 11 | 默认浏览器 | RoleManager 请求 + Intent Filter | 能设为默认浏览器 |

### 1.5 关键设计决策（本次 Spec 确认）

| 决策 | 选择 | 理由 |
|------|------|------|
| 架构模式 | MVVM + Compose | Android 官方推荐，ViewModel 存活配置变更，StateFlow 驱动 UI |
| 数据持久化 | Room（SQLite） | roadmap 指定，M0 已引入依赖 |
| 标签页 WebView 策略 | **单 WebView 实例 + URL 重新加载**（M1 不做 WebView 池，不存完整 WebView 状态） | M1 简化，避免内存管理复杂度；切换标签时只保存 URL/title 到 Room，切回时从 URL 重新加载页面。M7 用 `saveState`/`restoreState` 增强状态恢复；WebView 池留给 M7 优化 |
| 搜索引擎 | 默认百度（`https://www.baidu.com/s?wd=`），设置可切换 Google/Bing | 国内用户默认百度，可切换 |
| 搜索建议 | **M1 简化版**：URL 补全（输入 `baidu` 补全 `https://www.baidu.com`）+ 搜索引擎跳转建议 | 真实搜索建议 API 需要网络请求 + JSON 解析，M1 先做基础体验，M7 增强 |
| 主页定制存储 | SharedPreferences（DataStore Preferences） | 轻量键值对，适合设置项；不用 Room（设置不是关系数据） |
| 背景图定制 | SAF（Storage Access Framework）选图，复制到 App 私有目录 | Android 沙箱标准做法，不申请存储权限 |
| 主题色定制 | 预设 6 色 + "跟随系统"选项（dynamicColor），选择预设色时禁用 dynamicColor | 简化，避免颜色选择器复杂度；与 M0 dynamicColor 兼容（见 3.4 节） |
| 默认浏览器 | RoleManager（Android 10+）+ Intent Filter | roadmap 3.9 节方案 |
| 导航框架 | Compose Navigation（`androidx.navigation:navigation-compose`） | 标准选择，管理主页/浏览器/书签/历史/设置页面跳转 |
| 地址栏位置 | **顶部**（类 Via，主页和浏览器页都有） | Via 范式，符合用户预期 |
| 底部栏 | 5 按钮，浏览器模式 [←][→][Home][标签][⋮] | roadmap 2.4 节 |
| 更多菜单 | ModalBottomSheet（M3 组件）半屏展开 | roadmap 2.4 节"向上展开半屏菜单" |
| 标签页管理页 | 独立页面（非弹窗），卡片式展示 | Via 范式，移动端屏幕大适合卡片 |
| Cookie 管理 | M1 提供"清除 Cookie"按钮 + 当前网站 Cookie 查看 | CookieManager API，M1 不做编辑器 |
| 历史记录去重 | 同 URL 合并（不限天），保留最新访问时间，visitCount++ | 避免历史爆炸，逻辑简单一致 |
| 主页快捷图标 | 书签标记 `showOnHome` 的子集 | roadmap 2.1 节"书签标记显示在主页" |

---

## 二、模块结构与文件清单

### 2.1 目标目录结构（M1 结束后）

```
client/android/app/src/main/java/com/livingdashboard/
├── LivingDashboardApp.kt              # 已有，M1 不改（WS 连接逻辑保留）
├── ui/
│   ├── MainActivity.kt                # 已有，M1 改：接入导航 + 浏览器主页 + 保留 WS 注入
│   ├── MainViewModel.kt              # 新（NC3）：MainActivity 顶层 ViewModel，注入 TabRepository + SettingsStore
│   ├── theme/                         # 已有，M1 扩展
│   │   ├── Color.kt                   # 已有，M1 加预设主题色（统一用 Purple40）
│   │   ├── Theme.kt                   # 已有，M1 支持动态主题色 + 处理 dynamicColor 冲突
│   │   └── Type.kt                    # 已有，不改
│   ├── nav/
│   │   └── AppNavGraph.kt             # 新：导航图
│   ├── home/
│   │   ├── BrowserHomeScreen.kt       # 新：浏览器主页（替换 M0 的 HomeScreen）
│   │   ├── BrowserHomeViewModel.kt    # 新
│   │   └── components/
│   │       ├── SearchBar.kt           # 新：搜索框
│   │       ├── LogoHeader.kt          # 新：Logo/书签一体头部
│   │       └── QuickAccessGrid.kt     # 新：常用网站网格
│   ├── browser/
│   │   ├── BrowserScreen.kt           # 新：WebView 浏览器页
│   │   ├── BrowserViewModel.kt        # 新（含 SavedStateHandle）
│   │   └── components/
│   │       ├── AddressBar.kt          # 新：地址栏
│   │       └── ProgressBar.kt         # 新：加载进度条
│   ├── tab/
│   │   ├── TabManagerScreen.kt        # 新：标签页管理
│   │   └── TabManagerViewModel.kt     # 新
│   ├── bookmark/
│   │   ├── BookmarkScreen.kt          # 新：书签管理
│   │   └── BookmarkViewModel.kt       # 新
│   ├── history/
│   │   ├── HistoryScreen.kt           # 新：历史记录
│   │   └── HistoryViewModel.kt        # 新
│   ├── settings/
│   │   ├── SettingsScreen.kt          # 新：设置（主页定制 + 浏览器设置 + 调试信息）
│   │   └── SettingsViewModel.kt       # 新（含 WS 调试信息收集）
│   ├── components/
│   │   ├── BottomBar.kt               # 新：底部栏（5 按钮）
│   │   └── MoreMenuSheet.kt           # 新：更多菜单半屏面板
│   └── debug/
│       └── M0HomeScreen.kt            # 归档：M0 的 HomeScreen，仅作调试参考，不在导航图中注册
├── browser/                           # 浏览器引擎层
│   ├── LivingWebView.kt               # 新：WebView 封装（含生命周期管理）
│   ├── LivingWebViewClient.kt         # 新：WebViewClient（含 scheme 拦截 + 错误回调）
│   ├── LivingWebChromeClient.kt       # 新：WebChromeClient（含文件选择 + JS 对话框 + 权限）
│   ├── CookieManagerWrapper.kt        # 新：Cookie 管理封装（文件名与类名一致）
│   └── DefaultBrowserHelper.kt        # 新：默认浏览器辅助（不走 Hilt DI）
├── data/                              # 数据层（Room）
│   ├── db/
│   │   ├── LivingDatabase.kt          # 新：Room 数据库
│   │   └── Converters.kt              # 新：类型转换器
│   ├── dao/
│   │   ├── BookmarkDao.kt             # 新
│   │   ├── HistoryDao.kt              # 新
│   │   └── TabDao.kt                  # 新
│   ├── entity/
│   │   ├── BookmarkEntity.kt          # 新
│   │   ├── HistoryEntity.kt           # 新
│   │   └── TabEntity.kt               # 新（M1 只存 URL+title，不存 webViewState）
│   ├── repository/
│   │   ├── BookmarkRepository.kt      # 新
│   │   ├── HistoryRepository.kt       # 新
│   │   └── TabRepository.kt           # 新
│   └── prefs/
│       └── SettingsStore.kt           # 新：DataStore Preferences（含完整类骨架）
├── di/
│   ├── AppModule.kt                   # 已有，M1 扩展（加 Repository @Provides）
│   └── DatabaseModule.kt              # 新：Room + DataStore + CookieManager 注入
└── sync/                              # 已有，M1 不改
```

### 2.2 资源文件变更

| 文件 | 变更 | 说明 |
|------|------|------|
| `res/values/strings.xml` | 改 | 加 M1 所有 UI 文案 |
| `res/values/themes.xml` | 改 | 适配 WebView 主题 |
| `res/drawable/` | 加 | VectorDrawable 图标（如需补充） |
| `AndroidManifest.xml` | 改 | 加 Intent Filter（http/https）+ 注册新 Activity（如需） |

### 2.3 依赖变更（build.gradle.kts）

新增依赖：

```kotlin
// Navigation
implementation("androidx.navigation:navigation-compose:2.7.7")

// DataStore Preferences
implementation("androidx.datastore:datastore-preferences:1.1.1")

// Coroutines（Room 异步）
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

// material-icons-extended（更多图标，R8 裁剪）
implementation("androidx.compose.material:material-icons-extended")

// WebView 用的 lifecycle
implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")  // 已有
```

---

## 三、详细设计

### 3.1 数据层（Room + DataStore）

#### 3.1.0 LivingDatabase（Room 数据库定义，NC5）

> **NC5 修复**：原 Spec 缺少 `LivingDatabase` 的 `@Database` 定义，`DatabaseModule.provideDatabase` 引用的 `LivingDatabase::class.java` 无法编译。补充完整类定义。

```kotlin
package com.livingdashboard.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import com.livingdashboard.data.dao.BookmarkDao
import com.livingdashboard.data.dao.HistoryDao
import com.livingdashboard.data.dao.TabDao
import com.livingdashboard.data.entity.BookmarkEntity
import com.livingdashboard.data.entity.HistoryEntity
import com.livingdashboard.data.entity.TabEntity

/**
 * Living Dashboard Room 数据库（NC5）。
 *
 * - version = 1：M1 初始版本
 * - exportSchema = false：M1 开发期不导出 schema（正式版前补迁移脚本）
 * - entities：BookmarkEntity + HistoryEntity + TabEntity（M1 三张表）
 *
 * 由 DatabaseModule.provideDatabase 提供，fallbackToDestructiveMigration（开发期破坏性迁移）。
 */
@Database(
    entities = [BookmarkEntity::class, HistoryEntity::class, TabEntity::class],
    version = 1,
    exportSchema = false
)
abstract class LivingDatabase : RoomDatabase() {
    abstract fun bookmarkDao(): BookmarkDao
    abstract fun historyDao(): HistoryDao
    abstract fun tabDao(): TabDao
}
```

**说明**：
- `@Database` 注解的 `entities` 数组列出所有 Entity 类，Room 编译时据此生成表
- `version = 1`：M1 初始版本，后续 schema 变更需递增 version + 写迁移脚本（M1 用 `fallbackToDestructiveMigration` 简化）
- `exportSchema = false`：不导出 JSON schema 文件（正式版前改为 true 并配置 schema 目录）
- 三个 `abstract fun` 返回 DAO，Room 编译时生成实现

#### 3.1.1 BookmarkEntity（书签）

```kotlin
@Entity(tableName = "bookmarks")
data class BookmarkEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val url: String,
    val faviconUrl: String? = null,       // 网站图标 URL
    val showOnHome: Boolean = false,       // 是否显示在主页快捷图标
    val createdAt: Long = System.currentTimeMillis(),
    val sortOrder: Int = 0                // 主页排序
)
```

**DAO**：
- `insert(bookmark)` / `update(bookmark)` / `delete(bookmark)`
- `getAll(): Flow<List<BookmarkEntity>>`
- `getHomeShortcuts(): Flow<List<BookmarkEntity>>`（showOnHome=true）
- `findByUrl(url): BookmarkEntity?`（判断是否已收藏）

#### 3.1.2 HistoryEntity（历史）

```kotlin
@Entity(tableName = "history")
data class HistoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val url: String,
    val visitedAt: Long = System.currentTimeMillis(),
    val visitCount: Int = 1
)
```

**DAO**：
- `insert(history)` — 插入前先查同 URL，存在则 visitCount++ 并更新 visitedAt
- `getAll(): Flow<List<HistoryEntity>>`（按 visitedAt DESC）
- `delete(history)` / `deleteAll()`
- `search(query): Flow<List<HistoryEntity>>`
- `findByUrl(url): HistoryEntity?`（去重查询）

**去重逻辑（统一为"同 URL 合并"，不限天）**：在 Repository 层，`recordVisit(url, title)` 时先 `findByUrl`：
- 存在 → `update`（`visitCount++`，`visitedAt = now`，`title` 取最新）
- 不存在 → `insert`

不再有"同天合并"的特殊逻辑，避免边界条件歧义。

#### 3.1.3 TabEntity（标签页）

```kotlin
@Entity(tableName = "tabs")
data class TabEntity(
    @PrimaryKey val id: String,           // UUID
    val title: String = "新标签页",
    val url: String = "",                 // 当前 URL（空=主页）
    val faviconUrl: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val lastActiveAt: Long = System.currentTimeMillis(),
    val sortOrder: Int = System.currentTimeMillis().toInt()  // 用时间戳保证新建标签排在末尾
)
```

**DAO**：
- `insert(tab)` / `update(tab)` / `delete(tab)`
- `getAll(): Flow<List<TabEntity>>`（按 `sortOrder` ASC 排序，等价于按创建顺序）
- `getById(id): TabEntity?`
- `deleteAll()`

**M1 标签页状态策略（统一）**：
- **M1 只存 URL + title**，不存 `webViewState`，也不存 `scrollPosition`
- 切换标签时：保存当前标签的 URL + title 到 Room
- 切回标签时：从 Room 读 URL，重新加载页面（页面状态丢失可接受）
- M7 用 `saveState`/`restoreState` 增强状态恢复（届时再加 `webViewState: ByteArray?` 字段）

**排序说明**：`sortOrder` 用 `System.currentTimeMillis().toInt()` 保证新建标签排在末尾，避免显式维护序号带来的重排问题。如果需要手动调整顺序（M7 拖拽排序），可在 M7 引入独立序号字段。

#### 3.1.4 SettingsStore（DataStore Preferences）

```kotlin
// 设置项键值对
object SettingsKeys {
    val THEME_COLOR = intPreferencesKey("theme_color")        // 主题色索引（0-5），-1=跟随系统 dynamicColor
    val SEARCH_ENGINE = stringPreferencesKey("search_engine") // "baidu" | "google" | "bing"
    val HOME_BACKGROUND_URI = stringPreferencesKey("home_bg_uri") // SAF URI（复制后的私有目录路径）
    val HOME_LOGO_URI = stringPreferencesKey("home_logo_uri")     // 自定义 Logo 路径
    val SHOW_HOME_SHORTCUTS = booleanPreferencesKey("show_home_shortcuts") // 是否显示常用网站
    val UA_MODE = stringPreferencesKey("ua_mode")             // "mobile" | "desktop"
    val JAVA_SCRIPT_ENABLED = booleanPreferencesKey("js_enabled") // 默认 true
}
```

**SettingsStore 类骨架**：

```kotlin
class SettingsStore(@ApplicationContext private val context: Context) {
    // 使用 by preferencesDataStore 委托创建单例 DataStore
    private val Context.dataStore by preferencesDataStore(name = "settings")
    private val dataStore = context.dataStore

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

    val homeBackgroundUri: Flow<String?> = dataStore.data.map { it[SettingsKeys.HOME_BACKGROUND_URI] }
    val homeLogoUri: Flow<String?> = dataStore.data.map { it[SettingsKeys.HOME_LOGO_URI] }
    val showHomeShortcuts: Flow<Boolean> = dataStore.data.map { it[SettingsKeys.SHOW_HOME_SHORTCUTS] ?: true }
    val javaScriptEnabled: Flow<Boolean> = dataStore.data.map { it[SettingsKeys.JAVA_SCRIPT_ENABLED] ?: true }

    suspend fun setThemeColor(index: Int) {
        dataStore.edit { it[SettingsKeys.THEME_COLOR] = index }
    }
    suspend fun setSearchEngine(engine: SearchEngine) {
        dataStore.edit { it[SettingsKeys.SEARCH_ENGINE] = engine.name.lowercase() }
    }
    suspend fun setUaMode(mode: UaMode) {
        dataStore.edit { it[SettingsKeys.UA_MODE] = mode.name.lowercase() }
    }
    suspend fun setHomeBackgroundUri(uri: String?) {
        dataStore.edit {
            if (uri == null) it.remove(SettingsKeys.HOME_BACKGROUND_URI)
            else it[SettingsKeys.HOME_BACKGROUND_URI] = uri
        }
    }
    suspend fun setHomeLogoUri(uri: String?) {
        dataStore.edit {
            if (uri == null) it.remove(SettingsKeys.HOME_LOGO_URI)
            else it[SettingsKeys.HOME_LOGO_URI] = uri
        }
    }
    suspend fun setShowHomeShortcuts(show: Boolean) {
        dataStore.edit { it[SettingsKeys.SHOW_HOME_SHORTCUTS] = show }
    }
    suspend fun setJavaScriptEnabled(enabled: Boolean) {
        dataStore.edit { it[SettingsKeys.JAVA_SCRIPT_ENABLED] = enabled }
    }
}

enum class UaMode { MOBILE, DESKTOP }
```

**说明**：`SettingsStore` 由 Hilt 注入（见 3.6 节 `DatabaseModule`），所有读取返回 `Flow<T>`，写入用 `suspend` 函数。`THEME_COLOR` 默认值 `-1` 表示跟随系统 `dynamicColor`；当用户选择预设主题色（0..5）时，`Theme.kt` 会禁用 `dynamicColor`（见 3.4 节）。

#### 3.1.5 Repository 层（NC6）

> **NC6 修复**：原 Spec 只列了 DAO 方法签名，缺少 Repository 类实现。`BrowserViewModel`、`MainViewModel`、`BookmarkViewModel`、`HistoryViewModel` 都依赖 Repository 类存在。补充 `HistoryRepository` 完整实现（含 `recordVisit` 去重逻辑），`BookmarkRepository` 和 `TabRepository` 给出完整方法签名。

**HistoryRepository（完整实现）**：

```kotlin
package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.HistoryDao
import com.livingdashboard.data.entity.HistoryEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class HistoryRepository @Inject constructor(
    private val historyDao: HistoryDao
) {
    /** 所有历史记录（按 visitedAt DESC） */
    fun getAll(): Flow<List<HistoryEntity>> = historyDao.getAll()

    /**
     * 记录一次访问（去重逻辑：同 URL 合并，不限天）。
     * - 存在 → update（visitCount++，visitedAt = now，title 取最新）
     * - 不存在 → insert
     *
     * @param url 访问的 URL
     * @param title 页面标题
     */
    suspend fun recordVisit(url: String, title: String) {
        val existing = historyDao.findByUrl(url)
        if (existing != null) {
            historyDao.update(
                existing.copy(
                    title = title,
                    visitedAt = System.currentTimeMillis(),
                    visitCount = existing.visitCount + 1
                )
            )
        } else {
            historyDao.insert(HistoryEntity(title = title, url = url))
        }
    }

    suspend fun delete(entity: HistoryEntity) = historyDao.delete(entity)
    suspend fun deleteAll() = historyDao.deleteAll()

    /** 搜索历史（按 title/url 模糊匹配） */
    fun search(query: String): Flow<List<HistoryEntity>> = historyDao.search(query)
}
```

**BookmarkRepository（完整方法签名）**：

```kotlin
package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.BookmarkDao
import com.livingdashboard.data.entity.BookmarkEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class BookmarkRepository @Inject constructor(
    private val bookmarkDao: BookmarkDao
) {
    /** 所有书签 */
    fun getAll(): Flow<List<BookmarkEntity>> = bookmarkDao.getAll()

    /** 主页快捷图标（showOnHome=true） */
    fun getHomeShortcuts(): Flow<List<BookmarkEntity>> = bookmarkDao.getHomeShortcuts()

    /** 按 URL 查书签（判断是否已收藏） */
    suspend fun findByUrl(url: String): BookmarkEntity? = bookmarkDao.findByUrl(url)

    /** 添加书签 */
    suspend fun insert(bookmark: BookmarkEntity) = bookmarkDao.insert(bookmark)

    /** 更新书签（编辑标题、URL、showOnHome 等） */
    suspend fun update(bookmark: BookmarkEntity) = bookmarkDao.update(bookmark)

    /** 删除书签 */
    suspend fun delete(bookmark: BookmarkEntity) = bookmarkDao.delete(bookmark)

    /**
     * 切换主页显示状态（便捷方法）。
     * @return 切换后的 showOnHome 值（供 UI 立即更新）
     */
    suspend fun toggleShowOnHome(bookmark: BookmarkEntity): Boolean {
        val updated = bookmark.copy(showOnHome = !bookmark.showOnHome)
        bookmarkDao.update(updated)
        return updated.showOnHome
    }
}
```

**TabRepository（完整方法签名）**：

```kotlin
package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.TabDao
import com.livingdashboard.data.entity.TabEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class TabRepository @Inject constructor(
    private val tabDao: TabDao
) {
    /** 所有标签页（按 sortOrder ASC，等价于按创建顺序） */
    fun getAll(): Flow<List<TabEntity>> = tabDao.getAll()

    /**
     * 按 ID 观察单个标签页（返回 Flow，支持 ViewModel 持续收集）。
     * 注意：TabDao.getByIdFlow 返回 Flow<TabEntity?>，DAO 层需用 @Query + Flow 返回类型。
     */
    fun getById(id: String): Flow<TabEntity?> = tabDao.getByIdFlow(id)

    /** 插入新标签页 */
    suspend fun insert(tab: TabEntity) = tabDao.insert(tab)

    /** 更新标签页（全字段） */
    suspend fun update(tab: TabEntity) = tabDao.update(tab)

    /** 删除标签页 */
    suspend fun delete(tab: TabEntity) = tabDao.delete(tab)

    /** 删除所有标签页 */
    suspend fun deleteAll() = tabDao.deleteAll()

    /** 仅更新 URL（便捷方法，BrowserViewModel.onUrlChange 调用） */
    suspend fun updateUrl(tabId: String, url: String) {
        tabDao.updateUrl(tabId, url)
    }

    /** 仅更新标题（便捷方法，BrowserViewModel.onTitleChange 调用） */
    suspend fun updateTitle(tabId: String, title: String) {
        tabDao.updateTitle(tabId, title)
    }
}
```

**TabDao 补充方法（NC6，配合 TabRepository）**：

> 原 Spec 3.1.3 节 TabDao 缺少 `getByIdFlow` 和 `updateUrl`/`updateTitle`，需补充：

```kotlin
@Dao
interface TabDao {
    @Insert suspend fun insert(tab: TabEntity)
    @Update suspend fun update(tab: TabEntity)
    @Delete suspend fun delete(tab: TabEntity)
    @Query("DELETE FROM tabs") suspend fun deleteAll()

    @Query("SELECT * FROM tabs ORDER BY sortOrder ASC")
    fun getAll(): Flow<List<TabEntity>>

    /** NC6：按 ID 查询单个标签（返回 Flow，供 ViewModel 持续观察） */
    @Query("SELECT * FROM tabs WHERE id = :id")
    fun getByIdFlow(id: String): Flow<TabEntity?>

    /** NC6：仅更新 URL（便捷方法，避免全字段 update） */
    @Query("UPDATE tabs SET url = :url WHERE id = :tabId")
    suspend fun updateUrl(tabId: String, url: String)

    /** NC6：仅更新标题（便捷方法，避免全字段 update） */
    @Query("UPDATE tabs SET title = :title WHERE id = :tabId")
    suspend fun updateTitle(tabId: String, title: String)
}
```

**HistoryDao 补充方法（NC6，配合 HistoryRepository.recordVisit）**：

> 原 Spec 3.1.2 节 HistoryDao 的 `insert` 描述为"插入前先查同 URL"，但去重逻辑应在 Repository 层（DAO 不应含业务逻辑）。明确 DAO 方法：

```kotlin
@Dao
interface HistoryDao {
    @Insert suspend fun insert(history: HistoryEntity)
    @Update suspend fun update(history: HistoryEntity)
    @Delete suspend fun delete(history: HistoryEntity)
    @Query("DELETE FROM history") suspend fun deleteAll()

    @Query("SELECT * FROM history ORDER BY visitedAt DESC")
    fun getAll(): Flow<List<HistoryEntity>>

    @Query("SELECT * FROM history WHERE url = :url LIMIT 1")
    suspend fun findByUrl(url: String): HistoryEntity?

    @Query("SELECT * FROM history WHERE title LIKE '%' || :query || '%' OR url LIKE '%' || :query || '%' ORDER BY visitedAt DESC")
    fun search(query: String): Flow<List<HistoryEntity>>
}
```

**说明**：
- Repository 用 `@Inject constructor` 注入 DAO，由 `AppModule` 的 `@Provides` 提供（见 3.6 节）
- `HistoryRepository.recordVisit` 实现去重逻辑（同 URL 合并，visitCount++），与 3.1.2 节"去重逻辑（统一为'同 URL 合并'，不限天）"一致
- `TabRepository.getById` 返回 `Flow<TabEntity?>`，配合 `BrowserViewModel.init` 中的 `tabRepository.getById(tabId).collect`
- `TabRepository.updateUrl`/`updateTitle` 是便捷方法，避免全字段 update（只更新变化的字段）

### 3.2 浏览器引擎层

#### 3.2.1 LivingWebView（WebView 封装）

> **NC2 修复**：原 Spec 声称"闭包自动捕获最新值"是技术性错误。Kotlin 闭包捕获的是首次 `remember` 执行时的参数引用，不会自动更新。必须用 `rememberUpdatedState` 包装每个回调，确保 `remember` 块内的 Client 回调通过 delegate 读取最新值。
>
> **NC4 修复**：原 `LivingWebView` 只有 outward 回调，没有 inward 控制接口（goBack、goForward、reload、stopLoading）。新增 `WebViewController` 类，`LivingWebView` 增加可选 `controller` 参数，BottomBar 的后退/前进按钮通过 controller 控制 WebView。

**WebViewController 设计（NC4）**：

```kotlin
package com.livingdashboard.browser

import android.webkit.WebView

/**
 * WebView 控制器（NC4）：暴露 inward 控制接口（goBack/goForward/reload/stopLoading/loadUrl）。
 *
 * 设计要点：
 * - `webViewRef` 是 `internal var`，由 `LivingWebView` 在 `remember` 块中赋值，`onDispose` 时置 null
 * - 调用方（BrowserScreen）用 `rememberWebViewState()` 创建实例，传给 `LivingWebView`
 * - 所有方法做空判断（`webViewRef?.let { ... }`），避免 controller 在 WebView 销毁后被调用导致 NPE
 * - 不持有 Activity/Context 引用，避免内存泄漏（WebView 本身由 LivingWebView 管理生命周期）
 */
class WebViewController {
    internal var webViewRef: WebView? = null

    fun goBack() { webViewRef?.takeIf { it.canGoBack() }?.goBack() }
    fun goForward() { webViewRef?.takeIf { it.canGoForward() }?.goForward() }
    fun reload() { webViewRef?.reload() }
    fun stopLoading() { webViewRef?.stopLoading() }
    fun loadUrl(url: String) { webViewRef?.loadUrl(url) }

    /** 当前 URL（供调用方查询，例如地址栏显示） */
    val currentUrl: String? get() = webViewRef?.url
}

/** Composable 便捷创建函数，用 remember 缓存 controller 实例 */
@Composable
fun rememberWebViewController(): WebViewController = remember { WebViewController() }
```

**LivingWebView Composable（NC2 + NC4 修正版）**：

```kotlin
@Composable
fun LivingWebView(
    url: String,
    onUrlChange: (String) -> Unit,
    onTitleChange: (String) -> Unit,
    onProgressChange: (Int) -> Unit,
    onBackForwardStateChange: (canGoBack: Boolean, canGoForward: Boolean) -> Unit,
    onFaviconChange: (Bitmap?) -> Unit = {},
    onError: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    uaMode: UaMode = UaMode.MOBILE,
    javaScriptEnabled: Boolean = true,
    controller: WebViewController? = null  // NC4：可选控制器，传入后可外部调用 goBack/goForward 等
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // NC2：用 rememberUpdatedState 包装回调，确保 remember 块内总能拿到最新引用。
    // Kotlin 闭包捕获的是首次 remember 执行时的参数引用，不会自动更新；
    // rememberUpdatedState 返回的 State<T> 会在每次重组时更新，闭包通过 .value 读取最新值。
    val currentOnUrlChange by rememberUpdatedState(onUrlChange)
    val currentOnTitleChange by rememberUpdatedState(onTitleChange)
    val currentOnProgressChange by rememberUpdatedState(onProgressChange)
    val currentOnBackForwardStateChange by rememberUpdatedState(onBackForwardStateChange)
    val currentOnFaviconChange by rememberUpdatedState(onFaviconChange)
    val currentOnError by rememberUpdatedState(onError)

    // 用 remember 缓存 WebView 实例，避免重组时重建
    val webView = remember {
        // 用 applicationContext 创建避免 Activity 泄漏；UI 操作（如 Dialog）由调用方处理
        WebView(context.applicationContext).apply {
            settings.javaScriptEnabled = javaScriptEnabled
            settings.domStorageEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            // UA 字符串（见下方 M19 说明）
            settings.userAgentString = if (uaMode == UaMode.DESKTOP) {
                DESKTOP_UA
            } else {
                MOBILE_UA
            }
            // NC2：Client 在 factory 中创建一次，回调通过 rememberUpdatedState 的 delegate 读取最新值
            webViewClient = LivingWebViewClient(
                onUrlChange = { currentOnUrlChange(it) },
                onBackForwardStateChange = { b, f -> currentOnBackForwardStateChange(b, f) },
                onPageFinished = { u, t -> currentOnTitleChange(t) },
                onError = { currentOnError(it) }
            )
            webChromeClient = LivingWebChromeClient(
                onProgressChange = { currentOnProgressChange(it) },
                onTitleChange = { currentOnTitleChange(it) },
                onFaviconChange = { currentOnFaviconChange(it) }
            )
            // DownloadListener：M1 仅 Toast 提示
            setDownloadListener { url, _, _, _, _ ->
                Toast.makeText(context, "下载功能暂未实现（M7）", Toast.LENGTH_SHORT).show()
            }
            // NC4：把 WebView 引用赋给 controller，供外部调用 goBack/goForward 等
            controller?.webViewRef = this
        }
    }

    // WebView 生命周期管理（C5 + M27）
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> webView.onPause()
                Lifecycle.Event.ON_RESUME -> webView.onResume()
                Lifecycle.Event.ON_DESTROY -> webView.destroy()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            // NC4：清除 controller 的 WebView 引用，避免 controller 在 WebView 销毁后被调用
            controller?.webViewRef = null
            webView.destroy()  // 防止内存泄漏
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { webView },  // 传入已创建并配置好的 WebView
        update = { wv ->
            // URL 变化时只调用 loadUrl，不重建 client
            if (url.isNotBlank() && wv.url != url) {
                wv.loadUrl(url)
            }
        }
    )
}
```

**关键设计**：
- **WebView 实例用 `remember` 缓存**：避免 Compose 重组时重建 WebView，保留页面状态
- **NC2：用 `rememberUpdatedState` 确保回调引用最新**：`remember` 块内的 Client 回调通过 `currentOnXxx`（`by rememberUpdatedState`）读取最新引用，避免闭包捕获旧值导致回调失效。**注意**：Kotlin 闭包捕获的是首次 `remember` 执行时的参数引用，不会自动更新，必须用 `rememberUpdatedState` 包装
- **NC4：`WebViewController` 提供 inward 控制**：`controller?.webViewRef = this` 在 `remember` 块中赋值，`onDispose` 中置 null；调用方通过 `controller.goBack()`/`goForward()` 控制 WebView
- **`update` 块只处理 URL 变化**：不重建 client，避免回调丢失
- **生命周期管理**：用 `DisposableEffect(lifecycleOwner)` 监听 `ON_PAUSE`/`ON_RESUME`/`ON_DESTROY`，`onDispose` 调用 `webView.destroy()` 防止内存泄漏
- **Context 用 `applicationContext`**：避免 WebView 持有 Activity 引用导致泄漏；UI 操作（如 Toast、Dialog）由调用方用 `LocalContext.current`（Activity Context）处理

**关键配置**：
- `javaScriptEnabled = true`（可由设置控制）
- `domStorageEnabled = true`
- `useWideViewPort = true` + `loadWithOverviewMode = true`（适配移动端视口）
- `userAgentString`：默认移动端 UA，设置可切桌面 UA
- `cacheMode = WebSettings.LOAD_DEFAULT`
- `setSupportZoom(true)` + `builtInZoomControls = true` + `displayZoomControls = false`

**UA 字符串（M19）**：

```kotlin
/** 移动端 UA（默认）— 在系统 UA 后追加 App 标识，便于网站识别 */
const val MOBILE_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Mobile Safari/537.36 LivingDashboard/1.0"

/** 桌面端 UA — 用于"请求桌面版网站" */
const val DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36 LivingDashboard/1.0"
```

**说明**：UA 字符串以主流 Chrome 120 为基础，末尾追加 `LivingDashboard/1.0` 便于网站统计识别。`uaMode` 由 `SettingsStore.uaMode` Flow 驱动，切换时需重建 WebView（M1 简化：切换 UA 后提示用户重启标签页生效；M7 可热切换）。

#### 3.2.2 LivingWebViewClient

```kotlin
class LivingWebViewClient(
    private val onUrlChange: (String) -> Unit,
    private val onBackForwardStateChange: (Boolean, Boolean) -> Unit,
    private val onPageFinished: (String, String) -> Unit,  // url, title
    private val onError: (String) -> Unit = {}
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url
        val scheme = url.scheme?.lowercase()
        return when (scheme) {
            "http", "https" -> {
                // WebView 自己加载，回调通知地址栏更新
                onUrlChange(url.toString())
                false
            }
            "tel", "mailto", "sms", "intent", "market", "weixin", "alipays" -> {
                // 非 http/https scheme：启动外部 Activity 拦截
                try {
                    val intent = Intent(Intent.ACTION_VIEW, url)
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    view.context.startActivity(intent)
                } catch (e: ActivityNotFoundException) {
                    Log.w("LivingWebView", "No app to handle scheme: $scheme", e)
                    onError("没有应用可以打开此链接（$scheme）")
                } catch (e: Exception) {
                    Log.w("LivingWebView", "Failed to launch external intent for $url", e)
                    onError("打开外部应用失败")
                }
                true  // 拦截，不让 WebView 处理
            }
            else -> {
                // 未知 scheme：交给系统处理，但拦截避免 WebView 报错
                try {
                    val intent = Intent(Intent.ACTION_VIEW, url)
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    view.context.startActivity(intent)
                    true
                } catch (e: Exception) {
                    Log.w("LivingWebView", "Unknown scheme $scheme, cannot handle", e)
                    false  // 让 WebView 走默认行为
                }
            }
        }
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        val title = view.title ?: ""
        onPageFinished(url, title)
        onBackForwardStateChange(view.canGoBack(), view.canGoForward())
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        onUrlChange(url)
        onBackForwardStateChange(view.canGoBack(), view.canGoForward())
    }

    /** 网络错误回调（C10） */
    override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
    ) {
        super.onReceivedError(view, request, error)
        // 只处理主帧错误，子资源错误不打扰用户
        if (request != null && request.isForMainFrame) {
            val msg = error?.description?.toString() ?: "未知错误"
            Log.w("LivingWebView", "onReceivedError: ${request.url} -> $msg")
            onError("页面加载失败：$msg")
        }
    }

    /** SSL 错误回调（C10）— M1 简化：取消加载 + 提示，不弹证书选择 */
    override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
        super.onReceivedSslError(view, handler, error)
        Log.w("LivingWebView", "onReceivedSslError: ${error?.url} -> ${error?.primaryError}")
        handler?.cancel()
        onError("SSL 证书错误，已停止加载")
    }
}
```

**关键设计**：
- **`shouldOverrideUrlLoading`**：对 `http/https` 不拦截；对 `tel:`/`mailto:`/`sms:`/`intent:`/`market:` 等用 `Intent(ACTION_VIEW)` 启动外部 Activity 并返回 `true` 拦截，避免 WebView 报错；启动失败时回调 `onError` 提示用户
- **`onReceivedError`**：只处理主帧错误，子资源错误（图片、CSS 等）不打扰用户
- **`onReceivedSslError`**：M1 简化为 `handler.cancel()` + 错误提示，不弹证书选择对话框（M7 增强）

#### 3.2.3 LivingWebChromeClient

```kotlin
class LivingWebChromeClient(
    private val onProgressChange: (Int) -> Unit,
    private val onTitleChange: (String) -> Unit,
    private val onFaviconChange: (Bitmap?) -> Unit,
    // 以下回调用于文件选择、JS 对话框、权限请求（C10）
    private val onShowFileChooser: (Intent, ValueCallback<Array<Uri>>) -> Boolean = { _, _ -> false },
    private val onJsAlert: (String, String) -> Boolean = { _, _ -> false },
    private val onJsConfirm: (String, String) -> Boolean = { _, _ -> false },
    private val onPermissionRequest: (Array<String>) -> Boolean = { false }  // 默认拒绝
) : WebChromeClient() {

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        onProgressChange(newProgress)
    }

    override fun onReceivedTitle(view: WebView, title: String?) {
        title?.let { onTitleChange(it) }
    }

    override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
        onFaviconChange(icon)
    }

    /** 文件选择（input type=file）回调（C10） */
    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?
    ): Boolean {
        val intent = fileChooserParams?.createIntent() ?: return false
        // 实际使用时，调用方需用 rememberLauncherForActivityResult 接管
        // 这里通过回调把 intent 和 callback 交给 Composable 处理
        return if (filePathCallback != null) {
            onShowFileChooser(intent, filePathCallback)
        } else {
            false
        }
    }

    /** JS alert 对话框（C10）— M1 简化：交给调用方用 Compose Dialog 实现 */
    override fun onJsAlert(
        view: WebView?, url: String?, message: String?, result: JsResult?
    ): Boolean {
        if (url != null && message != null) {
            val handled = onJsAlert(url, message)
            if (handled) {
                result?.confirm()
                return true
            }
        }
        return false  // 走系统默认
    }

    /** JS confirm 对话框（C10） */
    override fun onJsConfirm(
        view: WebView?, url: String?, message: String?, result: JsResult?
    ): Boolean {
        if (url != null && message != null) {
            val handled = onJsConfirm(url, message)
            if (handled) {
                // 调用方需根据用户选择调用 result.confirm()/cancel()
                return true
            }
        }
        return false
    }

    /** 权限请求（C10）— M1 默认拒绝，M7 增强 */
    override fun onPermissionRequest(request: PermissionRequest?) {
        // M1 默认拒绝所有 WebView 权限请求（地理位置、摄像头等），避免权限滥用
        request?.deny()
    }
}
```

**调用方使用示例**（在 `BrowserScreen` 中）：

```kotlin
// 文件选择 launcher
val fileChooserLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
) { result ->
    val data = result.data
    val uri = data?.data
    pendingFileChooserCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
    pendingFileChooserCallback = null
}

// JS Alert Dialog 状态
var jsAlertMessage by remember { mutableStateOf<String?>(null) }
jsAlertMessage?.let { msg ->
    AlertDialog(
        onDismissRequest = { jsAlertMessage = null },
        text = { Text(msg) },
        confirmButton = {
            TextButton(onClick = { jsAlertMessage = null }) { Text("确定") }
        }
    )
}
```

**说明**：M1 对 JS 对话框和文件选择做基本实现（能用），M7 增强（多文件选择、文件类型过滤、JS prompt 等）。`onPermissionRequest` 默认拒绝，避免 M1 引入复杂权限流程。

#### 3.2.4 CookieManagerWrapper 封装

> **文件名**：`browser/CookieManagerWrapper.kt`（与类名一致，避免与 Android 系统 `android.webkit.CookieManager` 混淆）

```kotlin
class CookieManagerWrapper {
    private val cm = CookieManager.getInstance()

    init { cm.setAcceptCookie(true) }

    fun getCookies(url: String): String = cm.getCookie(url) ?: ""
    fun setCookie(url: String, cookie: String) { cm.setCookie(url, cookie); cm.flush() }
    fun removeAllCookies() { cm.removeAllCookies(null); cm.flush() }
    fun flush() { cm.flush() }
}
```

#### 3.2.5 DefaultBrowserHelper

> **DI 策略**：`DefaultBrowserHelper` **不走 Hilt DI**（需要 `Activity` 引用，Hilt 通常注入 `ApplicationContext`）。改为在 Composable 中用 `remember` 创建，或用顶层函数接收 `Activity` 参数。

**方案 A：顶层函数 + Activity 参数**（推荐，最简单）

```kotlin
package com.livingdashboard.browser

/** 判断当前 App 是否已设为默认浏览器 */
fun isDefaultBrowser(activity: Activity): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val roleManager = activity.getSystemService(Context.ROLE_SERVICE) as RoleManager
    return roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)
}

/**
 * 请求设为默认浏览器。
 * - Android 10+：用 RoleManager，需通过 ActivityResultLauncher 接收回调
 * - Android <10：降级打开系统"默认应用"设置页
 */
fun requestDefaultBrowserRole(
    activity: Activity,
    activityResultLauncher: ActivityResultLauncher<Intent>
) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        // 降级：打开系统默认应用设置
        val intent = Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
        activity.startActivity(intent)
        return
    }
    val roleManager = activity.getSystemService(Context.ROLE_SERVICE) as RoleManager
    val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
    activityResultLauncher.launch(intent)
}
```

**方案 B：包装类 + remember**（如果需要在多处复用）

```kotlin
class DefaultBrowserHelper(private val activity: Activity) {
    fun isDefaultBrowser(): Boolean = com.livingdashboard.browser.isDefaultBrowser(activity)
    fun requestDefaultBrowserRole(launcher: ActivityResultLauncher<Intent>) =
        com.livingdashboard.browser.requestDefaultBrowserRole(activity, launcher)
}
```

**Composable 中使用示例**（含 `rememberLauncherForActivityResult`）：

```kotlin
@Composable
fun DefaultBrowserSettingItem() {
    val context = LocalContext.current
    val activity = context as Activity  // Composable 顶层确保是 Activity Context

    // 用 remember 缓存 Helper，避免重组重建
    val helper = remember { DefaultBrowserHelper(activity) }

    // 注册 ActivityResultLauncher 接收 RoleManager 回调
    val roleLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            Toast.makeText(context, "已设为默认浏览器", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(context, "未设为默认浏览器", Toast.LENGTH_SHORT).show()
        }
    }

    SettingItem(
        title = "设为默认浏览器",
        onClick = { helper.requestDefaultBrowserRole(roleLauncher) }
    )
}
```

**关键设计**：
- **不走 Hilt DI**：因为需要 `Activity`（不是 `ApplicationContext`），Hilt 注入 Activity 不便
- **`remember` 缓存**：在 Composable 中用 `remember { DefaultBrowserHelper(activity) }` 避免重组重建
- **`rememberLauncherForActivityResult`**：标准的 Compose Activity Result 用法，替代已废弃的 `startActivityForResult`
- **降级逻辑**：Android <10 没有 RoleManager，直接打开系统设置页

### 3.3 UI 层

#### 3.3.1 导航图（AppNavGraph）

```
NavHost(startDestination = "home") {
    composable("home") { BrowserHomeScreen(...) }          // 浏览器主页
    composable("browser/{tabId}") { BrowserScreen(...) }   // WebView 浏览器
    composable("tabs") { TabManagerScreen(...) }           // 标签页管理
    composable("bookmarks") { BookmarkScreen(...) }        // 书签管理
    composable("history") { HistoryScreen(...) }           // 历史记录
    composable("settings") { SettingsScreen(...) }         // 设置
}
```

**导航触发**：
- 主页搜索框点击 → 创建新标签页 → 导航到 `browser/{tabId}`
- 主页快捷图标点击 → 创建新标签页（带 URL）→ 导航到 `browser/{tabId}`
- 底部栏 Home 键 → 导航到 `home`
- 底部栏标签键 → 导航到 `tabs`
- 更多菜单 → 导航到对应页面

**创建标签时序（M22）**：

> **关键**：必须按"先生成 UUID → 插入 Room → 导航"的顺序，保证导航到 `browser/{tabId}` 时该 tabId 已存在于 Room，避免 `BrowserViewModel` 初始化时查不到标签。

```kotlin
@Composable
fun BrowserHomeScreen(
    onNavigateToBrowser: (String) -> Unit,
    viewModel: BrowserHomeViewModel = hiltViewModel()
) {
    val scope = rememberCoroutineScope()
    // ...
    SearchBar(
        onSearch = { input ->
            val url = buildUrlFromInput(input, viewModel.searchEngine)
            scope.launch {
                // 1. 先生成 UUID
                val newTabId = UUID.randomUUID().toString()
                // 2. 插入 Room
                val tab = TabEntity(
                    id = newTabId,
                    title = "新标签页",
                    url = url,
                    sortOrder = System.currentTimeMillis().toInt()
                )
                viewModel.createTab(tab)  // suspend，等 Room 写入完成
                // 3. 导航（此时 tabId 已存在）
                onNavigateToBrowser(newTabId)
            }
        }
    )
}
```

**反模式（避免）**：
- ❌ 先导航再插入 Room：`BrowserViewModel` 初始化时 `getById(tabId)` 返回 null，UI 状态异常
- ❌ 在 `BrowserViewModel.init` 中创建标签：职责不清，且导航参数 tabId 应已存在

#### 3.3.2 浏览器主页（BrowserHomeScreen）

**布局**（类 Via）：
```
┌─────────────────────────────┐
│      [可自定义背景图]        │
│                             │
│      [Logo]                 │  ← Logo/书签一体头部
│      🔍 搜索框              │
│                             │
│   📌 常用网站               │  ← 书签 showOnHome=true
│   ◯ ◯ ◯ ◯                  │
│                             │
└─────────────────────────────┘
│ [←][→] [Home] [标签] [⋮]    │  ← 底部栏
└─────────────────────────────┘
```

**ViewModel 状态**：
```kotlin
data class BrowserHomeUiState(
    val homeShortcuts: List<BookmarkEntity> = emptyList(),
    val searchEngine: SearchEngine = SearchEngine.BAIDU,
    val backgroundUri: String? = null,
    val logoUri: String? = null
)
```

**搜索框行为**：
- 输入文本，点搜索/回车 → 判断是 URL 还是搜索词
  - 包含 `.` 且无空格 → 当 URL 处理（补全 `https://`）
  - 否则 → 搜索引擎拼接（`https://www.baidu.com/s?wd=xxx`）
- 创建新标签页，导航到浏览器页

**URL/搜索词判断逻辑**：
```kotlin
fun buildUrlFromInput(input: String, searchEngine: SearchEngine): String {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return ""
    // 已有协议
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
    // 看起来像域名（包含 . 且无空格）
    if (trimmed.contains(".") && !trimmed.contains(" ")) {
        return "https://$trimmed"
    }
    // 搜索词
    return searchEngine.buildSearchUrl(trimmed)
}
```

#### 3.3.3 浏览器页（BrowserScreen）

**布局**：
```
┌─────────────────────────────┐
│ 🔒 baidu.com          [⋮]  │  ← 地址栏（显示当前 URL，点击可编辑）
├─────────────────────────────┤
│ ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░  │  ← 加载进度条（顶部细条）
├─────────────────────────────┤
│                             │
│      WebView 内容区          │
│                             │
└─────────────────────────────┘
│ [←][→] [Home] [标签] [⋮]    │  ← 底部栏
└─────────────────────────────┘
```

**ViewModel（M3 + M25）**：

```kotlin
@HiltViewModel
class BrowserViewModel @Inject constructor(
    private val tabRepository: TabRepository,
    private val bookmarkRepository: BookmarkRepository,
    private val historyRepository: HistoryRepository,
    // M3：用 SavedStateHandle 获取导航参数 tabId
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    // 从导航参数获取 tabId（AppNavGraph 中定义 composable("browser/{tabId}")）
    private val tabId: String = checkNotNull(savedStateHandle.get<String>("tabId"))

    private val _uiState = MutableStateFlow(BrowserUiState())
    val uiState: StateFlow<BrowserUiState> = _uiState.asStateFlow()

    init {
        // 加载标签信息（旋转后 ViewModel 存活，currentUrl 保留，重新加载页面）
        viewModelScope.launch {
            tabRepository.getById(tabId).collect { tab ->
                _uiState.update { it.copy(tab = tab, currentUrl = tab?.url ?: "") }
            }
        }
        // NC4：收集标签总数，用于 BottomBar 徽章
        viewModelScope.launch {
            tabRepository.getAll().collect { tabs ->
                _uiState.update { it.copy(tabCount = tabs.size) }
            }
        }
    }

    fun onUrlChange(newUrl: String) {
        _uiState.update { it.copy(currentUrl = newUrl) }
        // 持久化到 Room
        viewModelScope.launch {
            tabRepository.updateUrl(tabId, newUrl)
        }
    }

    fun onTitleChange(title: String) {
        _uiState.update { it.copy(currentTitle = title) }
        viewModelScope.launch {
            tabRepository.updateTitle(tabId, title)
            // 同时记录历史
            historyRepository.recordVisit(_uiState.value.currentUrl, title)
        }
    }

    fun onProgressChange(progress: Int) {
        _uiState.update { it.copy(progress = progress) }
    }

    fun onBackForwardStateChange(canGoBack: Boolean, canGoForward: Boolean) {
        _uiState.update { it.copy(canGoBack = canGoBack, canGoForward = canGoForward) }
    }

    fun onError(message: String) {
        _uiState.update { it.copy(errorMessage = message) }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    // ... 其他方法（书签判断、reload 等）
}
```

**UI 状态**：
```kotlin
data class BrowserUiState(
    val tab: TabEntity? = null,
    val currentUrl: String = "",
    val currentTitle: String = "",
    val progress: Int = 100,
    val canGoBack: Boolean = false,
    val canGoForward: Boolean = false,
    val isBookmark: Boolean = false,
    val favicon: Bitmap? = null,
    val errorMessage: String? = null,
    val tabCount: Int = 0  // NC4：BottomBar 标签按钮徽章用
)
```

> **tabCount 来源**：`BrowserViewModel` 在 `init` 中收集 `tabRepository.getAll()`，map 成 size 更新到 `uiState.tabCount`。这样 BottomBar 的标签按钮能实时显示标签数量。

**Composable 中使用 `hiltViewModel()`（M3 + M25 + NC4）**：

```kotlin
@Composable
fun BrowserScreen(
    onBackToHome: () -> Unit,
    onOpenTabs: () -> Unit,
    onOpenMore: () -> Unit
) {
    val viewModel: BrowserViewModel = hiltViewModel()  // 自动注入 SavedStateHandle
    val uiState by viewModel.uiState.collectAsState()

    // NC4：创建 WebViewController，传给 LivingWebView，供 BottomBar 调用 goBack/goForward
    val controller = rememberWebViewController()

    // ... 地址栏、进度条等

    LivingWebView(
        url = uiState.currentUrl,  // 旋转后从 ViewModel 重新加载
        onTitleChange = viewModel::onTitleChange,
        onProgressChange = { progress -> viewModel.onProgressChange(progress) },
        onUrlChange = viewModel::onUrlChange,
        onBackForwardStateChange = { back, forward -> viewModel.onBackForwardStateChange(back, forward) },
        onError = { msg -> viewModel.onError(msg) },
        controller = controller  // NC4：传入控制器
    )

    // NC4：BottomBar 的 onBack/onForward 调用 controller.goBack()/goForward()
    BottomBar(
        canGoBack = uiState.canGoBack,
        canGoForward = uiState.canGoForward,
        onBack = { controller.goBack() },       // NC4：直接调用 WebView.goBack()
        onForward = { controller.goForward() }, // NC4：直接调用 WebView.goForward()
        onHome = onBackToHome,
        onTabs = onOpenTabs,
        onMore = onOpenMore,
        tabCount = uiState.tabCount
    )
}
```

**NC4 关键说明**：
- `controller = rememberWebViewController()` 创建控制器实例，用 `remember` 缓存避免重组重建
- `LivingWebView` 内部在 `remember` 块中把 WebView 引用赋给 `controller.webViewRef`，`onDispose` 时置 null
- BottomBar 的 `onBack`/`onForward` 直接调用 `controller.goBack()`/`goForward()`，无需通过 ViewModel 中转（WebView 的导航栈是 UI 层状态，不应进 ViewModel）
- `canGoBack`/`canGoForward` 仍由 `LivingWebViewClient.onPageFinished` 回调更新到 ViewModel，用于 BottomBar 按钮置灰

**地址栏交互**：
- 默认显示当前 URL（隐藏协议 `https://`）
- 点击 → 变为可编辑，全选文本
- 输入新 URL/搜索词 → 回车加载
- 加载中显示进度条

**WebView 生命周期管理（C5 + M27）**：

完整生命周期管理在 `LivingWebView` Composable 内部实现（见 3.2.1 节），核心要点：

1. **`DisposableEffect(lifecycleOwner)`** 监听 `ON_PAUSE`/`ON_RESUME`/`ON_DESTROY`：
   - `ON_PAUSE` → `webView.onPause()`（暂停 JS 定时器、视频播放）
   - `ON_RESUME` → `webView.onResume()`（恢复）
   - `ON_DESTROY` → `webView.destroy()`（释放资源）
2. **`onDispose`** 调用 `webView.destroy()`：Composable 离开组合时清理，防止内存泄漏
3. **Context 用 `applicationContext`** 创建 WebView：避免 WebView 持有 Activity 引用导致泄漏
4. **UI 操作用 Activity Context**：Toast、Dialog 等用 `LocalContext.current`（Activity Context）
5. **标签切换时**：保存当前 URL/title 到 Room（ViewModel 负责），新标签从 Room 读 URL 重新加载

**内存泄漏防护（M27）**：
- WebView 是已知的 Android 内存泄漏高发点，常见原因是 WebView 持有 Activity Context
- 本方案用 `context.applicationContext` 创建 WebView，切断对 Activity 的强引用
- `DisposableEffect.onDispose` 确保 Composable 销毁时调用 `webView.destroy()`，即使 Activity 不销毁（如标签切换）也能释放
- `LifecycleEventObserver` 监听 `ON_DESTROY`，Activity 销毁时再次 `destroy()`（幂等）
- 不在 ViewModel 中持有 WebView 引用（WebView 是 UI 层资源，ViewModel 只持有 URL 等数据）

**旋转后重新加载（M20）**：

- Activity 旋转时，`BrowserScreen` Composable 会被销毁重建，但 `BrowserViewModel` 存活（ViewModel 范围）
- `LivingWebView` 的 `remember` 缓存失效（新 Composable 实例），WebView 重建
- 重建后 `LivingWebView` 的 `update` 块收到 `uiState.currentUrl`（来自 ViewModel），自动调用 `loadUrl(currentUrl)` 重新加载
- 用户感知：旋转后页面会重新加载（M1 简化，M7 用 `saveState`/`restoreState` 保留页面状态）

#### 3.3.4 标签页管理（TabManagerScreen）

**布局**：卡片网格（2 列），每张卡片显示：
- 网页标题
- URL（截断）
- 关闭按钮（×）

**操作**：
- 点击卡片 → 切换到该标签（导航到 `browser/{tabId}`）
- 关闭按钮 → 删除标签（如果最后一个标签，自动新建空白标签）
- 新建标签按钮 → 创建空白标签，导航到主页或浏览器页

#### 3.3.5 底部栏（BottomBar）

```kotlin
@Composable
fun BottomBar(
    canGoBack: Boolean = false,
    canGoForward: Boolean = false,
    onBack: () -> Unit,
    onForward: () -> Unit,
    onHome: () -> Unit,
    onTabs: () -> Unit,
    onMore: () -> Unit,
    tabCount: Int = 0
)
```

**5 按钮**：
- 后退（`Icons.Default.ArrowBack`）— 不可用时置灰
- 前进（`Icons.Default.ArrowForward`）— 不可用时置灰
- Home（`Icons.Default.Home`）
- 标签（`Icons.Default.Tab` + 数量徽章）
- 更多（`Icons.Default.MoreVert`）

**主页模式**：后退/前进按钮隐藏或置灰，Home 键高亮。

**NC4：后退/前进按钮的调用方式**：
- `onBack` / `onForward` 回调由 `BrowserScreen` 传入，内部调用 `controller.goBack()` / `controller.goForward()`（见 3.3.3 节 BrowserScreen 代码）
- `canGoBack` / `canGoForward` 由 `BrowserViewModel.uiState` 提供，用于按钮置灰（避免不可用时点击无响应）
- `WebViewController.goBack()` 内部已做空判断和 `canGoBack` 检查，双重保险

#### 3.3.6 更多菜单（MoreMenuSheet）

**ModalBottomSheet** 内容：
- 添加书签 / 查看书签
- 历史
- 下载（M1 占位，提示"暂未实现"）
- 分享（分享当前 URL）
- 复制链接
- 设置
- 设为默认浏览器
- 清除 Cookie
- 退出

#### 3.3.7 书签管理（BookmarkScreen）

**列表**：每项显示 title + URL + favicon
**操作**：
- 点击 → 打开书签
- 长按 → 编辑/删除/切换主页显示
- 添加书签按钮 → 输入 title + URL

#### 3.3.8 历史记录（HistoryScreen）

**列表**：按日期分组（今天/昨天/更早），每项显示 title + URL + 访问时间
**操作**：
- 点击 → 打开
- 长按 → 删除
- 清空全部按钮

#### 3.3.9 设置（SettingsScreen）

**分组**：
1. **主页定制**
   - 主题色（7 选项：1 个"跟随系统" + 6 色预设，点击切换）
   - 背景图（SAF 选图，清除背景图）
   - Logo（SAF 选图，恢复默认）
   - 显示常用网站（开关）
2. **浏览器设置**
   - 搜索引擎（百度/Google/Bing）
   - UA 模式（移动/桌面）
   - JavaScript 启用（开关）
3. **默认浏览器**
   - 设为默认浏览器（按钮）
4. **数据管理**
   - 清除 Cookie
   - 清除历史
   - 清除书签（危险操作，二次确认）
5. **调试信息**（C4：M0 HomeScreen 的 WS 信息迁移到此）
   - WS 连接状态（`WsState`：DISCONNECTED/CONNECTING/CONNECTED/RECONNECTING）
   - 设备 ID（来自 `DeviceAuth.getDeviceId()`）
   - 服务器地址（来自 `ServerConfig.getDisplayUrl()`）
   - 最近 WS 消息（最近 20 条，`ServerMessage` 转可读字符串，用于调试）
   - 重新连接 WS 按钮（调用 `wsClient.disconnect()` + `wsClient.connect()`）

**C4：MainActivity 改造与 WS 功能保留**

> **核心原则**：M0 的 WS 连接逻辑（`LivingDashboardApp` + `WsClient` 注入）**完全保留不动**，只迁移 WS 状态信息的展示位置。

**M0 HomeScreen 处理**：
- M0 的 `ui/home/HomeScreen.kt` 改名为 `M0HomeScreen.kt`，归档到 `ui/debug/` 目录
- 或直接删除（WS 信息已迁移到设置页"调试信息"分组）
- **推荐方案**：归档到 `ui/debug/M0HomeScreen.kt`，保留作为调试参考，不在导航图中注册

**MainActivity 改造**：
- `@Inject lateinit var wsClient: WsClient` 等 M0 注入**保留**
- `LivingDashboardApp`（Application 类）**不改**，WS 连接初始化逻辑保留
- `setContent` 内容从 M0 的 `HomeScreen` 改为 `MainActivityContent`（含导航图）
- WS 状态信息通过 `WsClient` 的 Flow 暴露，`SettingsViewModel` 收集后展示在"调试信息"分组

**SettingsViewModel 收集 WS 状态**（NC1 修复：使用 M0 真实 API）

> **关键**：M0 的 `WsClient` 实际 API 为：
> - `wsClient.state: StateFlow<WsState>`（**不是** `connectionState`）
> - `wsClient.messages: SharedFlow<ServerMessage>`（**不是** `lastMessage: StateFlow<String?>`）
> - 没有 `wsClient.deviceId`（在 `DeviceAuth.getDeviceId()`）
> - 没有 `wsClient.serverAddress`（在 `ServerConfig.getDisplayUrl()`）
> - 没有 `wsClient.reconnect()`（只有 `connect()` 和 `disconnect()`）
>
> 因此 `SettingsViewModel` 必须同时注入 `WsClient` + `DeviceAuth` + `ServerConfig` 三个依赖。

```kotlin
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsStore: SettingsStore,
    private val cookieManager: CookieManagerWrapper,
    private val historyRepository: HistoryRepository,
    private val bookmarkRepository: BookmarkRepository,
    private val wsClient: WsClient,        // M0 注入，保留
    private val deviceAuth: DeviceAuth,    // NC1：注入 DeviceAuth 获取 deviceId
    private val serverConfig: ServerConfig // NC1：注入 ServerConfig 获取服务器地址
) : ViewModel() {

    // WS 连接状态：直接暴露 M0 的 WsState（DISCONNECTED/CONNECTING/CONNECTED/RECONNECTING）
    val wsConnectionState: StateFlow<WsState> = wsClient.state

    // 设备 ID：DeviceAuth.getDeviceId() 是同步函数（首次会生成并持久化）
    val deviceId: String = deviceAuth.getDeviceId()

    // 服务器地址：ServerConfig.getDisplayUrl() 返回 BuildConfig.WS_URL
    val serverAddress: String = serverConfig.getDisplayUrl()

    // 最近 WS 消息：M0 的 messages 是 SharedFlow<ServerMessage>（无 replay），
    // 在 ViewModel 中转成可读字符串列表（保留最近 20 条用于调试）
    private val _recentMessages = MutableStateFlow<List<String>>(emptyList())
    val recentMessages: StateFlow<List<String>> = _recentMessages.asStateFlow()

    init {
        // 收集 SharedFlow，把 ServerMessage 转成可读字符串
        viewModelScope.launch {
            wsClient.messages.collect { msg ->
                val readable = formatServerMessage(msg)
                _recentMessages.update { current ->
                    (current + readable).takeLast(20)
                }
            }
        }
    }

    /** 把 ServerMessage 转成可读字符串（调试用） */
    private fun formatServerMessage(msg: ServerMessage): String {
        return when (msg) {
            is ServerMessage.ToolCall -> "ToolCall(${msg.tool}, requestId=${msg.requestId})"
            is ServerMessage.PiEvent -> "PiEvent(${msg.event})"
            is ServerMessage.SessionReady -> "SessionReady(sessionId=${msg.sessionId})"
            is ServerMessage.Error -> "Error(${msg.message})"
            is ServerMessage.Pong -> "Pong"
            is ServerMessage.Change -> "Change(${msg.changeType})"
        }
    }

    /**
     * 重新连接 WS。
     * M0 的 WsClient 没有 reconnect() 方法，用 disconnect() + connect() 组合实现。
     *
     * 注意：disconnect() 会调用 scope.cancel()，connect() 内部会重建 scope（见 WsClient.kt L69-71）。
     * 这里用 launch 包裹，避免阻塞 UI；delay 100ms 给 disconnect 完成时间。
     */
    fun reconnectWs() {
        viewModelScope.launch {
            wsClient.disconnect()
            // 给 disconnect 完成时间（scope.cancel + ws.close）
            kotlinx.coroutines.delay(100)
            wsClient.connect()
        }
    }
    // ... 其他设置方法
}
```

**M1 对 M0 `WsClient.kt` 的修改建议（可选优化，NC1）**：

> 当前 `WsClient` 没有 `reconnect()` 方法，`SettingsViewModel.reconnectWs()` 用 `disconnect() + connect()` 组合实现。M1 编码阶段建议在 `WsClient.kt` 中补一个 `reconnect()` 方法，封装上述逻辑，让调用方更简洁：
>
> ```kotlin
> // 在 WsClient.kt 中新增（M1 编码阶段补）
> fun reconnect() {
>     disconnect()
>     // 用新 scope 启动，避免 cancel 后无法 delay
>     scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
>     scope.launch {
>         delay(100)
>         connect()
>     }
> }
> ```
>
> 如果补了 `reconnect()`，`SettingsViewModel.reconnectWs()` 可简化为 `wsClient.reconnect()`。**但 M1 Spec 不强制要求修改 M0 代码**，`disconnect() + connect()` 组合也能工作。

### 3.4 主题色定制

> **与 M0 dynamicColor 的关系（C3）**：M0 启用了 `dynamicColor`（Android 12+ 跟随系统壁纸取色）。M1 引入预设主题色后，**当用户选择预设主题色（`themeColorIndex >= 0`）时，必须禁用 `dynamicColor`**，否则两者会冲突（dynamicColor 覆盖 primary 色）。默认值 `themeColorIndex = -1` 保留 `dynamicColor` 行为。

**6 色预设**：

```kotlin
val ThemeColors = listOf(
    Color(0xFF6650a4),  // 紫色（M0 Purple40，默认主题色）
    Color(0xFF0066CC),  // 蓝色
    Color(0xFF00897B),  // 青色
    Color(0xFFE65100),  // 橙色
    Color(0xFFC62828),  // 红色
    Color(0xFF2E7D32)   // 绿色
)
```

**颜色值统一**：紫色用 M0 的 `Purple40 = Color(0xFF6650a4)`（来自 `ui/theme/Color.kt`），保证 M0/M1 视觉一致。

**Theme.kt 改造**：

```kotlin
@Composable
fun LivingDashboardTheme(
    themeColorIndex: Int = -1,  // -1=跟随系统 dynamicColor，0..5=预设主题色
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,  // 默认开启，但 themeColorIndex >= 0 时强制关闭
    content: @Composable () -> Unit
) {
    // 关键：选择预设主题色时，禁用 dynamicColor
    val useDynamicColor = dynamicColor && themeColorIndex < 0 &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val colorScheme = when {
        useDynamicColor -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context)
            else dynamicLightColorScheme(context)
        }
        themeColorIndex >= 0 -> {
            val baseColor = ThemeColors.getOrElse(themeColorIndex) { ThemeColors[0] }
            if (darkTheme) {
                darkColorScheme(primary = baseColor)
            } else {
                lightColorScheme(primary = baseColor)
            }
        }
        else -> {
            // 兜底：用 M0 默认 Purple40
            val baseColor = ThemeColors[0]
            if (darkTheme) darkColorScheme(primary = baseColor)
            else lightColorScheme(primary = baseColor)
        }
    }
    MaterialTheme(colorScheme = colorScheme, typography = Typography, content = content)
}
```

**主题色传递**：在 `MainActivity` 顶层从 `MainViewModel.themeColorIndex` Flow 收集值，传给 `LivingDashboardTheme`（NC3 修正：不再直接声明 `val settingsStore: SettingsStore`，改为通过 `MainViewModel` 获取）：

```kotlin
@Composable
fun MainActivityContent(
    pendingExternalUrl: StateFlow<String?>,
    onExternalUrlConsumed: () -> Unit
) {
    // NC3：用 hiltViewModel 获取 MainViewModel（注入 SettingsStore）
    val mainViewModel: MainViewModel = hiltViewModel()
    val themeColorIndex by mainViewModel.themeColorIndex.collectAsState()

    LivingDashboardTheme(themeColorIndex = themeColorIndex) {
        // ... 导航图 + 外部 URL 处理（完整实现见 3.5 节）
    }
}
```

> **注意**：`MainActivityContent` 的完整实现（含外部 URL 处理、导航图）见 3.5 节。`MainViewModel` 类定义也见 3.5 节。

**说明**：
- `themeColorIndex = -1`（默认）→ 跟随系统 `dynamicColor`（Android 12+）或 M0 默认紫色
- `themeColorIndex = 0..5` → 用预设主题色，**强制 `dynamicColor = false`**
- 设置页"主题色"分组显示 7 个选项：1 个"跟随系统" + 6 个预设色

### 3.5 默认浏览器 Intent Filter

**AndroidManifest.xml** 改造：
```xml
<activity
    android:name=".ui.MainActivity"
    android:exported="true"
    android:launchMode="singleTop">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
    <!-- 接收外部 URL -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="http" />
        <data android:scheme="https" />
    </intent-filter>
</activity>
```

**MainActivity 接收 URL（完整实现，C9 + NC3）**：

`MainActivity` 用 `MutableStateFlow<String?>` 持有外部 URL，Composable 观察该 Flow 触发创建标签 + 导航。

> **NC3 修复**：原 Spec 中 `MainActivityContent` 直接声明 `val tabRepository: TabRepository` 是无法编译的伪代码（Composable 不能直接注入 Repository）。改为创建 `MainViewModel`（@HiltViewModel）注入 `TabRepository`，暴露 `suspend fun createTabForUrl(url: String): String` 方法（返回 tabId），`MainActivityContent` 用 `hiltViewModel<MainViewModel>()` 获取。

**MainViewModel 类定义（NC3，新文件 `ui/MainViewModel.kt`）**：

```kotlin
package com.livingdashboard.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.TabEntity
import com.livingdashboard.data.repository.TabRepository
import com.livingdashboard.data.prefs.SettingsStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/**
 * MainActivity 顶层 ViewModel（NC3）。
 *
 * 职责：
 * 1. 处理外部 URL（ACTION_VIEW Intent）→ 创建标签页 → 返回 tabId 供导航
 * 2. 暴露主题色索引 Flow（供 LivingDashboardTheme 使用）
 *
 * 不持有 WebView/Activity 引用，纯数据层逻辑。
 */
@HiltViewModel
class MainViewModel @Inject constructor(
    private val tabRepository: TabRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    /** 主题色索引（-1=跟随系统 dynamicColor，0..5=预设主题色），供 MainActivityContent 应用主题 */
    val themeColorIndex: StateFlow<Int> = settingsStore.themeColorIndex
        .stateIn(viewModelScope, SharingStarted.Eagerly, -1)

    /**
     * 为外部 URL 创建新标签页，返回 tabId。
     * 时序：先生成 UUID → 插入 Room → 返回 tabId（调用方拿到 tabId 后再导航）。
     *
     * @param url 外部 URL（http/https）
     * @return tabId（UUID 字符串）
     */
    suspend fun createTabForUrl(url: String): String {
        val newTabId = UUID.randomUUID().toString()
        val tab = TabEntity(
            id = newTabId,
            title = "新标签页",
            url = url,
            sortOrder = System.currentTimeMillis().toInt()
        )
        tabRepository.insert(tab)  // suspend，等 Room 写入完成
        return newTabId
    }
}
```

**MainActivity 改造**：

```kotlin
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var wsClient: WsClient  // M0 保留
    // ... 其他 M0 注入保留

    // 持有外部 URL（来自 ACTION_VIEW Intent）
    private val _pendingExternalUrl = MutableStateFlow<String?>(null)
    val pendingExternalUrl: StateFlow<String?> = _pendingExternalUrl.asStateFlow()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // M0 WS 连接逻辑保留不动
        setContent {
            MainActivityContent(
                pendingExternalUrl = pendingExternalUrl,
                onExternalUrlConsumed = { _pendingExternalUrl.value = null }
            )
        }
        // 处理启动 Intent（从外部点击 URL 启动 App）
        handleViewIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleViewIntent(intent)
    }

    private fun handleViewIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) {
            val uri = intent.data
            if (uri != null && (uri.scheme == "http" || uri.scheme == "https")) {
                // 把 URL 写入 StateFlow，Composable 会观察并处理
                _pendingExternalUrl.value = uri.toString()
            }
        }
    }
}
```

**MainActivityContent 修正版（NC3）**：

```kotlin
@Composable
fun MainActivityContent(
    pendingExternalUrl: StateFlow<String?>,
    onExternalUrlConsumed: () -> Unit
) {
    // NC3：用 hiltViewModel 获取 MainViewModel（注入 TabRepository + SettingsStore）
    val mainViewModel: MainViewModel = hiltViewModel()
    val navController = rememberNavController()

    // 主题色（NC3：从 MainViewModel 获取，不再直接声明 settingsStore）
    val themeColorIndex by mainViewModel.themeColorIndex.collectAsState()

    // 观察外部 URL
    val externalUrl by pendingExternalUrl.collectAsState()

    LaunchedEffect(externalUrl) {
        val url = externalUrl ?: return@LaunchedEffect
        // NC3：通过 MainViewModel 创建标签页（内部处理 Room 写入），拿到 tabId
        val newTabId = mainViewModel.createTabForUrl(url)
        // 导航到浏览器页（此时 tabId 已存在 Room，见 M22 时序）
        navController.navigate("browser/$newTabId") {
            // 避免回退栈堆积多个外部 URL 实例
            popUpTo("home") { inclusive = false }
        }
        // 消费完毕，清空 Flow
        onExternalUrlConsumed()
    }

    LivingDashboardTheme(themeColorIndex = themeColorIndex) {
        AppNavGraph(navController = navController)
    }
}
```

**关键设计**：
- **NC3：`MainViewModel` 注入 `TabRepository`**：Composable 不能直接注入 Repository，必须通过 ViewModel。`MainViewModel` 暴露 `createTabForUrl(url)` suspend 函数，返回 tabId
- **`MutableStateFlow<String?>`** 持有外部 URL，避免直接在 `onNewIntent` 中操作导航（导航在 Composable 中）
- **`LaunchedEffect(externalUrl)`** 观察 URL 变化，调用 `mainViewModel.createTabForUrl(url)` 拿到 tabId 后导航
- **`onExternalUrlConsumed`** 回调清空 Flow，避免重复处理
- **时序**：`createTabForUrl` 是 suspend 函数，等 Room 写入完成才返回 tabId，保证导航时 tabId 已存在（见 M22）
- **`onNewIntent`** 处理 App 已在后台时再次收到外部 URL 的情况
- **主题色也由 `MainViewModel` 提供**：避免在 Composable 中直接声明 `val settingsStore: SettingsStore`（同样无法编译）

### 3.6 DI 模块扩展

**DatabaseModule.kt**（新）：
```kotlin
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides @Singleton
    fun provideDatabase(@ApplicationContext ctx: Context): LivingDatabase =
        Room.databaseBuilder(ctx, LivingDatabase::class.java, "living.db")
            .fallbackToDestructiveMigration()  // M1 开发期，破坏性迁移
            .build()

    @Provides fun provideBookmarkDao(db: LivingDatabase) = db.bookmarkDao()
    @Provides fun provideHistoryDao(db: LivingDatabase) = db.historyDao()
    @Provides fun provideTabDao(db: LivingDatabase) = db.tabDao()

    @Provides @Singleton
    fun provideSettingsStore(@ApplicationContext ctx: Context): SettingsStore =
        SettingsStore(ctx)

    @Provides @Singleton
    fun provideCookieManager(): CookieManagerWrapper = CookieManagerWrapper()
}
```

**AppModule.kt 扩展（注入 Repository，M6）**：

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    // M0 已有的 WS 相关 @Provides 保留不动

    // Repository 注入（M6 补充）
    @Provides @Singleton
    fun provideBookmarkRepository(dao: BookmarkDao): BookmarkRepository =
        BookmarkRepository(dao)

    @Provides @Singleton
    fun provideHistoryRepository(dao: HistoryDao): HistoryRepository =
        HistoryRepository(dao)

    @Provides @Singleton
    fun provideTabRepository(dao: TabDao): TabRepository =
        TabRepository(dao)
}
```

**说明**：Repository 用 `@Singleton` 保证全局单例，DAO 由 `DatabaseModule` 提供。`SettingsStore` 和 `CookieManagerWrapper` 也注入为单例。

---

## 四、实现顺序与并行计划

### 4.1 实现顺序（依赖关系）

```
[1] 数据层（Room + DataStore）  ← 基础，无依赖
    ↓
[2] 浏览器引擎层（WebView 封装）← 依赖 Android API，无依赖项目代码
    ↓
[3] UI 层                       ← 依赖 [1] + [2]
    ├── 主页
    ├── 浏览器页
    ├── 标签页管理
    ├── 书签/历史/设置
    └── 底部栏 + 更多菜单
    ↓
[4] 导航 + MainActivity 改造    ← 依赖 [3]
    ↓
[5] 默认浏览器 + Intent Filter  ← 依赖 [4]
```

### 4.2 并行 Sub-Agent 分工（两阶段，M8 + M9）

> **改造说明**：原方案 4 个 Sub-Agent 全并行，但 C/D 依赖 A/B 的产物，并行会导致桩代码返工。改为两阶段：Phase 1 A+B 并行（无依赖）；Phase 2 C+D1+D2 并行（A/B 完成后）。同时把原 Sub-Agent D 拆分为 D1 + D2（M9），避免单个 Agent 任务过重。

#### Phase 1：A + B 并行（数据层 + 浏览器引擎层，无依赖）

**Sub-Agent A：数据层 + DI**
- `data/db/LivingDatabase.kt` + `Converters.kt`
- `data/dao/`（BookmarkDao, HistoryDao, TabDao）
- `data/entity/`（BookmarkEntity, HistoryEntity, TabEntity）
- `data/repository/`（BookmarkRepository, HistoryRepository, TabRepository）
- `data/prefs/SettingsStore.kt`
- `di/DatabaseModule.kt`
- `di/AppModule.kt` 扩展（Repository @Provides）
- `build.gradle.kts` 加依赖

**Sub-Agent B：浏览器引擎层**
- `browser/LivingWebView.kt`
- `browser/LivingWebViewClient.kt`
- `browser/LivingWebChromeClient.kt`
- `browser/CookieManagerWrapper.kt`（文件名与类名一致，M4）
- `browser/DefaultBrowserHelper.kt`

#### Phase 2：C + D1 + D2 并行（UI 层，依赖 A + B 完成）

**Sub-Agent C：UI - 主页 + 浏览器页 + 底部栏**
- `ui/home/BrowserHomeScreen.kt` + `BrowserHomeViewModel.kt`
- `ui/home/components/`（SearchBar, LogoHeader, QuickAccessGrid）
- `ui/browser/BrowserScreen.kt` + `BrowserViewModel.kt`（含 SavedStateHandle，M3）
- `ui/browser/components/`（AddressBar, ProgressBar）
- `ui/components/BottomBar.kt`
- `ui/components/MoreMenuSheet.kt`

**Sub-Agent D1：UI - 标签页 + 书签 + 历史**（M9 拆分）
- `ui/tab/`（TabManagerScreen + TabManagerViewModel）
- `ui/bookmark/`（BookmarkScreen + BookmarkViewModel）
- `ui/history/`（HistoryScreen + HistoryViewModel）

**Sub-Agent D2：UI - 设置 + 导航 + MainActivity + 主题 + Manifest**（M9 拆分）
- `ui/settings/`（SettingsScreen + SettingsViewModel，含 WS 调试信息分组，C4）
- `ui/nav/AppNavGraph.kt`
- `ui/MainActivity.kt` 改造（保留 WS 注入，C4 + C9）
- `ui/theme/` 扩展（主题色定制 + dynamicColor 处理，C3）
- `AndroidManifest.xml` 改造（Intent Filter）
- `res/values/strings.xml` 扩展
- M0 `HomeScreen.kt` 归档到 `ui/debug/M0HomeScreen.kt`（C4）

**依赖关系**：
```
Phase 1:  A ──┐
          B ──┤
                ↓
Phase 2:  C ──┐
          D1 ─┤  (依赖 A 的 Repository + B 的 WebView)
          D2 ─┘
```

**实际执行**：
1. Phase 1：A、B 同时启动，完成后主 Agent 集成 + 编译验证（确保 Repository 和 WebView 可用）
2. Phase 2：C、D1、D2 同时启动，各自实现自己的模块
3. 最后由主 Agent 集成 + 编译验证 + 运行时验证

**集成验证点**：
- Phase 1 结束：`./gradlew :app:compileDebugKotlin` 通过（数据层 + 引擎层可编译）
- Phase 2 结束：`./gradlew :app:assembleDebug` 通过（完整 APK 可构建）

---

## 五、验收标准与验证计划

### 5.1 验收清单（来自 roadmap 第十章 Phase M1）

- [ ] 浏览器主页正常显示（搜索框+常用网站+Logo/书签）
- [ ] WebView 能打开真实网页
- [ ] 标签页管理正常
- [ ] 底部栏 5 按钮正常
- [ ] 书签/历史功能正常
- [ ] 主页可定制（背景/Logo/主题色）
- [ ] 能设为默认浏览器

### 5.2 编译验证

```powershell
cd f:\allmylife\event\client\android
F:\allmylife\gradle-8.2-bin\gradle-8.2\bin\gradle.bat :app:assembleDebug
```

**验收**：BUILD SUCCESSFUL，无编译错误。

### 5.3 APK 体积验证

```powershell
# 检查 debug APK 体积
Get-Item app\build\outputs\apk\debug\app-debug.apk | Select-Object Length
```

**验收**：debug APK < 30MB（release < 20MB，debug 允许稍大）。

### 5.4 运行时验证（需用户配合真机或模拟器）

**验证步骤**：
1. 启动模拟器（Android 36）或连接真机
2. 安装 APK：`gradle.bat :app:installDebug`
3. 启动 App，验证：
   - 浏览器主页显示（Logo + 搜索框 + 常用网站占位）
   - 搜索框输入 `baidu.com` → 打开百度
   - 搜索框输入 `测试` → 百度搜索"测试"
   - 底部栏 5 按钮可见
   - 后退/前进按钮工作
   - 标签页管理：新建/切换/关闭
   - 更多菜单：半屏展开
   - 书签：添加书签 → 主页显示快捷图标
   - 历史：访问网页后历史记录出现
   - 设置：主题色切换生效
   - 默认浏览器：点击按钮弹系统对话框

**minSdk 26（Android 8.0）额外验证（C8）**：

> **重点**：minSdk 26 是支持的最低版本，必须单独验证，确保降级逻辑和兼容性正常。

4. 启动 Android 8.0（API 26）模拟器，安装同一 APK
5. 重点验证：
   - **RoleManager 降级**：点击"设为默认浏览器"按钮，应打开系统"默认应用"设置页（而非 RoleManager 对话框，因为 API 26 < 29）
   - **WebView 兼容性**：打开百度/知乎等网页，验证 WebView 正常加载（Android 8.0 的 WebView 实现较旧，需确认 JS 执行、DOM Storage 正常）
   - **dynamicColor 降级**：主题色"跟随系统"选项在 API 26 上应回退到 M0 默认紫色（因为 dynamicColor 需 API 31+）
   - **通知/权限**：M1 不申请运行时权限，但验证 App 不因权限问题崩溃
   - **生命周期**：旋转屏幕、按 Home 键再返回，验证 WebView 重新加载正常
   - **内存**：长时间使用后检查内存占用，确认 WebView `destroy()` 生效（用 Android Studio Profiler）

### 5.5 单元测试（M1 最低要求）

- `UrlBuilderTest`：`buildUrlFromInput` 各种输入（URL/搜索词/带协议/不带协议）
- `HistoryRepositoryTest`：去重逻辑（同 URL 多次访问 visitCount++）
- `BookmarkRepositoryTest`：CRUD + showOnHome 过滤

---

## 六、风险与缓解

| 风险 | 缓解 |
|------|------|
| compileSdk=36 实验性，编译失败 | M0 已验证可编译，继续沿用 |
| WebView 内存占用大 | M1 单标签单 WebView，切换时释放；M7 做 WebView 池 |
| WebView 内存泄漏（持有 Activity Context） | 用 `applicationContext` 创建 WebView；`DisposableEffect.onDispose` 调用 `destroy()`；监听 `ON_DESTROY` 生命周期（见 3.2.1 + 3.3.3） |
| 部分网站检测 WebView 拒绝服务 | UA 可切换（移动/桌面），M1 默认移动 UA |
| SAF 选图后 URI 权限丢失 | 复制到 App 私有目录，不依赖持久化 URI 权限 |
| Room 迁移破坏性（开发期） | `fallbackToDestructiveMigration`，正式版前补迁移脚本 |
| 标签页状态恢复不完整 | M1 只存 URL 重新加载，M7 用 `saveState`/`restoreState` 增强 |
| 默认浏览器 RoleManager 不可用（Android <10） | 降级打开系统设置页 |
| 旋转后页面重新加载影响体验 | M1 接受（ViewModel 存活，URL 保留）；M7 用 `saveState`/`restoreState` 保留页面状态 |
| dynamicColor 与预设主题色冲突 | 选择预设色时强制 `dynamicColor = false`（见 3.4 节） |
| minSdk 26 WebView 兼容性 | 需在 Android 8.0 模拟器额外验证（见 5.4 节） |

---

## 七、不做的事（M1 边界）

- ❌ 画布主页（M2）
- ❌ AI 对话框 / AI 操控浏览器（M3）
- ❌ 脚本系统（M4）
- ❌ 数据同步（M5，M1 数据全本地）
- ❌ 数据导入（M6）
- ❌ WebView 复用池 / 深度休眠（M7）
- ❌ 广告拦截（M7）
- ❌ 下载管理（M7）
- ❌ 无痕模式（M7）
- ❌ 真实搜索建议 API（M7，M1 只做 URL 补全）
- ❌ 完整 WebView 状态保存（M7，M1 只存 URL）

---

## 八、附录

### 8.1 搜索引擎配置

```kotlin
enum class SearchEngine(val displayName: String, val searchUrlTemplate: String) {
    BAIDU("百度", "https://www.baidu.com/s?wd=%s"),
    GOOGLE("Google", "https://www.google.com/search?q=%s"),
    BING("Bing", "https://www.bing.com/search?q=%s");

    fun buildSearchUrl(query: String): String {
        return searchUrlTemplate.format(URLEncoder.encode(query, "UTF-8"))
    }
}
```

### 8.2 URL 补全逻辑（搜索建议简化版）

输入 `baidu` → 建议补全为 `https://www.baidu.com`
输入 `baidu.com` → 直接当 URL（补全 `https://`）
输入 `测试` → 搜索引擎搜索

**M1 搜索建议实现**（简化）：
- 输入框下方显示建议列表
- 建议项：URL 补全（如果输入像域名）+ 搜索引擎搜索建议（`搜索 "xxx"`）
- 不调用真实搜索建议 API（M7 增强）

### 8.3 参考代码

- 桌面端 WebView 组件：`client/desktop/src/components/widgets/WebviewWidget.tsx`
- 桌面端标签页管理：`client/desktop/src/components/TabBar.tsx`
- 桌面端浏览器工具：`client/desktop/src/utils/wsToolHandlers.ts`
- M0 WS 客户端：`client/android/app/src/main/java/com/livingdashboard/sync/WsClient.kt`
