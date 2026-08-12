package com.livingdashboard.ui.script

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * 脚本编辑页（Spec 2.6.6 / Phase M4 T6）。
 *
 * 表单字段：name / namespace / version / description / author /
 *           matches（多行）/ excludes（多行）/ grants（多行）/ runAt（dropdown）/ enabled（switch）
 * 代码编辑器：多行 TextField，monospace 字体
 *
 * **M4 关键修复**：保存时表单字段是 source of truth，用
 * [ScriptMetadataParser.rewriteMetadata] 重写代码的 ==UserScript== 块。
 *
 * @param scriptId 脚本 ID（null = 新建模式）
 * @param onClose 关闭回调
 * @param viewModel 编辑 ViewModel（Hilt 注入）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScriptEditScreen(
    scriptId: String?,
    onClose: () -> Unit,
    viewModel: ScriptEditViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // 加载脚本（scriptId != null 时）
    LaunchedEffect(scriptId) {
        viewModel.loadScript(scriptId)
    }

    // 保存成功后关闭
    LaunchedEffect(state.saved) {
        if (state.saved) {
            viewModel.consumeSaved()
            onClose()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (scriptId == null) "新建脚本" else "编辑脚本") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    TextButton(
                        onClick = viewModel::save,
                        enabled = !state.isSaving && !state.isLoading && state.name.isNotBlank(),
                    ) {
                        Text("保存")
                    }
                }
            )
        }
    ) { padding ->
        if (state.isLoading) {
            Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 16.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Spacer(Modifier.height(8.dp))

                // 基础字段
                OutlinedTextField(
                    value = state.name,
                    onValueChange = { viewModel.updateFormField("name", it) },
                    label = { Text("名称 *") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.namespace,
                    onValueChange = { viewModel.updateFormField("namespace", it) },
                    label = { Text("命名空间（namespace）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.version,
                    onValueChange = { viewModel.updateFormField("version", it) },
                    label = { Text("版本（version）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.description,
                    onValueChange = { viewModel.updateFormField("description", it) },
                    label = { Text("描述") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.author,
                    onValueChange = { viewModel.updateFormField("author", it) },
                    label = { Text("作者") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                // 多行字段
                OutlinedTextField(
                    value = state.matches,
                    onValueChange = { viewModel.updateFormField("matches", it) },
                    label = { Text("匹配规则（@match，每行一个）") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                OutlinedTextField(
                    value = state.excludes,
                    onValueChange = { viewModel.updateFormField("excludes", it) },
                    label = { Text("排除规则（@exclude，每行一个）") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                OutlinedTextField(
                    value = state.grants,
                    onValueChange = { viewModel.updateFormField("grants", it) },
                    label = { Text("GM_ 权限（@grant，每行一个）") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )

                // 运行时机 dropdown
                RunAtDropdown(
                    value = state.runAt,
                    onValueChange = { viewModel.updateFormField("runAt", it) },
                )

                // 启用开关
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "启用",
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(
                        checked = state.enabled,
                        onCheckedChange = { viewModel.updateFormField("enabled", it) },
                    )
                }

                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                // 代码编辑器（monospace）
                OutlinedTextField(
                    value = state.code,
                    onValueChange = viewModel::updateCode,
                    label = { Text("代码正文（保存时将用表单字段重写 ==UserScript== 元数据块）") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 8,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace,
                    ),
                )

                // 错误信息
                state.errorMessage?.let { msg ->
                    Text(
                        text = msg,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }

                // 底部按钮
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Button(
                        onClick = viewModel::save,
                        enabled = !state.isSaving && !state.isLoading && state.name.isNotBlank(),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (state.isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                            Spacer(Modifier.size(8.dp))
                            Text("保存中...")
                        } else {
                            Text("保存")
                        }
                    }
                    TextButton(onClick = onClose) { Text("取消") }
                }

                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/**
 * 运行时机下拉选择器（@run-at）。
 *
 * 三档：document-start / document-end / document-idle
 * 用 ExposedDropdownMenuBox 实现（Material3 风格）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RunAtDropdown(
    value: String,
    onValueChange: (String) -> Unit,
) {
    val options = listOf("document-start", "document-end", "document-idle")
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text("运行时机（@run-at）") },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
            },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(opt) },
                    onClick = {
                        onValueChange(opt)
                        expanded = false
                    },
                )
            }
        }
    }
}
