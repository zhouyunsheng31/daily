package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 浏览器标签页 Entity（Spec 3.1.1 / Room M1）。
 *
 * 一个标签页对应一条记录，[id] 由 ViewModel 生成 UUID 后写入。
 * [sortOrder] 用当前时间戳（toInt）保证按创建顺序排序。
 *
 * 字段：
 * - [id]：UUID 字符串（由 ViewModel 调用 UUID.randomUUID().toString() 生成）
 * - [title]：标签页标题（初始 "新标签页"，加载完成后由 WebView.onTitleChange 更新）
 * - [url]：当前 URL（空字符串表示空白页）
 * - [sortOrder]：排序序号（用时间戳，等价于按创建顺序 ASC）
 *
 * 表名 "tabs"，与 Room M1 schema 一致。
 */
@Entity(
    tableName = "tabs",
    indices = [Index(value = ["sort_order"])]
)
data class TabEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "title")
    val title: String,

    @ColumnInfo(name = "url")
    val url: String,

    @ColumnInfo(name = "sort_order")
    val sortOrder: Int,
)
