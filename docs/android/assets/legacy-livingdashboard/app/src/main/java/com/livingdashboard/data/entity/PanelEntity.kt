package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 画布面板类型枚举（Spec 6.7 节）。
 *
 * - [NORMAL]：普通面板（用户创建，可删除）
 * - [AGGREGATE]：聚合面板（系统创建，不可删除，展示所有收藏组件）
 *
 * 在 [PanelEntity.type] 字段中存储，由 [com.livingdashboard.data.db.Converters] 做 ↔ String 转换。
 */
enum class PanelType {
    /** 普通面板（用户创建） */
    NORMAL,

    /** 聚合面板（系统创建，展示所有收藏组件） */
    AGGREGATE,
    ;

    companion object {
        /** 从字符串安全解析（容错：未知值返回 [NORMAL]） */
        fun fromString(value: String?): PanelType = when (value?.uppercase()) {
            "AGGREGATE" -> AGGREGATE
            "NORMAL" -> NORMAL
            else -> NORMAL
        }
    }
}

/**
 * 面板 Entity（Spec 6.7 / Room M2）。
 *
 * 表名 "panels"。
 *
 * 字段：
 * - [id]：UUID 字符串（由 CanvasRepository.createPanel 生成）
 * - [name]：面板名称（"新面板"、"聚合面板"等）
 * - [type]：面板类型（NORMAL / AGGREGATE）
 * - [sortOrder]：排序序号（用时间戳，保证按创建顺序 ASC）
 *
 * 索引：
 * - [type]：用于 CanvasRepository.getAggregatePanel 查询 AGGREGATE 类型面板
 * - [sort_order]：用于 observePanels 排序
 *
 * 调用方：
 * - [com.livingdashboard.ui.canvas.PanelTabViewModel]（observePanels / createPanel / deletePanel）
 * - [com.livingdashboard.ui.canvas.CanvasHomeViewModel]（observePanels 取 currentPanelId）
 * - [com.livingdashboard.LivingDashboardApp]（getAggregatePanel / createAggregatePanel）
 */
@Entity(
    tableName = "panels",
    indices = [
        Index(value = ["type"]),
        Index(value = ["sort_order"]),
    ]
)
data class PanelEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "name")
    val name: String,

    @ColumnInfo(name = "type")
    val type: PanelType = PanelType.NORMAL,

    @ColumnInfo(name = "sort_order")
    val sortOrder: Int = 0,
)
