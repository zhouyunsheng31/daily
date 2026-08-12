package com.livingdashboard.ui.widget

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * CalculatorWidget（Spec A.3）。
 *
 * 用 `com.ezylang:Eval:4.0.0`（EvalEx）库解析表达式（NC4 修复，不用 javax.script）。
 *
 * 显示屏 + 按钮网格（0-9, +, -, ×, ÷, =, C, .）。
 *
 * 分层渲染（D9）：
 * - THUMBNAIL：计算器图标
 * - SUMMARY：当前表达式
 * - INTERACTIVE/FULL：完整计算器界面
 *
 * @param params 渲染参数（M2 表达式为组件内部状态，不持久化）
 */
@Composable
fun CalculatorWidget(params: WidgetRenderParams) {
    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> CalculatorThumbnail(params)
        ZoomLevel.SUMMARY -> CalculatorSummary(params)
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> CalculatorInteractive(params)
    }
}

/** 缩略图：计算器图标（Spec A.3） */
@Composable
private fun CalculatorThumbnail(params: WidgetRenderParams) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.Calculate,
            contentDescription = "计算器",
            modifier = Modifier.size(24.dp),
            tint = Color(0xFF666666)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = params.title.ifEmpty { "计算器" },
            fontSize = 10.sp,
            color = Color(0xFF999999),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 摘要：当前表达式（Spec A.3） */
@Composable
private fun CalculatorSummary(params: WidgetRenderParams) {
    val expression = (params.state["expression"] as? String).orEmpty()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = params.title.ifEmpty { "计算器" },
            fontSize = 12.sp,
            color = Color(0xFF333333),
            maxLines = 1
        )
        Text(
            text = expression.ifEmpty { "待计算" },
            fontSize = 14.sp,
            color = Color(0xFF666666),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 交互/完整：完整计算器界面（Spec A.3） */
@Composable
private fun CalculatorInteractive(params: WidgetRenderParams) {
    var expression by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    // 按钮布局：4 列网格，最后一行 C 占满
    val buttons = listOf(
        "7", "8", "9", "÷",
        "4", "5", "6", "×",
        "1", "2", "3", "-",
        "0", ".", "=", "+",
        "C"
    )

    Column(
        modifier = Modifier.fillMaxSize().padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        // 表达式显示
        Text(
            text = expression.ifEmpty { "0" },
            fontSize = 16.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(4.dp),
            color = Color(0xFF333333),
            textAlign = TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        // 结果显示
        Text(
            text = error.ifEmpty { result },
            fontSize = 24.sp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(4.dp),
            color = if (error.isNotEmpty()) Color(0xFFFF3B30) else Color(0xFF333333),
            textAlign = TextAlign.End,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )

        // 按钮网格
        for (row in buttons.chunked(4)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                for (btn in row) {
                    // C 单独一行时占满宽度（weight = 1f），其余按钮均分
                    val isCEndRow = row.size == 1 && btn == "C"
                    Button(
                        onClick = {
                            when (btn) {
                                "C" -> {
                                    expression = ""
                                    result = ""
                                    error = ""
                                }
                                "=" -> {
                                    if (expression.isNotBlank()) {
                                        try {
                                            val evalResult = CalculatorEngine.evaluate(expression)
                                            result = CalculatorEngine.formatResult(evalResult)
                                            error = ""
                                        } catch (e: Exception) {
                                            error = "错误"
                                            result = ""
                                        }
                                    }
                                }
                                else -> {
                                    expression += btn
                                    error = ""
                                }
                            }
                        },
                        modifier = Modifier
                            .weight(if (isCEndRow) 4f else 1f)
                            .fillMaxHeight(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = when (btn) {
                                "=" -> Color(0xFF4A90E2)
                                "C" -> Color(0xFFFFE0E0)
                                else -> Color(0x0D000000)
                            },
                            contentColor = when (btn) {
                                "=" -> Color.White
                                "C" -> Color(0xFFFF3B30)
                                else -> Color(0xFF333333)
                            }
                        ),
                        contentPadding = PaddingValues(4.dp)
                    ) {
                        Text(btn, fontSize = 16.sp)
                    }
                }
            }
        }
    }
}
