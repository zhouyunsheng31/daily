package com.livingdashboard.ui.canvas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.PanelEntity
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 画布面板 Tab ViewModel，Spec 6.7 节。
 *
 * 替代原 PanelManagerViewModel，迁入 ui/canvas/ 包，由 TabManagerScreen
 * 的"画布面板"Tab 复用（v4 #12：M2 在 M1 TabManagerScreen 顶部加 TabRow）。
 *
 * 职责：
 * - 观察所有面板（observePanels）
 * - 创建面板（createPanel）
 * - 删除面板（deletePanel，聚合面板不可删除，D12）
 *
 * @param canvasRepository 画布 Repository（Hilt 注入）
 */
@HiltViewModel
class PanelTabViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository
) : ViewModel() {

    /**
     * 所有面板列表（按 sortOrder ASC 排序）。
     *
     * 包含 NORMAL 类型（用户面板）和 AGGREGATE 类型（聚合面板，系统创建，不可删除）。
     */
    val panels: StateFlow<List<PanelEntity>> = canvasRepository.observePanels()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    /**
     * 创建新面板（NORMAL 类型）。
     *
     * @param name 面板名称
     */
    fun createPanel(name: String) {
        viewModelScope.launch {
            canvasRepository.createPanel(name)
        }
    }

    /**
     * 删除面板（聚合面板不可删除，D12）。
     *
     * 删除时：
     * - widget_positions 外键 CASCADE 自动删除
     * - widgets 需手动清理（CanvasRepository.deletePanel 内部处理）
     *
     * @param panel 要删除的面板
     */
    fun deletePanel(panel: PanelEntity) {
        viewModelScope.launch {
            canvasRepository.deletePanel(panel)
        }
    }
}
