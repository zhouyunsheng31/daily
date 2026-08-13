package xyz.shadowshub.daily.ui.apps

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import xyz.shadowshub.core.network.AppDetail
import xyz.shadowshub.core.network.AppSummary
import xyz.shadowshub.core.network.WebosApi

data class AppsUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val apps: List<AppSummary> = emptyList(),
)

/** M0-3 测试页：线上 App 列表（桌面 Tab 占位验证） */
class AppsViewModel(private val api: WebosApi) : ViewModel() {

    private val _state = MutableStateFlow(AppsUiState())
    val state: StateFlow<AppsUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            // distinctBy：线上 buildBootstrap 偶发重复返回同一 App（system.desktop），防御去重
            val apps = api.listApps().distinctBy { it.id }
            if (apps.isEmpty()) {
                _state.value = _state.value.copy(loading = false, error = "没有可运行的 App（可先让 AI 创建一个）")
            } else {
                _state.value = _state.value.copy(loading = false, apps = apps)
            }
        }
    }

    suspend fun loadDetail(appId: String): AppDetail? = api.appDetail(appId)
}