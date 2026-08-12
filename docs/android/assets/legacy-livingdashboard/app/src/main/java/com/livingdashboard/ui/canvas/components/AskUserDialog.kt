package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ai.AskUserDialogState
import com.livingdashboard.ai.AskUserRequest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * AskUser Dialog，Spec 6.11.4 节。
 *
 * 订阅 [AskUserDialogState.state]（StateFlow<AskUserRequest?>），状态从 null → 非 null 时弹 AlertDialog，
 * 用户选择后调 [AskUserDialogState.respond]，取消调 [AskUserDialogState.cancel]。
 *
 * Spec 8.3 节边界用例要求：旋转屏用 rememberSaveable 保留已选状态，
 * 避免旋转导致用户已选的选项丢失。
 *
 * 选项数据结构（JsonObject，参考 Spec 6.9.5）：
 * - label: String 选项显示文本
 * - value: String 选项值
 * - description: String? 选项描述（可选）
 *
 * 多选模式（allowMultiple=true）：用 Checkbox 列表，确定按钮提交所有选中项
 * 单选模式（allowMultiple=false）：点击选项即提交
 *
 * @param askUserDialogState 全局 AskUser 状态持有者（Hilt 注入单例）
 */
@Composable
fun AskUserDialog(
    askUserDialogState: AskUserDialogState,
) {
    val request by askUserDialogState.state.collectAsStateWithLifecycle()
    val current = request ?: return

    AskUserDialogContent(
        request = current,
        onRespond = { selectedValues ->
            askUserDialogState.respond(current.requestId, selectedValues)
        },
        onCancel = {
            askUserDialogState.cancel(current.requestId)
        }
    )
}

/**
 * Dialog 内容（独立出来便于 rememberSaveable 绑定 requestId）。
 *
 * 用 rememberSaveable 保存多选已选列表（按 requestId 隔离），
 * 旋转屏后状态保留，避免用户重新选择。
 */
@Composable
private fun AskUserDialogContent(
    request: AskUserRequest,
    onRespond: (List<String>) -> Unit,
    onCancel: () -> Unit,
) {
    // 单选输入框（无 options 时用自由输入）
    var freeInput by rememberSaveable(request.requestId) { mutableStateOf("") }

    // 多选已选列表：用 rememberSaveable 保存（按 requestId 隔离，旋转屏保留）
    val selectedValues = rememberSaveable(
        key = request.requestId,
        saver = stringListSaver,
    ) { mutableStateListOf<String>() }

    AlertDialog(
        onDismissRequest = onCancel,
        title = {
            Text(
                text = request.question,
                fontWeight = FontWeight.SemiBold
            )
        },
        text = {
            Column {
                if (request.options.isEmpty()) {
                    // 无选项：单输入框（自由输入）
                    OutlinedTextField(
                        value = freeInput,
                        onValueChange = { freeInput = it },
                        label = { Text("输入回答") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                } else if (request.allowMultiple) {
                    // 多选模式：Checkbox 列表
                    Text(
                        text = "可多选（已选 ${selectedValues.size} 项）",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 320.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(request.options) { option ->
                            val (label, value, description) = option.parseOption()
                            val isSelected = value in selectedValues
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .selectable(
                                        selected = isSelected,
                                        onClick = {
                                            if (isSelected) selectedValues.remove(value)
                                            else selectedValues.add(value)
                                        }
                                    )
                                    .padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(
                                    checked = isSelected,
                                    onCheckedChange = null
                                )
                                Spacer(Modifier.padding(end = 8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = label,
                                        style = MaterialTheme.typography.bodyLarge
                                    )
                                    description?.let {
                                        Text(
                                            text = it,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // 单选模式：点击即提交（参考 Spec 6.11.4 文本）
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 320.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(request.options) { option ->
                            val (label, value, description) = option.parseOption()
                            TextButton(
                                onClick = { onRespond(listOf(value)) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(modifier = Modifier.fillMaxWidth()) {
                                    Text(
                                        text = label,
                                        style = MaterialTheme.typography.bodyLarge
                                    )
                                    description?.let {
                                        Text(
                                            text = it,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (request.allowMultiple) {
                // 多选模式才有"确定"按钮
                TextButton(onClick = { onRespond(selectedValues.toList()) }) {
                    Text("确定")
                }
            } else if (request.options.isEmpty()) {
                // 自由输入模式也有"确定"按钮
                TextButton(onClick = { onRespond(listOf(freeInput.trim())) }) {
                    Text("确定")
                }
            }
            // 单选选项模式：选项即按钮，无 confirmButton
        },
        dismissButton = {
            TextButton(onClick = onCancel) { Text("取消") }
        }
    )
}

/**
 * 解析 JsonObject 选项为 (label, value, description) 三元组。
 *
 * Spec 6.9.5 选项结构：{label: String, value: String, description?: String}
 * 兼容性：若缺 label 则用 value 兜底，若缺 value 则用 label 兜底。
 */
private fun JsonObject.parseOption(): Triple<String, String, String?> {
    val label = this["label"]?.jsonPrimitive?.contentOrNull
        ?: this["value"]?.jsonPrimitive?.contentOrNull
        ?: "选项"
    val value = this["value"]?.jsonPrimitive?.contentOrNull
        ?: this["label"]?.jsonPrimitive?.contentOrNull
        ?: label
    val description = this["description"]?.jsonPrimitive?.contentOrNull
    return Triple(label, value, description)
}

/**
 * SnapshotStateList<String> 的 Saver，配合 rememberSaveable 保留多选状态。
 */
private val stringListSaver: Saver<SnapshotStateList<String>, ArrayList<String>> =
    Saver(
        save = { ArrayList(it) },
        restore = { mutableStateListOf<String>().apply { addAll(it) } }
    )
