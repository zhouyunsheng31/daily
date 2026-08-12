package com.livingdashboard.ui.settings.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * LLM Provider 选项数据。
 *
 * @param id provider 标识（与 ApiKeyStore 一致）
 * @param displayName 显示名称
 * @param optional 是否为可选项（标"（可选）"后缀，当前无 provider 使用）
 */
private data class ProviderOption(
    val id: String,
    val displayName: String,
    val optional: Boolean = false,
)

/**
 * 6 个支持的 LLM Provider 列表。
 *
 * 顺序固定（与 ApiKeyStore.listConfiguredProviders 一致）：
 * stepfun / openai / deepseek / anthropic / qwen / custom
 */
private val PROVIDER_OPTIONS: List<ProviderOption> = listOf(
    ProviderOption("stepfun", "StepFun（阶跃星辰）"),
    ProviderOption("openai", "OpenAI"),
    ProviderOption("deepseek", "DeepSeek（深度求索）"),
    ProviderOption("anthropic", "Anthropic（Claude）"),
    ProviderOption("qwen", "通义千问（Qwen）"),
    ProviderOption("custom", "自定义 API（兼容 OpenAI 协议）"),
)

/**
 * Provider 下拉选择器，Spec 6.11.3 节。
 *
 * 用 ExposedDropdownMenuBox（Material 3）展示 6 个 provider，
 * 第 6 个为 custom（自定义 OpenAI 兼容 API）。
 *
 * @param selected 当前选中的 provider id（如 "stepfun"）
 * @param onSelect 选中回调（传 provider id）
 * @param modifier 外层 Modifier
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderSelector(
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    val selectedDisplay = PROVIDER_OPTIONS.firstOrNull { it.id == selected }?.displayName
        ?: if (selected.isBlank()) "" else selected

    Box(modifier = modifier.fillMaxWidth()) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = it },
        ) {
            OutlinedTextField(
                value = selectedDisplay,
                onValueChange = { },
                readOnly = true,
                label = { Text("Provider") },
                trailingIcon = {
                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor()
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                PROVIDER_OPTIONS.forEach { option ->
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = if (option.optional) "${option.displayName}（可选）"
                                       else option.displayName,
                                fontWeight = if (option.id == selected) FontWeight.SemiBold
                                             else FontWeight.Normal,
                                fontSize = 14.sp
                            )
                        },
                        onClick = {
                            onSelect(option.id)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}
