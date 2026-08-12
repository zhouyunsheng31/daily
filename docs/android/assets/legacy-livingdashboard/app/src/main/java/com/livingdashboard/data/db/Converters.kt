package com.livingdashboard.data.db

import androidx.room.TypeConverter
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.WidgetType

/**
 * Room TypeConverters（Spec 3.1.1 / Room M2）。
 *
 * Room 2.6.1 不原生支持 enum，需提供 enum ↔ String 转换。
 *
 * 转换策略：
 * - 写入数据库：用 enum.name（如 "AGGREGATE"、"HTML_CANVAS"）
 * - 读出数据库：用 enum.fromString 容错解析（未知值返回默认值）
 *
 * 在 [LivingDatabase] 类上用 `@TypeConverters(Converters::class)` 注册，
 * Room 自动应用到所有 DAO 的 enum 字段。
 */
class Converters {

    // ===== PanelType =====

    @TypeConverter
    fun panelTypeToString(value: PanelType?): String? = value?.name

    @TypeConverter
    fun stringToPanelType(value: String?): PanelType? = value?.let { PanelType.fromString(it) }

    // ===== WidgetType =====

    @TypeConverter
    fun widgetTypeToString(value: WidgetType?): String? = value?.name

    @TypeConverter
    fun stringToWidgetType(value: String?): WidgetType? = value?.let { WidgetType.fromString(it) }

    // ===== M4：stringList 转换器（Spec 2.1.3） =====

    /**
     * List<String> → String（Room 持久化用）。
     *
     * 用换行分隔而非 JSON：油猴元数据值不会含 `\n`；解析开销小。
     * null 安全：null/空列表 → 空字符串。
     */
    @TypeConverter
    fun stringListToString(list: List<String>?): String =
        (list ?: emptyList()).joinToString("\n")

    /**
     * String → List<String>（Room 读出用）。
     *
     * 容错：null/空字符串 → emptyList；按 `\n` 分割后过滤空行。
     */
    @TypeConverter
    fun stringListFromString(value: String?): List<String> =
        if (value.isNullOrEmpty()) emptyList()
        else value.split("\n").filter { it.isNotEmpty() }
}
