package com.livingdashboard.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.browser.buildUrlFromInput
import com.livingdashboard.data.SearchEngine
import com.livingdashboard.data.entity.BookmarkEntity
import com.livingdashboard.data.prefs.SettingsStore
import com.livingdashboard.data.repository.BookmarkRepository
import com.livingdashboard.data.repository.TabRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 浏览器主页 UI 状态（Spec 3.3.2）。
 *
 * @param homeShortcuts 主页快捷书签列表（showOnHome=true）
 * @param searchEngine 当前搜索引擎
 * @param backgroundUri 主页背景图 URI（null=无背景）
 * @param logoUri 自定义 Logo URI（null=用默认 ic_logo）
 * @param showHomeShortcuts 是否显示常用网站
 */
data class BrowserHomeUiState(
    val homeShortcuts: List<BookmarkEntity> = emptyList(),
    val searchEngine: SearchEngine = SearchEngine.BAIDU,
    val backgroundUri: String? = null,
    val logoUri: String? = null,
    val showHomeShortcuts: Boolean = true
)

/**
 * 浏览器主页 ViewModel（Spec 3.3.2）。
 *
 * 注入：
 * - `BookmarkRepository`：获取主页快捷书签
 * - `SettingsStore`：获取搜索引擎、背景图、Logo、显示开关
 * - `TabRepository`：创建新标签页
 *
 * 用 `combine` 组合 5 个 Flow 成 `BrowserHomeUiState`，暴露 `createTabAndNavigate` 方法。
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@HiltViewModel
class BrowserHomeViewModel @Inject constructor(
    private val bookmarkRepository: BookmarkRepository,
    private val settingsStore: SettingsStore,
    private val tabRepository: TabRepository
) : ViewModel() {

    /**
     * 主页 UI 状态。
     *
     * 用 combine 组合 5 个 Flow：
     * - bookmarkRepository.getHomeShortcuts() → homeShortcuts
     * - settingsStore.searchEngine → searchEngine
     * - settingsStore.homeBackgroundUri → backgroundUri
     * - settingsStore.homeLogoUri → logoUri
     * - settingsStore.showHomeShortcuts → showHomeShortcuts
     *
     * stateIn 把 Flow 转成 StateFlow，初始值用 BrowserHomeUiState() 默认值。
     */
    val uiState: StateFlow<BrowserHomeUiState> = combine(
        bookmarkRepository.getHomeShortcuts(),
        settingsStore.searchEngine,
        settingsStore.homeBackgroundUri,
        settingsStore.homeLogoUri,
        settingsStore.showHomeShortcuts
    ) { shortcuts, engine, bgUri, logoUri, showShortcuts ->
        BrowserHomeUiState(
            homeShortcuts = shortcuts,
            searchEngine = engine,
            backgroundUri = bgUri,
            logoUri = logoUri,
            showHomeShortcuts = showShortcuts
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = BrowserHomeUiState()
    )

    /**
     * 根据用户输入创建新标签页，返回 tabId。
     *
     * 时序（Spec M22）：
     * 1. 用 buildUrlFromInput 把输入转换成完整 URL
     * 2. 调用 tabRepository.createTab(url) 插入 Room 并返回 tabId
     * 3. 调用方拿到 tabId 后导航到 browser/{tabId}
     *
     * @param input 用户输入（URL 或搜索词）
     * @return 新标签页的 tabId（UUID 字符串）；输入为空时返回空字符串
     */
    suspend fun createTabAndNavigate(input: String): String {
        val url = buildUrlFromInput(input, uiState.value.searchEngine)
        if (url.isEmpty()) return ""
        return tabRepository.createTab(url = url)
    }
}
