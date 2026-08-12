package com.livingdashboard.ui.canvas

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 收藏组件页 ViewModel，Spec 6.5 节。
 *
 * v4 #2 修复：原代码 state = emptyMap() 且 onUpdateState = { _ -> }，组件状态不同步。
 * 现新建此 ViewModel 注入 CanvasRepository，加载 widget.stateJson 并持久化状态变更。
 *
 * 职责：
 * - 加载指定 widgetId 的组件数据（含真实 stateJson）
 * - 持久化组件状态变更（同步到原面板，D7 真实引用）
 * - 取消收藏
 *
 * @param canvasRepository 画布 Repository（Hilt 注入）
 */
@HiltViewModel
class WebOSFavoritesViewModel @Inject constructor(
    private val canvasRepository: CanvasRepository
) : ViewModel() {

    /**
     * 加载指定 widgetId 的组件数据（含真实 stateJson）。
     *
     * 从 observeAggregateWidgets() 中查找（聚合面板包含所有收藏组件）。
     *
     * @param widgetId 组件 ID
     * @return 组件数据 Flow（首次可能为 null，加载后变为非 null）
     */
    fun observeWidget(widgetId: String): Flow<WidgetEntity?> =
        canvasRepository.observeAggregateWidgets().map { widgets ->
            widgets.find { it.id == widgetId }
        }

    /**
     * v4 #2：持久化组件状态变更（同步到原面板，D7 真实引用）。
     *
     * @param widgetId 组件 ID
     * @param newState 新状态
     */
    fun updateWidgetState(widgetId: String, newState: Map<String, Any>) {
        viewModelScope.launch {
            canvasRepository.updateWidgetState(widgetId, newState)
        }
    }

    /**
     * 取消收藏。
     *
     * @param widgetId 组件 ID
     */
    fun toggleFavorite(widgetId: String) {
        viewModelScope.launch {
            canvasRepository.toggleFavorite(widgetId)
        }
    }
}
