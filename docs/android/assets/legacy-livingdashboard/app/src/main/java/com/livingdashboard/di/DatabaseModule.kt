package com.livingdashboard.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.room.Room
import com.livingdashboard.browser.CookieManagerWrapper
import com.livingdashboard.data.dao.AiConversationDao
import com.livingdashboard.data.dao.BookmarkDao
import com.livingdashboard.data.dao.FavoriteDao
import com.livingdashboard.data.dao.HistoryDao
import com.livingdashboard.data.dao.PanelDao
import com.livingdashboard.data.dao.TabDao
import com.livingdashboard.data.dao.WidgetDao
import com.livingdashboard.data.dao.WidgetPositionDao
import com.livingdashboard.data.db.LivingDatabase
import com.livingdashboard.data.db.UserScriptDao
import com.livingdashboard.data.repository.AiConversationRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 数据库 + DataStore + Cookie DI 模块（Spec 10.2 / 6.8）。
 *
 * M2 变更：
 * - LivingDatabase version 1→2，fallbackToDestructiveMigration
 * - 新增 4 个 DAO 提供方法（PanelDao/WidgetDao/WidgetPositionDao/FavoriteDao）
 * - 删除 provideSettingsStore（SettingsStore 改为 @Inject constructor(dataStore)）
 * - 新增 provideDataStore（供 SettingsStore 构造函数注入）
 *
 * M3 变更（Spec 6.8）：
 * - LivingDatabase version 2→3，addMigrations(MIGRATION_2_3)
 * - 新增 AiConversationDao / AiConversationRepository 提供方法
 * - 新增 fallbackToDestructiveMigrationOnDowngrade（m23 安全保险）
 *
 * 注意：@TypeConverters(Converters::class) 注解在 LivingDatabase 上，Room 自动识别，
 * 不需要（也不存在）RoomDatabase.Builder.addTypeConverter() API。
 *
 * CanvasRepository 用 @Inject constructor，Hilt 自动注入 4 个 DAO，无需 @Provides。
 */
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    /**
     * 提供 LivingDatabase 单例。
     * - DB 名 "living.db"（M1 原值，v5 #N9 保留）
     * - M3：addMigrations(MIGRATION_2_3) 正式迁移 v2→v3
     * - fallbackToDestructiveMigration：兜底（不应触发，但保留）
     * - fallbackToDestructiveMigrationOnDowngrade：downgrade 时销毁重建（m23 安全保险）
     */
    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext ctx: Context): LivingDatabase =
        Room.databaseBuilder(ctx, LivingDatabase::class.java, "living.db")
            .addMigrations(LivingDatabase.MIGRATION_2_3, LivingDatabase.MIGRATION_3_4)  // M3 + M4
            .fallbackToDestructiveMigration()  // 兜底（不应触发，但保留）
            .fallbackToDestructiveMigrationOnDowngrade()  // m23：downgrade 安全保险
            .build()

    // M1 DAOs
    @Provides
    fun provideBookmarkDao(db: LivingDatabase): BookmarkDao = db.bookmarkDao()

    @Provides
    fun provideHistoryDao(db: LivingDatabase): HistoryDao = db.historyDao()

    @Provides
    fun provideTabDao(db: LivingDatabase): TabDao = db.tabDao()

    // M2 DAOs
    @Provides
    fun providePanelDao(db: LivingDatabase): PanelDao = db.panelDao()

    @Provides
    fun provideWidgetDao(db: LivingDatabase): WidgetDao = db.widgetDao()

    @Provides
    fun provideWidgetPositionDao(db: LivingDatabase): WidgetPositionDao = db.widgetPositionDao()

    @Provides
    fun provideFavoriteDao(db: LivingDatabase): FavoriteDao = db.favoriteDao()

    // M3 DAO（Spec 6.8）
    @Provides
    fun provideAiConversationDao(db: LivingDatabase): AiConversationDao = db.aiConversationDao()

    // M3 Repository（Spec 6.8）
    @Provides
    @Singleton
    fun provideAiConversationRepository(dao: AiConversationDao): AiConversationRepository =
        AiConversationRepository(dao)

    // M4 DAO（Spec 2.7.1）
    // 注：UserScriptRepository 用 @Inject constructor(dao, json)，Hilt 自动提供，
    //   此处只提供 DAO；Json 由 AppModule.provideJson 提供。
    @Provides
    fun provideUserScriptDao(db: LivingDatabase): UserScriptDao = db.userScriptDao()

    /**
     * v4 #7：提供 DataStore<Preferences> 单例（供 SettingsStore @Inject constructor 用）。
     *
     * 文件名 "settings" 与 M1 的 Context.dataStore 委托一致，
     * 已有用户数据（主题色/搜索引擎等）自动迁移，无需手动搬移。
     */
    @Provides
    @Singleton
    fun provideDataStore(@ApplicationContext ctx: Context): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            produceFile = { ctx.preferencesDataStoreFile("settings") }
        )

    /**
     * 提供 CookieManagerWrapper 单例。
     */
    @Provides
    @Singleton
    fun provideCookieManager(): CookieManagerWrapper = CookieManagerWrapper()
}
