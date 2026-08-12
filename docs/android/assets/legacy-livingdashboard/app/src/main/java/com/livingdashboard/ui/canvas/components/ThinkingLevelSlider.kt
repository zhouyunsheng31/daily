package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.livingdashboard.ai.ThinkingLevel

/**
 * 思考等级 4 档滑块（Spec 6.11 节，operit 风格）。
 *
 * 实际 [ThinkingLevel] 枚举为 4 档 [ThinkingLevel.AUTO, ThinkingLevel.STANDARD,
 * ThinkingLevel.DEEP, ThinkingLevel.MAX]（ordinal 0/1/2/3），故 slider value 直接用
 * [ThinkingLevel.ordinal] 映射（0f..3f）。
 *
 * Spec 6.11 原文假设枚举为 5 档 [AUTO, STANDARD, DEEP, MAX, ULTRA] 并用 `ordinal - 1`
 * 偏移排除 AUTO，但实际 [ThinkingLevel] 只有 4 档且 4 档全部参与滑块（含 AUTO），
 * 故采用直接映射 `value = selected.ordinal`，反向 `levels[v.toInt()]`。
 *
 * 4 档标签：快速 / 平衡 / 深度 / 极深度（对应 AUTO / STANDARD / DEEP / MAX）。
 *
 * m22 修复：tick 圆点放在 Slider 下方的 Row 中，与 Slider 分层，避免 thumb 与 tick 重叠。
 * m1 修复：steps=N 表示在 valueRange 内插入 N 个离散点（不含两端），总档位数 = N + 2。
 *          4 档需要 steps = 4 - 2 = 2。
 *
 * @param selected 当前思考等级
 * @param onChange 切换回调
 * @param modifier 外层 Modifier
 */
@Composable
fun ThinkingLevelSlider(
    selected: ThinkingLevel,
    onChange: (ThinkingLevel) -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = listOf("快速", "平衡", "深度", "极深度")  // AUTO / STANDARD / DEEP / MAX
    val levels = ThinkingLevel.entries  // 4 档，按 ordinal 排序
    val maxIndex = levels.size - 1  // 3

    Column(modifier = modifier) {
        // m22：Slider 单独一层（thumb 不与 tick 重叠）
        Slider(
            // 直接用 ordinal 映射（4 档枚举 ordinal 0/1/2/3 ↔ value 0f/1f/2f/3f）
            value = selected.ordinal.toFloat().coerceIn(0f, maxIndex.toFloat()),
            onValueChange = { v ->
                val index = v.toInt().coerceIn(0, maxIndex)
                onChange(levels[index])
            },
            valueRange = 0f..maxIndex.toFloat(),
            steps = maxIndex - 1,  // m1：4 档需 steps=2（N+2=档位数，N=2）
            modifier = Modifier.fillMaxWidth(),
        )
        // m22：tick 圆点放在 Slider 下方的 Row 中（与 Slider 分层，不重叠 thumb）
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            repeat(levels.size) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.outline)
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            labels.forEach { label ->
                Text(label, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
