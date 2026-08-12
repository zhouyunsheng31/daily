package com.livingdashboard.ai

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import java.util.UUID

/**
 * AskUser Dialog 状态持有者（Spec 6.9.5 + task 1.8）。
 *
 * 持有 [StateFlow]<[AskUserRequest]?>，UI 层订阅 [state] 显示 Dialog，
 * 工具调用 [showAndWait] 挂起等待用户响应或超时。
 *
 * 设计要点：
 * - 工具侧只调 [showAndWait]，不直接操作 StateFlow
 * - UI 侧观察 [state]，状态从 null→非 null 时弹 Dialog，调 [respond]/[cancel] 关闭
 * - 用 [CompletableDeferred] 解耦工具挂起与 UI 回调，避免 callback hell
 * - timeout 仅做超时兜底（默认 120s，与 Spec 一致）
 */
class AskUserDialogState {
    private val _state = MutableStateFlow<AskUserRequest?>(null)
    val state: StateFlow<AskUserRequest?> = _state

    /**
     * 弹出询问并等待用户响应。
     *
     * @param question 问题文本
     * @param options 选项列表（JSON Object 数组，UI 可读 label/value）
     * @param allowMultiple 是否允许多选
     * @param timeoutMs 超时毫秒，默认 120s（Spec 6.9.5）
     * @return 用户选择的 selectedValues；超时返回 null（由调用方决定如何处理）
     */
    suspend fun showAndWait(
        question: String,
        options: List<JsonObject>,
        allowMultiple: Boolean,
        timeoutMs: Long = 120_000,
    ): List<String>? {
        val completer = CompletableDeferred<List<String>?>()
        val request = AskUserRequest(
            requestId = UUID.randomUUID().toString(),
            question = question,
            options = options,
            allowMultiple = allowMultiple,
            completer = completer,
        )
        _state.value = request
        return try {
            withTimeoutOrNull(timeoutMs) { completer.await() }
        } finally {
            // 仅当 state 还指向本请求时才清空，避免覆盖后续新请求
            if (_state.value?.requestId == request.requestId) {
                _state.value = null
            }
        }
    }

    /** UI 层调用：用户已响应，把结果传回工具。 */
    fun respond(requestId: String, selectedValues: List<String>) {
        val current = _state.value
        if (current?.requestId == requestId) {
            current.completer.complete(selectedValues)
        }
    }

    /** UI 层调用：用户取消（点 Dialog 外部或按返回键）。 */
    fun cancel(requestId: String) {
        val current = _state.value
        if (current?.requestId == requestId) {
            current.completer.complete(null)
        }
    }
}

/**
 * 一次询问请求（UI 订阅 AskUserDialogState.state 显示 Dialog）。
 *
 * @param requestId 唯一 ID，UI 响应时回传以避免竞态
 * @param question 问题文本
 * @param options 选项列表（JSON Object 数组，UI 可读 label/value）
 * @param allowMultiple 是否允许多选
 * @param completer 完成回调（CompletableDeferred），UI 调用 complete 传回结果
 */
data class AskUserRequest(
    val requestId: String,
    val question: String,
    val options: List<JsonObject>,
    val allowMultiple: Boolean,
    val completer: CompletableDeferred<List<String>?>,
)
