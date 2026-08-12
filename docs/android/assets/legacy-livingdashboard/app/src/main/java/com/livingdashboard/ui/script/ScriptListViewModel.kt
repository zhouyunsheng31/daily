package com.livingdashboard.ui.script

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.UserScriptEntity
import com.livingdashboard.data.repository.UserScriptRepository
import com.livingdashboard.script.ScriptMetadataParser
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.UUID
import javax.inject.Inject

/**
 * 脚本列表 ViewModel（Spec 2.6.5 / Phase M4 T6）。
 *
 * 暴露 [scripts] StateFlow 供 UI 订阅，提供：
 * - [toggleEnabled]：切换脚本启用状态
 * - [deleteScript]：删除脚本
 * - [importFromUrl]：从 URL 下载 .user.js 并解析入库（Spec 2.6.7 方式 A）
 * - [importFromFile]：从 SAF URI 读取 .user.js 并解析入库（Spec 2.6.7 方式 B）
 *
 * @param repository 用户脚本 Repository（T1 提供）
 * @param okHttpClient OkHttp 客户端（URL 导入时下载 .user.js 用）
 * @param context App Context（文件导入时读 SAF URI 用）
 */
@HiltViewModel
class ScriptListViewModel @Inject constructor(
    private val repository: UserScriptRepository,
    private val okHttpClient: OkHttpClient,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    /**
     * 所有脚本列表（按 updated_at DESC）。
     *
     * 用 stateIn(WhileSubscribed) 让 UI 取消订阅时自动取消上游 Flow，
     * 默认值空列表避免首次组合闪烁。
     */
    val scripts: StateFlow<List<UserScriptEntity>> = repository.observeAll()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000L),
            initialValue = emptyList(),
        )

    /** 导入状态：idle / loading / success / error */
    private val _importState = MutableStateFlow<ImportState>(ImportState.Idle)
    val importState: StateFlow<ImportState> = _importState.asStateFlow()

    /**
     * 切换脚本启用状态。
     */
    fun toggleEnabled(id: String) {
        viewModelScope.launch {
            val entity = repository.getById(id) ?: return@launch
            val updated = entity.copy(enabled = !entity.enabled)
            repository.update(updated)
        }
    }

    /**
     * 删除脚本。
     */
    fun deleteScript(id: String) {
        viewModelScope.launch {
            repository.deleteById(id)
        }
    }

    /**
     * 从 URL 导入脚本（Spec 2.6.7 方式 A）。
     *
     * 1. OkHttp GET 下载 .user.js 全文
     * 2. ScriptMetadataParser 解析
     * 3. 写入 Room（source = "import"）
     *
     * @param url .user.js 文件 URL
     */
    fun importFromUrl(url: String) {
        viewModelScope.launch {
            _importState.value = ImportState.Loading
            try {
                val source = withContext(Dispatchers.IO) {
                    val request = Request.Builder().url(url).build()
                    okHttpClient.newCall(request).execute().use { resp ->
                        resp.body?.string() ?: throw IllegalStateException("empty response body")
                    }
                }
                val parsed = ScriptMetadataParser.parse(source)
                val id = UUID.randomUUID().toString()
                val now = System.currentTimeMillis()
                repository.insert(
                    UserScriptEntity(
                        id = id,
                        name = parsed.metadata.name,
                        namespace = parsed.metadata.namespace,
                        version = parsed.metadata.version,
                        description = parsed.metadata.description,
                        author = parsed.metadata.author,
                        matches = parsed.metadata.matches,
                        includes = parsed.metadata.includes,
                        excludes = parsed.metadata.excludes,
                        grants = parsed.metadata.grants,
                        runAt = parsed.metadata.runAt,
                        code = parsed.code,
                        rawMetadata = parsed.rawMetadata,
                        enabled = true,
                        source = "import",
                        createdAt = now,
                        updatedAt = now,
                        versionCode = 1,
                    )
                )
                _importState.value = ImportState.Success(id)
            } catch (e: Exception) {
                _importState.value = ImportState.Error(e.message ?: "import failed")
            }
        }
    }

    /**
     * 从 SAF URI 导入脚本（Spec 2.6.7 方式 B）。
     *
     * @param uri SAF 返回的 URI
     */
    fun importFromFile(uri: Uri) {
        viewModelScope.launch {
            _importState.value = ImportState.Loading
            try {
                val source = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { input ->
                        input.bufferedReader().readText()
                    } ?: throw IllegalStateException("cannot open URI: $uri")
                }
                val parsed = ScriptMetadataParser.parse(source)
                val id = UUID.randomUUID().toString()
                val now = System.currentTimeMillis()
                repository.insert(
                    UserScriptEntity(
                        id = id,
                        name = parsed.metadata.name,
                        namespace = parsed.metadata.namespace,
                        version = parsed.metadata.version,
                        description = parsed.metadata.description,
                        author = parsed.metadata.author,
                        matches = parsed.metadata.matches,
                        includes = parsed.metadata.includes,
                        excludes = parsed.metadata.excludes,
                        grants = parsed.metadata.grants,
                        runAt = parsed.metadata.runAt,
                        code = parsed.code,
                        rawMetadata = parsed.rawMetadata,
                        enabled = true,
                        source = "import",
                        createdAt = now,
                        updatedAt = now,
                        versionCode = 1,
                    )
                )
                _importState.value = ImportState.Success(id)
            } catch (e: Exception) {
                _importState.value = ImportState.Error(e.message ?: "import failed")
            }
        }
    }

    /** 重置导入状态到 Idle（UI 关闭对话框或消费成功/错误后调用） */
    fun resetImportState() {
        _importState.value = ImportState.Idle
    }

    /** 导入状态密封类 */
    sealed class ImportState {
        object Idle : ImportState()
        object Loading : ImportState()
        data class Success(val id: String) : ImportState()
        data class Error(val message: String) : ImportState()
    }
}
