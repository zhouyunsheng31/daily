package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 浏览历史记录 Entity（Spec 3.1.6 / Room M1）。
 *
 * 表名 "history"。
 *
 * 字段：
 * - [id]：自增主键（Long，由 Room 自动生成）
 * - [url]：访问的 URL
 * - [title]：页面标题（来自 WebView.onTitleChange）
 * - [visitedAt]：访问时间戳（毫秒，由 HistoryRepository.recordVisit 写入）
 *
 * 索引：
 * - [url]：用于 HistoryRepository.findByUrl（如果未来需要查询同 URL 历史）
 * - [visited_at]：用于按时间 DESC 排序（HistoryDao.getAll 默认排序）
 *
 * 调用方：
 * - [com.livingdashboard.ui.history.HistoryViewModel]（getAll / search / delete / deleteAll）
 * - [com.livingdashboard.ui.browser.BrowserViewModel]（historyRepository.recordVisit）
 */
@Entity(
    tableName = "history",
    indices = [
        Index(value = ["url"]),
        Index(value = ["visited_at"]),
    ]
)
data class HistoryEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,

    @ColumnInfo(name = "url")
    val url: String,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "visited_at")
    val visitedAt: Long,
)
