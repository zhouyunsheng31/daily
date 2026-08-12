package com.livingdashboard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 用户脚本 Entity（Spec 2.1.1 / Phase M4 T1 数据层）。
 *
 * 表名 "userscripts"，对应 Room Migration 3→4（见 LivingDatabase.MIGRATION_3_4）。
 *
 * 字段（共 18 个）：
 * - [id]：UUID 主键（由调用方生成，非 autoGenerate）
 * - [name] / [namespace] / [version] / [description] / [author]：油猴元数据单值字段
 * - [matches] / [includes] / [excludes] / [grants]：油猴元数据多值字段（List<String>，由 Converters.stringListToString 转换为 TEXT 存储）
 * - [runAt]：注入时机（document-start / document-end / document-idle）
 * - [code]：脚本正文（已剥离 ==UserScript== 块）
 * - [rawMetadata]：原始元数据块文本（==UserScript== ... ==/UserScript==）
 * - [enabled]：是否启用（false 时 ScriptInjector 不注入）
 * - [source]：来源（import / ai / manual）
 * - [createdAt] / [updatedAt]：时间戳（毫秒）
 * - [versionCode]：M5 乐观锁预留（每次 update 自增）
 *
 * 索引：
 * - [enabled]：observeEnabled 查询用
 * - [updated_at]：ORDER BY updated_at DESC 用
 *
 * DDL 一致性：本 Entity 注解生成的 DDL 与 LivingDatabase.MIGRATION_3_4 中的 CREATE TABLE SQL
 * 字段名/类型完全一致；Room 2.6.1 schema 校验要求 Entity 无 @ColumnDefault 时 Migration SQL
 * 也不能含 DEFAULT 子句（否则 fallbackToDestructiveMigration 会 DROP 整库）。
 *
 * 调用方：
 * - [com.livingdashboard.data.db.UserScriptDao]（CRUD）
 * - [com.livingdashboard.data.repository.UserScriptRepository]（缓存 + 业务封装）
 * - [com.livingdashboard.script.ScriptInjector]（snapshot 后匹配 URL 注入）
 * - [com.livingdashboard.ai.tools.CreateUserscriptTool] 等 4 个 AI 工具
 */
@Entity(
    tableName = "userscripts",
    indices = [
        Index(value = ["enabled"]),
        Index(value = ["updated_at"]),
    ]
)
data class UserScriptEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "name")
    val name: String,

    @ColumnInfo(name = "namespace")
    val namespace: String,

    @ColumnInfo(name = "version")
    val version: String,

    @ColumnInfo(name = "description")
    val description: String,

    @ColumnInfo(name = "author")
    val author: String,

    @ColumnInfo(name = "matches")
    val matches: List<String>,

    @ColumnInfo(name = "includes")
    val includes: List<String>,

    @ColumnInfo(name = "excludes")
    val excludes: List<String>,

    @ColumnInfo(name = "grants")
    val grants: List<String>,

    @ColumnInfo(name = "run_at")
    val runAt: String,

    @ColumnInfo(name = "code")
    val code: String,

    @ColumnInfo(name = "raw_metadata")
    val rawMetadata: String,

    @ColumnInfo(name = "enabled")
    val enabled: Boolean,

    @ColumnInfo(name = "source")
    val source: String,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    @ColumnInfo(name = "updated_at")
    val updatedAt: Long,

    @ColumnInfo(name = "version_code")
    val versionCode: Int,
)
