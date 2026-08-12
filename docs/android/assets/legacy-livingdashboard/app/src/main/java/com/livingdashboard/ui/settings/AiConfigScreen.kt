package com.livingdashboard.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.components.PermissionCard
import com.livingdashboard.ui.components.PermissionRequest
import com.livingdashboard.ui.settings.components.ProviderSelector

/**
 * AI 配置页，Spec 6.11.3 节。
 *
 * 表单：
 * 1. Provider 选择（[ProviderSelector]，6 个 provider，含 custom 自定义 OpenAI 兼容 API）
 * 2. API Key 输入框（密码样式，可显示/隐藏）
 * 3. Endpoint 输入框（可选，默认值由 ViewModel 提供）
 * 4. Model 输入框（可选，默认值由 ViewModel 提供）
 * 5. "测试连接"按钮 + 结果显示（✅ 连接成功 / ❌ 连接失败）
 * 6. "保存"按钮（保存配置 + 设为 active provider）
 *
 * @param onClose 关闭页面回调（导航返回）
 * @param viewModel 配置页 ViewModel（Hilt 注入）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiConfigScreen(
    onClose: () -> Unit,
    viewModel: AiConfigViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // API Key 显示/隐藏状态（旋转屏用 rememberSaveable 保留）
    var apiKeyVisible by rememberSaveable { mutableStateOf(false) }

    // 模型列表下拉菜单展开状态（获取成功后自动展开）
    var modelsMenuExpanded by remember { mutableStateOf(false) }

    // 获取模型列表成功后自动展开下拉菜单
    LaunchedEffect(state.models) {
        if (state.models.isNotEmpty()) {
            modelsMenuExpanded = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI 配置") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(Modifier.height(8.dp))

            // 1. Provider 选择
            ProviderSelector(
                selected = state.provider,
                onSelect = viewModel::onProviderChange,
                modifier = Modifier.fillMaxWidth()
            )

            // 2. API Key（密码框，可显示/隐藏）
            OutlinedTextField(
                value = state.apiKey,
                onValueChange = viewModel::onApiKeyChange,
                label = { Text("API Key") },
                singleLine = true,
                visualTransformation = if (apiKeyVisible) VisualTransformation.None
                                      else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { apiKeyVisible = !apiKeyVisible }) {
                        Icon(
                            imageVector = if (apiKeyVisible) Icons.Default.VisibilityOff
                                          else Icons.Default.Visibility,
                            contentDescription = if (apiKeyVisible) "隐藏 API Key" else "显示 API Key"
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth()
            )

            // 3. Endpoint（可选）
            OutlinedTextField(
                value = state.endpoint,
                onValueChange = viewModel::onEndpointChange,
                label = { Text("Endpoint（可选，默认自动填充）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // 4. Model（可选）+ 获取模型列表按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = state.model,
                    onValueChange = viewModel::onModelChange,
                    label = { Text("Model（可选，默认自动填充）") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                Box {
                    OutlinedButton(
                        onClick = viewModel::fetchModels,
                        enabled = state.canFetchModels,
                        modifier = Modifier.padding(top = 8.dp)
                    ) {
                        if (state.isFetchingModels) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                            Spacer(Modifier.size(8.dp))
                            Text("获取中")
                        } else {
                            Text("获取模型列表")
                        }
                    }
                    DropdownMenu(
                        expanded = modelsMenuExpanded,
                        onDismissRequest = { modelsMenuExpanded = false }
                    ) {
                        state.models.forEach { model ->
                            DropdownMenuItem(
                                text = { Text(model) },
                                onClick = {
                                    viewModel.onModelChange(model)
                                    modelsMenuExpanded = false
                                }
                            )
                        }
                    }
                }
            }
            // 获取模型列表错误提示
            state.fetchModelsError?.let { msg ->
                Text(
                    text = msg,
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 12.sp
                )
            }

            Spacer(Modifier.height(4.dp))

            // 5. 测试连接按钮 + 结果显示
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = viewModel::testConnection,
                    enabled = state.canTest,
                    modifier = Modifier.weight(1f)
                ) {
                    if (state.isTesting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                        Spacer(Modifier.size(8.dp))
                        Text("测试中...")
                    } else {
                        Text("测试连接")
                    }
                }
            }

            // 测试结果
            state.testResult?.let { ok ->
                Text(
                    text = if (ok) "✅ 连接成功" else "❌ 连接失败",
                    color = if (ok) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.error,
                    fontSize = 13.sp
                )
            }
            // 错误信息
            state.errorMessage?.let { msg ->
                Text(
                    text = msg,
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 12.sp
                )
            }

            Spacer(Modifier.height(4.dp))

            // 6. 保存按钮
            Button(
                onClick = viewModel::save,
                enabled = state.canSave,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("保存")
            }

            // 7. Skills 管理（占位，后续推出）
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color(0x0A000000))
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Build,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        "Skills 管理功能即将推出",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 14.sp
                    )
                }
            }

            // 权限卡片预览
            Text(
                text = "权限卡片预览",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            PermissionCard(
                request = PermissionRequest(
                    toolName = "browser_open",
                    args = mapOf("url" to "https://example.com"),
                    isDangerous = false,
                    description = "AI 想要打开网页"
                ),
                onAllow = {},
                onDeny = {},
                onAddToWhitelist = {}
            )
            PermissionCard(
                request = PermissionRequest(
                    toolName = "storage_write",
                    args = mapOf("path" to "/data/file.txt"),
                    isDangerous = true,
                    description = "AI 想要写入文件"
                ),
                onAllow = {},
                onDeny = {},
                onAddToWhitelist = {}
            )

            Spacer(Modifier.height(16.dp))
        }
    }
}
