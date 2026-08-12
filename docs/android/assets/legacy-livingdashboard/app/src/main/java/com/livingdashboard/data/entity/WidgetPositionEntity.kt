package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 组件位置 Entity（Spec 6.3 / Room M2）。
 *
 * 表名 "widget_positions"。
 *
 * 一个组件在一个面板上的位置信息。同一组件在多个面板上有不同位置（聚合面板通过 JOIN 复制）。
 *
 * 字段：
 * - [id]：自增主键（Long）
 * - [panelId]：所属面板 ID
 * - [widgetId]：组件 ID
 * - [x]：画布坐标 X（像素）
 * - [y]：画布坐标 Y（像素）
 * - [zIndex]：层级（暂未使用，默认 0）
 *
 * 索引：
 * - `(panel_id, widget_id)` 唯一索引：保证同一组件在同一面板上只有一条位置记录
 * - `panel_id`：用于 observeByPanel 查询
 * - `widget_id`：用于 deleteByWidget
 *
 * 外键：
 * - `widget_id` → `widgets.id` ON DELETE CASCADE（组件删除时位置自动删除）
 *
 * 调用方：
 * - [com.livingdashboard.ui.canvas.CanvasViewModel.observePositions] / [moveWidget]
 * - [com.livingdashboard.ui.canvas.components.WidgetContainer]（用 position.x/y 渲染）
 */
@Entity(
    tableName = "widget_positions",
    indices = [
        Index(value = ["panel_id", "widget_id"], unique = true),
        Index(value = ["panel_id"]),
        Index(value = ["widget_id"]),
    ],
    foreignKeys = [
        ForeignKey(
            entity = WidgetEntity::class,
            parentColumns = ["id"],
            childColumns = ["widget_id"],
            onDelete = ForeignKey.CASCADE,
        )
    ]
)
data class WidgetPositionEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,

    @ColumnInfo(name = "panel_id")
    val panelId: String,

    @ColumnInfo(name = "widget_id")
    val widgetId: String,

    @ColumnInfo(name = "x")
    val x: Float = 0f,

    @ColumnInfo(name = "y")
    val y: Float = 0f,

    @ColumnInfo(name = "z_index")
    val zIndex: Int = 0,
)
