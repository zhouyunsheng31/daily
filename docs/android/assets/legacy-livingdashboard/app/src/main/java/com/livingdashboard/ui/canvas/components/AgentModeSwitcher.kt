package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.ai.AgentMode
import com.livingdashboard.ai.RuntimeModeState
import com.livingdashboard.ai.ThinkingLevel

/**
 * Agent 模式切换器 + 思考等级滑块，Spec 6.11.1 + 6.11 节。
 *
 * M3 改动（spec 4.2）：
 * - m3 修复：移除切换到 CLOUD 模式时的 Toast 提示（CLOUD 模式为常态，无需每次弹 Toast 打扰用户）
 * - 用 [ThinkingLevelSlider] 替换 [ThinkingLevelDropdown]（operit 风格 4 档滑块）
 *
 * 布局：
 * 1. SegmentedButton（CLOUD / AUTO / LOCAL 三选一）
 * 2. ThinkingLevelSlider（快速 / 平衡 / 深度 / 极深度 4 档）
 * 3. 离线降级提示：观察 [runtimeMode] 的 effectiveMode/isOfflineDowngraded
 *    - isOfflineDowngraded=true → 显示 "⚠ 离线模式（已降级到本地）"
 *    - effectiveMode == CLOUD 且未在线时由 isOfflineDowngraded 覆盖
 *
 * @param runtimeMode 运行时模式状态（含 selectedMode + effectiveMode + isOfflineDowngraded）
 * @param thinkingLevel 当前思考等级
 * @param onModeChange 模式切换回调
 * @param onThinkingLevelChange 思考等级切换回调
 * @param modifier 外层 Modifier
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentModeSwitcher(
    runtimeMode: RuntimeModeState,
    thinkingLevel: ThinkingLevel,
    onModeChange: (AgentMode) -> Unit,
    onThinkingLevelChange: (ThinkingLevel) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 1. 模式切换 SegmentedButton（云端/本地/AUTO 三选一）
            SingleChoiceSegmentedButtonRow(
                modifier = Modifier.fillMaxWidth()
            ) {
                AgentMode.entries.forEachIndexed { index, mode ->
                    SegmentedButton(
                        selected = runtimeMode.mode == mode,
                        // m3 修复：移除 CLOUD Toast，CLOUD 模式为常态
                        onClick = { onModeChange(mode) },
                        shape = SegmentedButtonDefaults.itemShape(
                            index = index,
                            count = AgentMode.entries.size
                        )
                    ) {
                        Text(text = mode.label, fontSize = 12.sp)
                    }
                }
            }

            // 2. 思考等级滑块（M3：替换 ThinkingLevelDropdown）
            ThinkingLevelSlider(
                selected = thinkingLevel,
                onChange = onThinkingLevelChange,
                modifier = Modifier.fillMaxWidth()
            )
        }

        // 3. 离线降级提示
        if (runtimeMode.isOfflineDowngraded) {
            Text(
                text = "⚠ 离线模式（已降级到本地）",
                color = MaterialTheme.colorScheme.error,
                fontSize = 11.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

/**
 * 思考等级下拉选择器，Spec 6.11.1 节（1/2/3/4）。
 *
 * M3 保留作为参考（[AgentModeSwitcher] 已改用 [ThinkingLevelSlider]）。
 *
 * @param selected 当前等级
 * @param onChange 切换回调
 * @param modifier 外层 Modifier
 */
@Composable
fun ThinkingLevelDropdown(
    selected: ThinkingLevel,
    onChange: (ThinkingLevel) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text(
                text = "思考: ${selected.label}",
                fontSize = 12.sp,
                modifier = Modifier.weight(1f)
            )
            Icon(
                imageVector = Icons.Default.ArrowDropDown,
                contentDescription = null
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            ThinkingLevel.entries.forEach { level ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = "${level.label}（${level.value}）",
                            fontWeight = if (level == selected) FontWeight.Bold else FontWeight.Normal,
                            fontSize = 13.sp
                        )
                    },
                    onClick = {
                        onChange(level)
                        expanded = false
                    }
                )
            }
        }
    }
}
