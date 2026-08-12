package com.livingdashboard.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.HistoryEntity
import com.livingdashboard.data.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/**
 * 历史记录 UI 状态（Spec 3.3.8）。
 *
 * @param historyByDate 按日期分组的历史记录（key: "今天"/"昨天"/"更早"，用 LinkedHashMap 保持顺序）
 */
data class HistoryUiState(
    val historyByDate: Map<String, List<HistoryEntity>> = emptyMap()
)

/**
 * 历史记录 ViewModel（Spec 3.3.8）。
 *
 * 注入 `HistoryRepository`，按日期分组（今天/昨天/更早）展示历史记录。
 *
 * 分组逻辑：用 `LocalDate` 计算 visitedAt 属于今天/昨天/更早。
 *
 * 方法：
 * - `deleteHistory(entity)`：删除单条历史
 * - `clearAll()`：清空所有历史
 * - `search(query)`：实时搜索过滤（空=显示全部）
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val historyRepository: HistoryRepository
) : ViewModel() {

    // 搜索查询（空=显示全部）
    private val _searchQuery = MutableStateFlow("")

    /**
     * 按日期分组的历史记录状态。
     *
     * - 搜索框为空时收集 `getAll()`
     * - 搜索框有内容时收集 `search(query)`
     * - 结果按日期分组（今天/昨天/更早），用 LinkedHashMap 保持顺序
     */
    val uiState: StateFlow<HistoryUiState> = _searchQuery
        .flatMapLatest { query ->
            if (query.isBlank()) {
                historyRepository.getAll()
            } else {
                historyRepository.search(query.trim())
            }
        }
        .map { list -> HistoryUiState(groupByDate(list)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), HistoryUiState())

    /**
     * 搜索历史（实时过滤）。
     *
     * @param query 搜索关键词（空=显示全部）
     */
    fun search(query: String) {
        _searchQuery.value = query
    }

    /**
     * 删除单条历史记录。
     *
     * @param entity 要删除的历史记录实体
     */
    suspend fun deleteHistory(entity: HistoryEntity) {
        historyRepository.delete(entity)
    }

    /**
     * 清空所有历史记录。
     */
    suspend fun clearAll() {
        historyRepository.deleteAll()
    }

    /**
     * 按日期分组（今天/昨天/更早）。
     *
     * 用 `LocalDate` 计算 visitedAt 所属日期，保持"今天 → 昨天 → 更早"的顺序。
     * 历史记录已按 visitedAt DESC 排序（来自 DAO），分组后组内顺序不变。
     *
     * @param history 历史记录列表（已按 visitedAt DESC 排序）
     * @return 分组后的 Map（key: "今天"/"昨天"/"更早"）
     */
    private fun groupByDate(history: List<HistoryEntity>): Map<String, List<HistoryEntity>> {
        val today = LocalDate.now()
        val yesterday = today.minusDays(1)
        val zone = ZoneId.systemDefault()
        // 用 LinkedHashMap 保持插入顺序（今天 → 昨天 → 更早）
        val result = LinkedHashMap<String, MutableList<HistoryEntity>>()
        for (entity in history) {
            val date = Instant.ofEpochMilli(entity.visitedAt).atZone(zone).toLocalDate()
            val key = when {
                date == today -> "今天"
                date == yesterday -> "昨天"
                else -> "更早"
            }
            result.getOrPut(key) { mutableListOf() }.add(entity)
        }
        return result
    }
}
