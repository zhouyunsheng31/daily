package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 收藏组件 Entity（Spec 6.5 / Room M2）。
 *
 * 表名 "favorites"。
 *
 * 一个组件被收藏后在聚合面板上展示。收藏即"在聚合面板上创建一个位置引用"，
 * 但为了支持"取消收藏即从聚合面板消失"语义，用独立表存储收藏关系。
 *
 * 字段：
 * - [widgetId]：组件 ID（主键，UNIQUE，一个组件只能收藏一次）
 *
 * 索引：
 * - `widget_id`（主键自带 UNIQUE 索引）
 *
 * 调用方：
 * - [com.livingdashboard.ui.canvas.CanvasHomeViewModel]（observeFavorites）
 * - [com.livingdashboard.ui.canvas.CanvasViewModel]（toggleFavorite / isFavorite）
 * - [com.livingdashboard.LivingDashboardApp]（聚合面板初始化时不直接写收藏表）
 *
 * 注：聚合面板的位置由 toggleFavorite 时同步写入 widget_positions 表（panelId = 聚合面板 ID）。
 */
@Entity(
    tableName = "favorites",
    indices = [
        Index(value = ["widget_id"], unique = true),
    ]
)
data class FavoriteEntity(
    @PrimaryKey
    @ColumnInfo(name = "widget_id")
    val widgetId: String,
)
