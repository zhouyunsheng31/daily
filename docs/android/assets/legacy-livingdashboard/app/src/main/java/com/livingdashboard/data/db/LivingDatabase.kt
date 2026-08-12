package com.livingdashboard.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.livingdashboard.data.dao.AiConversationDao
import com.livingdashboard.data.dao.BookmarkDao
import com.livingdashboard.data.dao.FavoriteDao
import com.livingdashboard.data.dao.HistoryDao
import com.livingdashboard.data.dao.PanelDao
import com.livingdashboard.data.dao.TabDao
import com.livingdashboard.data.dao.WidgetDao
import com.livingdashboard.data.dao.WidgetPositionDao
import com.livingdashboard.data.entity.AiConversationEntity
import com.livingdashboard.data.entity.BookmarkEntity
import com.livingdashboard.data.entity.FavoriteEntity
import com.livingdashboard.data.entity.HistoryEntity
import com.livingdashboard.data.entity.PanelEntity
import com.livingdashboard.data.entity.TabEntity
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.entity.WidgetPositionEntity

/**
 * Living Dashboard Room 数据库（Spec 3.1.1 / Room M1-M3）。
 *
 * ## 版本演进
 * - v1（M1）：tabs + bookmarks + history 三张表
 * - v2（M2）：新增 panels / widgets / widget_positions / favorites 四张表
 * - v3（M3）：新增 ai_conversations 表（[MIGRATION_2_3]）
 *
 * ## DAO 访问
 * 由 [com.livingdashboard.di.DatabaseModule] 通过 `db.xxxDao()` 获取 DAO 实例。
 *
 * ## TypeConverters
 * [Converters] 提供 PanelType / WidgetType ↔ String 转换（Room 2.6.1 不原生支持 enum）。
 *
 * ## 迁移
 * [MIGRATION_2_3]：v2 → v3，新增 ai_conversations 表 + (panel_id, created_at) 索引。
 */
@Database(
    entities = [
        TabEntity::class,
        BookmarkEntity::class,
        HistoryEntity::class,
        PanelEntity::class,
        WidgetEntity::class,
        WidgetPositionEntity::class,
        FavoriteEntity::class,
        AiConversationEntity::class,
        UserScriptEntity::class,
    ],
    version = 4,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class LivingDatabase : RoomDatabase() {

    // ===== M1 DAOs =====
    abstract fun tabDao(): TabDao
    abstract fun bookmarkDao(): BookmarkDao
    abstract fun historyDao(): HistoryDao

    // ===== M2 DAOs =====
    abstract fun panelDao(): PanelDao
    abstract fun widgetDao(): WidgetDao
    abstract fun widgetPositionDao(): WidgetPositionDao
    abstract fun favoriteDao(): FavoriteDao

    // ===== M3 DAOs =====
    abstract fun aiConversationDao(): AiConversationDao

    // ===== M4 DAOs =====
    abstract fun userScriptDao(): UserScriptDao

    companion object {
        /**
         * v2 → v3 迁移：新增 ai_conversations 表（Spec 6.8 / M3）。
         *
         * SQL 与 [AiConversationEntity] 注解生成的 DDL 一致：
         * - 表名 "ai_conversations"
         * - 主键 id BIGINT (autoGenerate)
         * - 字段 panel_id / role / content / turn_index / args / tool_call_id / tool_name / created_at
         * - 索引 idx_ai_conv_panel_created (panel_id, created_at)
         */
        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `ai_conversations` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `panel_id` TEXT NOT NULL,
                        `role` TEXT NOT NULL,
                        `content` TEXT NOT NULL,
                        `turn_index` INTEGER NOT NULL,
                        `args` TEXT,
                        `tool_call_id` TEXT,
                        `tool_name` TEXT,
                        `created_at` INTEGER NOT NULL
                    )
                """.trimIndent())
                db.execSQL("""
                    CREATE INDEX IF NOT EXISTS `index_ai_conversations_panel_id_created_at`
                    ON `ai_conversations` (`panel_id`, `created_at`)
                """.trimIndent())
            }
        }

        /**
         * v3 → v4 迁移：新增 userscripts 表（Spec 2.1.2 / M4）。
         *
         * v3 修复 F1：SQL 无 DEFAULT 子句，与 Entity 注解生成的 DDL 一致
         * （Room 2.6.1 schema 校验比对 TableInfo.defaultValue，Entity 字段无 @ColumnDefault
         * 时期望 defaultValue = null；若 Migration SQL 含 DEFAULT 会触发
         * fallbackToDestructiveMigration 销毁整库，丢失 tabs/bookmarks/history/panels/widgets/ai_conversations 数据）。
         *
         * 索引：
         * - index_userscripts_enabled：observeEnabled 查询用
         * - index_userscripts_updated_at：ORDER BY updated_at DESC 用
         *
         * SQL 风格与 MIGRATION_2_3 一致（CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS）。
         */
        val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `userscripts` (
                        `id` TEXT NOT NULL PRIMARY KEY,
                        `name` TEXT NOT NULL,
                        `namespace` TEXT NOT NULL,
                        `version` TEXT NOT NULL,
                        `description` TEXT NOT NULL,
                        `author` TEXT NOT NULL,
                        `matches` TEXT NOT NULL,
                        `includes` TEXT NOT NULL,
                        `excludes` TEXT NOT NULL,
                        `grants` TEXT NOT NULL,
                        `run_at` TEXT NOT NULL,
                        `code` TEXT NOT NULL,
                        `raw_metadata` TEXT NOT NULL,
                        `enabled` INTEGER NOT NULL,
                        `source` TEXT NOT NULL,
                        `created_at` INTEGER NOT NULL,
                        `updated_at` INTEGER NOT NULL,
                        `version_code` INTEGER NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_userscripts_enabled` ON `userscripts` (`enabled`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_userscripts_updated_at` ON `userscripts` (`updated_at`)")
            }
        }
    }
}
