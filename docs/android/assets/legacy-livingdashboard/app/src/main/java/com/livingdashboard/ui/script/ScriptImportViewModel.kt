package com.livingdashboard.ui.script

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.script.ImportResult
import com.livingdashboard.script.ScriptInjector
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 脚本导入通知 ViewModel（M4 修复 P1，方式 C 自动导入 + 全局 Snackbar 通知）。
 *
 * 职责：
 * - 订阅 [ScriptInjector.importEvents] SharedFlow，将 [ImportResult] 转换为
 *   [importNotifications] StateFlow 供 UI 层（MainActivity）观察
 * - 暴露 [consumeNotification] 让 UI 消费通知后清空，避免重复显示
 *
 * 设计说明：
 * - ScriptInjector 是 @Singleton，importEvents 是应用级共享 Flow，
 *   ScriptImportViewModel 作为 @HiltViewModel 在 MainActivity 中通过 hiltViewModel() 获取，
 *   其生命周期跟随 MainActivity（Activity scope），Activity 重建时 ViewModel 复用
 * - init 块在 viewModelScope 中 collect，Activity 销毁时自动取消订阅
 * - 用 MutableStateFlow 而非 SharedFlow，因为 UI 需要"最新值"语义
 *   （configuration change 后能恢复最近一条未消费的通知）
 *
 * @param scriptInjector 用户脚本注入器（@Singleton，提供 importEvents SharedFlow）
 */
@HiltViewModel
class ScriptImportViewModel @Inject constructor(
    private val scriptInjector: ScriptInjector,
) : ViewModel() {

    private val _importNotifications = MutableStateFlow<ImportResult?>(null)
    val importNotifications: StateFlow<ImportResult?> = _importNotifications.asStateFlow()

    init {
        viewModelScope.launch {
            scriptInjector.importEvents.collect { result ->
                _importNotifications.value = result
            }
        }
    }

    /**
     * 消费当前通知（UI 显示 Snackbar 后调用，清空 StateFlow 避免重复显示）。
     */
    fun consumeNotification() {
        _importNotifications.value = null
    }
}
