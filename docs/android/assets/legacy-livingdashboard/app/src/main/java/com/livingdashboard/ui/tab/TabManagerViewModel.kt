package com.livingdashboard.ui.tab

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.TabEntity
import com.livingdashboard.data.repository.TabRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 标签页管理 UI 状态（Spec 3.3.4）。
 *
 * @param tabs 当前所有标签页列表（按 sortOrder ASC，等价于按创建顺序）
 */
data class TabManagerUiState(
    val tabs: List<TabEntity> = emptyList()
)

/**
 * 标签页管理 ViewModel（Spec 3.3.4）。
 *
 * 注入 `TabRepository`，用 `getAll()` Flow 收集标签页列表。
 *
 * 方法：
 * - `createNewTab()`：创建空白标签，返回 tabId
 * - `closeTab(tabId)`：关闭标签，如果是最后一个则自动新建空白标签
 * - `closeAllTabs()`：关闭所有标签
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@HiltViewModel
class TabManagerViewModel @Inject constructor(
    private val tabRepository: TabRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TabManagerUiState())
    val uiState: StateFlow<TabManagerUiState> = _uiState.asStateFlow()

    init {
        // 收集所有标签页（按 sortOrder ASC）
        viewModelScope.launch {
            tabRepository.getAll().collect { tabs ->
                _uiState.update { it.copy(tabs = tabs) }
            }
        }
    }

    /**
     * 创建新空白标签页。
     *
     * 时序（Spec M22）：先生成 UUID → 插入 Room → 返回 tabId。
     * 调用方拿到 tabId 后再导航到 browser/{tabId}，保证导航时 tabId 已存在。
     *
     * @return 新标签页的 id（UUID 字符串）
     */
    suspend fun createNewTab(): String {
        return tabRepository.createTab()
    }

    /**
     * 关闭指定标签页。
     *
     * 如果是最后一个标签，自动新建空白标签（Spec 3.3.4），
     * 保证始终至少有一个标签页。
     *
     * @param tabId 要关闭的标签页 id
     */
    suspend fun closeTab(tabId: String) {
        val tabs = tabRepository.getAll().first()
        val tab = tabs.find { it.id == tabId } ?: return
        tabRepository.delete(tab)
        // 最后一个标签被关闭时，自动新建空白标签
        if (tabs.size == 1) {
            tabRepository.createTab()
        }
    }

    /**
     * 关闭所有标签页。
     *
     * 清空后自动新建一个空白标签，保持"始终至少有一个标签"的不变量
     * （与 closeTab 关闭最后一个标签的行为一致，符合 Spec 3.3.4 精神）。
     */
    suspend fun closeAllTabs() {
        tabRepository.deleteAll()
        // 新建空白标签，避免标签页管理页为空（Spec 3.3.4 不变量）
        tabRepository.createTab()
    }
}
