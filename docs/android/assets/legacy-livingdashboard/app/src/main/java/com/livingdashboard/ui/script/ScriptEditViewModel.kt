package com.livingdashboard.ui.script

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ScriptMetadata
import com.livingdashboard.script.ScriptMetadataParser
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/**
 * 脚本编辑表单状态。
 *
 * 多行字段（[matches]/[excludes]/[grants]）用换行分隔，UI 显示为多行 TextField。
 * [code] 为脚本正文（已剥离 ==UserScript== 块，与 [UserScriptEntity.code] 一致）。
 */
data class ScriptEditState(
    val id: String? = null,             // null = 新建模式
    val name: String = "",
    val namespace: String = "",
    val version: String = "1.0",
    val description: String = "",
    val author: String = "",
    val matches: String = "",           // 多行（一行一个 pattern）
    val excludes: String = "",          // 多行
    val grants: String = "",            // 多行
    val runAt: String = "document-end", // document-start | document-end | document-idle
    val enabled: Boolean = true,
    val code: String = "",              // 脚本正文（不含 ==UserScript== 块）
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val errorMessage: String? = null,
)

/**
 * 脚本编辑 ViewModel（Spec 2.6.6 / Phase M4 T6）。
 *
 * **M4 关键修复**：保存时表单字段是 source of truth，用
 * [ScriptMetadataParser.rewriteMetadata] 重写代码的 ==UserScript== 块，
 * 保持代码正文不变，仅同步元数据块，确保下次解析时表单与代码块一致。
 *
 * @param repository 用户脚本 Repository
 * @param parser 元数据解析器（T2 提供，提供 parse/rewriteMetadata）
 * @param savedStateHandle 路由参数容器（Spec 要求，预留 "scriptId" key 读取）
 */
@HiltViewModel
class ScriptEditViewModel @Inject constructor(
    private val repository: UserScriptRepository,
    private val parser: ScriptMetadataParser,
    private val savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val _state = MutableStateFlow(ScriptEditState())
    val state: StateFlow<ScriptEditState> = _state.asStateFlow()

    /**
     * 加载脚本：从 Repository 拉取后填充表单。
     *
     * Spec 2.6.6：表单字段从 entity 字段加载（entity 字段是 source of truth）。
     * 若 entity.code 含 ==UserScript== 块（边界 case），用 parser 解析后不影响已填充的表单字段。
     *
     * @param id 脚本 ID（null = 新建模式，不加载）
     */
    fun loadScript(id: String?) {
        if (id == null) {
            _state.value = ScriptEditState()
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            val entity = repository.getById(id)
            if (entity == null) {
                _state.update { it.copy(isLoading = false, errorMessage = "脚本不存在: $id") }
                return@launch
            }
            _state.value = ScriptEditState(
                id = entity.id,
                name = entity.name,
                namespace = entity.namespace,
                version = entity.version,
                description = entity.description,
                author = entity.author,
                matches = entity.matches.joinToString("\n"),
                excludes = entity.excludes.joinToString("\n"),
                grants = entity.grants.joinToString("\n"),
                runAt = entity.runAt,
                enabled = entity.enabled,
                code = entity.code,
                isLoading = false,
            )
        }
    }

    /**
     * 更新表单字段。
     *
     * @param field 字段名（与 [ScriptEditState] 属性同名）
     * @param value 新值（String 或 Boolean）
     */
    fun updateFormField(field: String, value: Any) {
        _state.update { s ->
            when (field) {
                "name" -> s.copy(name = value as String)
                "namespace" -> s.copy(namespace = value as String)
                "version" -> s.copy(version = value as String)
                "description" -> s.copy(description = value as String)
                "author" -> s.copy(author = value as String)
                "matches" -> s.copy(matches = value as String)
                "excludes" -> s.copy(excludes = value as String)
                "grants" -> s.copy(grants = value as String)
                "runAt" -> s.copy(runAt = value as String)
                "enabled" -> s.copy(enabled = value as Boolean)
                else -> s
            }
        }
    }

    /**
     * 更新代码正文。
     */
    fun updateCode(code: String) {
        _state.update { it.copy(code = code) }
    }

    /**
     * 保存（Spec 2.6.6 M4 修复：表单字段重写 ==UserScript== 块）。
     *
     * 流程：
     * 1. 用表单字段构造 [ScriptMetadata]
     * 2. 调 [ScriptMetadataParser.rewriteMetadata] 重写代码中的 ==UserScript== 块
     *    （若代码无块则前置新块；若有块则替换；保持代码正文不变）
     * 3. 用 [ScriptMetadataParser.parse] 拆分新代码 → body + rawMetadata
     * 4. id=null 时 insert（新建），否则 update（保留原 source/createdAt）
     */
    fun save() {
        val s = _state.value
        if (s.isSaving) return
        if (s.name.isBlank()) {
            _state.update { it.copy(errorMessage = "名称不能为空") }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(isSaving = true, errorMessage = null) }
            try {
                val metadata = ScriptMetadata(
                    name = s.name.trim(),
                    namespace = s.namespace.trim(),
                    version = s.version.trim().ifBlank { "1.0" },
                    description = s.description,
                    author = s.author,
                    matches = s.matches.split("\n").map { it.trim() }.filter { it.isNotEmpty() },
                    includes = emptyList(),
                    excludes = s.excludes.split("\n").map { it.trim() }.filter { it.isNotEmpty() },
                    grants = s.grants.split("\n").map { it.trim() }.filter { it.isNotEmpty() },
                    runAt = s.runAt,
                )
                // M4 修复：表单字段是 source of truth，重写代码中的 ==UserScript== 块
                val newFullCode = parser.rewriteMetadata(s.code, metadata)
                // 拆分回 body + rawMetadata（entity.code 存 body，与字段文档一致）
                val parsedNew = parser.parse(newFullCode)
                val now = System.currentTimeMillis()

                if (s.id == null) {
                    // 新建
                    val entity = UserScriptEntity(
                        id = UUID.randomUUID().toString(),
                        name = metadata.name,
                        namespace = metadata.namespace,
                        version = metadata.version,
                        description = metadata.description,
                        author = metadata.author,
                        matches = metadata.matches,
                        includes = metadata.includes,
                        excludes = metadata.excludes,
                        grants = metadata.grants,
                        runAt = metadata.runAt,
                        code = parsedNew.code,
                        rawMetadata = parsedNew.rawMetadata,
                        enabled = s.enabled,
                        source = "manual",
                        createdAt = now,
                        updatedAt = now,
                        versionCode = 1,
                    )
                    repository.insert(entity)
                } else {
                    // 更新（保留原 source / createdAt）
                    val existing = repository.getById(s.id)
                    if (existing == null) {
                        _state.update {
                            it.copy(isSaving = false, errorMessage = "脚本不存在: ${s.id}")
                        }
                        return@launch
                    }
                    val entity = UserScriptEntity(
                        id = s.id,
                        name = metadata.name,
                        namespace = metadata.namespace,
                        version = metadata.version,
                        description = metadata.description,
                        author = metadata.author,
                        matches = metadata.matches,
                        includes = metadata.includes,
                        excludes = metadata.excludes,
                        grants = metadata.grants,
                        runAt = metadata.runAt,
                        code = parsedNew.code,
                        rawMetadata = parsedNew.rawMetadata,
                        enabled = s.enabled,
                        source = existing.source,
                        createdAt = existing.createdAt,
                        updatedAt = now,
                        versionCode = existing.versionCode,
                    )
                    repository.update(entity)
                }
                _state.update { it.copy(isSaving = false, saved = true) }
            } catch (e: Exception) {
                _state.update {
                    it.copy(isSaving = false, errorMessage = e.message ?: "save failed")
                }
            }
        }
    }

    /** 清除已保存标志（导航返回后再次进入时用） */
    fun consumeSaved() {
        _state.update { it.copy(saved = false) }
    }

    /** 清除错误消息 */
    fun consumeError() {
        _state.update { it.copy(errorMessage = null) }
    }
}