package com.livingdashboard.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.TabEntity
import com.livingdashboard.data.prefs.SettingsStore
import com.livingdashboard.data.repository.TabRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/**
 * MainActivity 顶层 ViewModel（Spec 3.5 节 NC3 修复 + Spec 7.3 节 M2 扩展）。
 *
 * 职责：
 * 1. 处理外部 URL（ACTION_VIEW Intent）→ 创建标签页 → 返回 tabId 供导航
 * 2. 暴露主题色索引 Flow（供 LivingDashboardTheme 使用）
 * 3. M2 新增：App 模式（BROWSER/CANVAS）状态机 + Home 键规则（D3）
 * 4. M2 新增：当前是否在主页（isAtHome）状态
 * 5. M2 新增：当前面板 ID（currentPanelId）状态
 *
 * 不持有 WebView/Activity 引用，纯数据层逻辑。
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@HiltViewModel
class MainViewModel @Inject constructor(
    private val tabRepository: TabRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    /**
     * 主题色索引（-1=跟随系统 dynamicColor，0..5=预设主题色）。
     *
     * 从 settingsStore.themeColorIndex Flow 收集，转成 StateFlow 供 Composable 订阅。
     * 用 SharingStarted.Eagerly 保证主题色在 UI 订阅前就开始收集（避免冷启动时主题色延迟生效）。
     */
    val themeColorIndex: StateFlow<Int> = settingsStore.themeColorIndex
        .stateIn(viewModelScope, SharingStarted.Eagerly, -1)

    /**
     * D4：首次启动选择的主页模式（null = 未选择，"browser" / "canvas"）。
     *
     * 用 SharingStarted.WhileSubscribed(5000) 避免没有订阅者时仍持续收集。
     * 初始值 null 表示首次启动，UI 据此显示 HomeModeSelectorScreen。
     */
    val defaultHomeMode: StateFlow<String?> = settingsStore.defaultHomeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    /**
     * M2 新增：App 模式（浏览器 / 画布）。
     *
     * 由 [onHomePressed] / [switchMode] / [setDefaultHomeMode] 切换。
     * 在 init 块中根据 defaultHomeMode 初始化。
     */
    private val _appMode = MutableStateFlow(AppMode.BROWSER)
    val appMode: StateFlow<AppMode> = _appMode.asStateFlow()

    /**
     * M2 新增：当前是否在当前模式的主页（D3 Home 键规则用）。
     *
     * - true：当前在 BrowserHomeScreen 或 CanvasHomeScreen
     * - false：当前在 BrowserScreen / CanvasScreen / 其他子页
     *
     * 由 [onEnterHome] / [onLeaveHome] 修改，AppNavGraph 监听 destination 变化自动调用。
     */
    private val _isAtHome = MutableStateFlow(true)
    val isAtHome: StateFlow<Boolean> = _isAtHome.asStateFlow()

    /**
     * M2 新增：当前面板 ID（画布模式用）。
     *
     * 由 CanvasHomeViewModel 在用户切换面板时通过 [setCurrentPanelId] 设置，
     * AppNavGraph 中 CanvasHomeScreen 路由通过此 ID 决定下滑进入哪个画布。
     */
    private val _currentPanelId = MutableStateFlow<String?>(null)
    val currentPanelId: StateFlow<String?> = _currentPanelId.asStateFlow()

    init {
        // 读取 defaultHomeMode 初始化 appMode（首次启动后保留用户上次选择）
        viewModelScope.launch {
            val mode = settingsStore.defaultHomeMode.first()
            if (mode != null) {
                _appMode.value = if (mode == "canvas") AppMode.CANVAS else AppMode.BROWSER
            }
        }
    }

    /**
     * 为外部 URL 创建新标签页，返回 tabId。
     *
     * 时序（Spec M22）：先生成 UUID → 插入 Room → 返回 tabId。
     * 调用方拿到 tabId 后再导航到 browser/{tabId}，保证导航时 tabId 已存在。
     *
     * @param url 外部 URL（http/https）
     * @return tabId（UUID 字符串）
     */
    suspend fun createTabForUrl(url: String): String {
        val newTabId = UUID.randomUUID().toString()
        val tab = TabEntity(
            id = newTabId,
            title = "新标签页",
            url = url,
            sortOrder = System.currentTimeMillis().toInt()
        )
        tabRepository.insert(tab)  // suspend，等 Room 写入完成
        return newTabId
    }

    /**
     * 创建空白标签页，返回 tabId。
     *
     * 用于书签/历史等场景需要新建标签的场景（与 createTabForUrl 区别在于不预设 URL）。
     *
     * @return tabId（UUID 字符串）
     */
    suspend fun createBlankTab(): String {
        val newTabId = UUID.randomUUID().toString()
        val tab = TabEntity(
            id = newTabId,
            title = "新标签页",
            url = "",
            sortOrder = System.currentTimeMillis().toInt()
        )
        tabRepository.insert(tab)
        return newTabId
    }

    // ===== M2 新增：Home 键状态机（Spec 7.2-7.3 节） =====

    /**
     * D4：首次启动设置默认主页模式。
     *
     * 调用时机：用户在 HomeModeSelectorScreen 选择"浏览器"/"画布"后调用。
     * 同时更新 appMode 状态，立即生效。
     *
     * @param mode "browser" 或 "canvas"
     */
    fun setDefaultHomeMode(mode: String) {
        viewModelScope.launch {
            settingsStore.setDefaultHomeMode(mode)
            _appMode.value = if (mode == "canvas") AppMode.CANVAS else AppMode.BROWSER
        }
    }

    /**
     * 切换模式（BROWSER ↔ CANVAS）。
     *
     * 由 [onHomePressed] 在"已在主页"状态下调用，
     * 或由外部（如设置页"默认主页"项）主动调用。
     * 切换后回到新模式的主页（isAtHome = true）。
     */
    fun switchMode() {
        _appMode.value = if (_appMode.value == AppMode.BROWSER) AppMode.CANVAS else AppMode.BROWSER
        _isAtHome.value = true
    }

    /**
     * 切换到指定模式（不切换则保持）。
     *
     * 用于外部明确知道目标模式的场景（如设置页选择"默认主页"）。
     *
     * @param mode 目标模式
     */
    fun switchMode(mode: AppMode) {
        _appMode.value = mode
        _isAtHome.value = true
    }

    /**
     * D3：Home 键处理。
     *
     * 规则（Spec 7.2 节）：
     * - 如果不在当前模式主页（isAtHome = false），先回当前模式主页
     * - 如果已在当前模式主页（isAtHome = true），切换到另一模式的主页
     *
     * 导航回主页的逻辑由 AppNavGraph 监听 isAtHome 状态处理。
     */
    fun onHomePressed() {
        if (_isAtHome.value) {
            // 已在主页 → 切换模式
            switchMode()
        } else {
            // 不在主页 → 回当前模式主页
            _isAtHome.value = true
            // 导航回主页的逻辑由 AppNavGraph 监听 isAtHome 处理
        }
    }

    /**
     * 离开主页（进入子页面）。
     *
     * 由 AppNavGraph 监听 destination 变化自动调用（destination 不是 home/canvas_home 时）。
     */
    fun onLeaveHome() {
        _isAtHome.value = false
    }

    /**
     * 进入主页（导航回主页时调用）。
     *
     * 由 AppNavGraph 监听 destination 变化自动调用（destination 是 home/canvas_home 时）。
     */
    fun onEnterHome() {
        _isAtHome.value = true
    }

    /**
     * 设置当前面板 ID（画布模式用）。
     *
     * @param id 面板 ID，null 表示无选中面板
     */
    fun setCurrentPanelId(id: String?) {
        _currentPanelId.value = id
    }
}
