package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 画布组件类型枚举（Spec 5.3 / 附录 A，D10）。
 *
 * MVP 5 种基础组件类型，与桌面端 widgetDefinitions 一致。
 *
 * - [AI_ASSISTANT]：AI 助手占位（M3 接入真实能力）
 * - [WEBVIEW]：网页组件（复用 LivingWebView）
 * - [CALCULATOR]：计算器
 * - [FOCUS_TIMER]：专注计时（番茄钟）
 * - [HTML_CANVAS]：HTML 画布（用 WebView 渲染 HTML，M3 AI 工具创建/更新）
 * - [FREE_HTML]：自由 HTML（共享 DOM，任意形状，pointer-events 穿透，适合背景/动效/不规则边框）
 *
 * 在 [WidgetEntity.type] 字段中存储，由 [com.livingdashboard.data.db.Converters] 做 ↔ String 转换。
 */
enum class WidgetType {
    AI_ASSISTANT,
    WEBVIEW,
    CALCULATOR,
    FOCUS_TIMER,
    HTML_CANVAS,
    FREE_HTML,
    ;

    companion object {
        /** 从字符串安全解析（容错：未知值返回 [WEBVIEW]，与桌面端默认一致） */
        fun fromString(value: String?): WidgetType = when (value?.uppercase()) {
            "AI_ASSISTANT" -> AI_ASSISTANT
            "WEBVIEW" -> WEBVIEW
            "CALCULATOR" -> CALCULATOR
            "FOCUS_TIMER" -> FOCUS_TIMER
            "HTML_CANVAS" -> HTML_CANVAS
            "FREE_HTML" -> FREE_HTML
            else -> WEBVIEW
        }
    }
}

/**
 * 画布组件 Entity（Spec 6.3 / Room M2）。
 *
 * 表名 "widgets"。
 *
 * 一个 WidgetEntity 表示画布上的一个组件实例（如一个网页组件、一个计算器）。
 * 位置信息（x/y/zIndex）存于 [WidgetPositionEntity] 表，按 panelId 区分。
 *
 * 字段：
 * - [id]：UUID 字符串（由 CanvasRepository.createHtmlWidget 等生成）
 * - [panelId]：所属面板 ID（非外键，因为聚合面板不复制组件数据，而是 JOIN 查询）
 * - [type]：组件类型
 * - [title]：组件标题
 * - [stateJson]：组件状态 JSON 字符串（如 `{html: "...", url: "..."}`）
 * - [width]：组件宽度（px，画布坐标）
 * - [height]：组件高度（px，画布坐标）
 * - [createdAt]：创建时间戳（毫秒）
 *
 * 索引：
 * - [panel_id]：用于 observeByPanel 查询
 * - [type]：用于按类型筛选
 *
 * 调用方：
 * - [com.livingdashboard.ui.canvas.CanvasViewModel.observeWidgets] / [CanvasHomeViewModel]
 * - [com.livingdashboard.ai.tools.ListWidgetsTool]
 * - [com.livingdashboard.ai.tools.CreateHtmlWidgetTool] / [UpdateHtmlWidgetTool] / [DeleteHtmlWidgetTool]
 */
@Entity(
    tableName = "widgets",
    indices = [
        Index(value = ["panel_id"]),
        Index(value = ["type"]),
    ]
)
data class WidgetEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "panel_id")
    val panelId: String,

    @ColumnInfo(name = "type")
    val type: WidgetType,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "state_json")
    val stateJson: String = "{}",

    @ColumnInfo(name = "width")
    val width: Float = 300f,

    @ColumnInfo(name = "height")
    val height: Float = 200f,

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
)
