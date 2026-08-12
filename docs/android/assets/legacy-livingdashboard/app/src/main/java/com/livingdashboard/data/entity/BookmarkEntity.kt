package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 书签 Entity（Spec 3.1.5 / Room M1）。
 *
 * 表名 "bookmarks"。
 *
 * 字段：
 * - [id]：自增主键（Long，由 Room 自动生成）
 * - [title]：书签标题
 * - [url]：书签 URL（无唯一约束，调用方在 insert 前需调 BookmarkRepository.findByUrl 去重）
 * - [showOnHome]：是否在主页常用网站网格显示（首页 QuickAccessGrid 用）
 *
 * 调用方：
 * - [com.livingdashboard.ui.bookmark.BookmarkViewModel]
 * - [com.livingdashboard.ui.home.BrowserHomeViewModel]（通过 getHomeShortcuts() 过滤 showOnHome=true）
 * - [com.livingdashboard.ui.browser.BrowserViewModel.addBookmark]
 */
@Entity(tableName = "bookmarks")
data class BookmarkEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "url")
    val url: String,

    @ColumnInfo(name = "show_on_home")
    val showOnHome: Boolean = false,
)
