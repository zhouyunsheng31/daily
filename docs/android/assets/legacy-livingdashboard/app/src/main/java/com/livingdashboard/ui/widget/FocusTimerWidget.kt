package com.livingdashboard.ui.widget

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * FocusTimerWidget（Spec A.4）。
 *
 * 25/5 番茄钟：25 分钟专注 + 5 分钟休息，自动切换阶段。
 *
 * 状态机（通过 [WidgetRenderParams.onStateChange] 持久化）：
 * - mode: "focus" | "break" —— 当前阶段
 * - status: "idle" | "running" | "paused" —— 计时状态
 * - startedAt: Long —— 开始时间戳（running 时用）
 * - pausedRemainingMs: Long —— 暂停时保存的剩余毫秒（paused 时用）
 *
 * 分层渲染（D9）：
 * - THUMBNAIL：专注图标 + 剩余时间
 * - SUMMARY：当前阶段 + 剩余时间
 * - INTERACTIVE/FULL：圆形进度条 + 时间显示 + 开始/暂停/重置按钮
 *
 * 用 Coroutines + delay 实现计时（每 200ms 刷新一次显示）。
 *
 * @param params 渲染参数，state 包含 mode/status/startedAt/pausedRemainingMs
 */
@Composable
fun FocusTimerWidget(params: WidgetRenderParams) {
    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> FocusTimerThumbnail(params)
        ZoomLevel.SUMMARY -> FocusTimerSummary(params)
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> FocusTimerInteractive(params)
    }
}

private const val FOCUS_MS = 25 * 60 * 1000L
private const val BREAK_MS = 5 * 60 * 1000L

/** 从 state 读取当前阶段总时长 */
private fun totalMs(mode: String): Long = if (mode == "break") BREAK_MS else FOCUS_MS

/** 计算当前剩余时间 */
private fun computeRemaining(
    status: String,
    startedAt: Long,
    pausedRemainingMs: Long,
    mode: String,
    now: Long
): Long {
    val total = totalMs(mode)
    return when (status) {
        "running" -> if (startedAt > 0) (total - (now - startedAt)).coerceAtLeast(0) else total
        "paused" -> if (pausedRemainingMs > 0) pausedRemainingMs else total
        else -> total
    }
}

/** 格式化剩余时间为 mm:ss */
private fun formatTime(ms: Long): String {
    val total = ms.coerceAtLeast(0)
    val minutes = (total / 60000).toInt()
    val seconds = ((total % 60000) / 1000).toInt()
    return String.format("%02d:%02d", minutes, seconds)
}

/** 缩略图：专注图标 + 剩余时间（Spec A.4） */
@Composable
private fun FocusTimerThumbnail(params: WidgetRenderParams) {
    val mode = (params.state["mode"] as? String) ?: "focus"
    val status = (params.state["status"] as? String) ?: "idle"
    val startedAt = (params.state["startedAt"] as? Number)?.toLong() ?: 0L
    val pausedRemainingMs = (params.state["pausedRemainingMs"] as? Number)?.toLong() ?: 0L
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(status) {
        while (status == "running") {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val remaining = computeRemaining(status, startedAt, pausedRemainingMs, mode, now)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.Timer,
            contentDescription = "专注",
            modifier = Modifier.size(24.dp),
            tint = if (mode == "break") Color(0xFF34C759) else Color(0xFF4A90E2)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = formatTime(remaining),
            fontSize = 10.sp,
            color = Color(0xFF666666),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 摘要：当前阶段 + 剩余时间（Spec A.4） */
@Composable
private fun FocusTimerSummary(params: WidgetRenderParams) {
    val mode = (params.state["mode"] as? String) ?: "focus"
    val status = (params.state["status"] as? String) ?: "idle"
    val startedAt = (params.state["startedAt"] as? Number)?.toLong() ?: 0L
    val pausedRemainingMs = (params.state["pausedRemainingMs"] as? Number)?.toLong() ?: 0L
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(status) {
        while (status == "running") {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val remaining = computeRemaining(status, startedAt, pausedRemainingMs, mode, now)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = if (mode == "break") "休息中" else "专注中",
            fontSize = 12.sp,
            color = if (mode == "break") Color(0xFF34C759) else Color(0xFF4A90E2)
        )
        Text(
            text = formatTime(remaining),
            fontSize = 14.sp,
            color = Color(0xFF333333)
        )
    }
}

/** 交互/完整：圆形进度条 + 时间 + 按钮（Spec A.4） */
@Composable
private fun FocusTimerInteractive(params: WidgetRenderParams) {
    val mode = (params.state["mode"] as? String) ?: "focus"
    val status = (params.state["status"] as? String) ?: "idle"
    val startedAt = (params.state["startedAt"] as? Number)?.toLong() ?: 0L
    val pausedRemainingMs = (params.state["pausedRemainingMs"] as? Number)?.toLong() ?: 0L
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    // 计时循环：running 时每 200ms 刷新 now
    LaunchedEffect(status, mode) {
        while (status == "running") {
            now = System.currentTimeMillis()
            // 倒计时结束：自动切换阶段
            val remaining = computeRemaining(status, startedAt, pausedRemainingMs, mode, now)
            if (remaining <= 0L) {
                // 切换 focus ↔ break
                val nextMode = if (mode == "focus") "break" else "focus"
                params.onStateChange(
                    mapOf(
                        "mode" to nextMode,
                        "status" to "idle",
                        "startedAt" to 0L,
                        "pausedRemainingMs" to totalMs(nextMode)
                    )
                )
                break
            }
            delay(200)
        }
    }

    val total = totalMs(mode)
    val remaining = computeRemaining(status, startedAt, pausedRemainingMs, mode, now)
    val progress = (remaining.toFloat() / total.toFloat()).coerceIn(0f, 1f)
    val accentColor = if (mode == "break") Color(0xFF34C759) else Color(0xFF4A90E2)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // 圆形进度条 + 时间显示（自适应可用空间）
        Box(
            modifier = Modifier.weight(1f).aspectRatio(1f),
            contentAlignment = Alignment.Center
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val strokeWidth = 12.dp.toPx()
                val diameter = minOf(size.width, size.height) - strokeWidth
                val topLeft = Offset(
                    (size.width - diameter) / 2f,
                    (size.height - diameter) / 2f
                )
                val arcSize = Size(diameter, diameter)
                // 背景圆环
                drawArc(
                    color = Color(0xFFEEEEEE),
                    startAngle = -90f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                )
                // 进度圆环（从顶部顺时针，随剩余时间缩短）
                drawArc(
                    color = accentColor,
                    startAngle = -90f,
                    sweepAngle = 360f * progress,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = if (mode == "break") "休息" else "专注",
                    fontSize = 12.sp,
                    color = Color(0xFF999999)
                )
                Text(
                    text = formatTime(remaining),
                    fontSize = 32.sp,
                    color = Color(0xFF333333)
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // 控制按钮：开始/暂停 + 重置
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Button(
                onClick = {
                    when (status) {
                        "idle" -> {
                            // 开始：记录 startedAt
                            params.onStateChange(
                                mapOf(
                                    "mode" to mode,
                                    "status" to "running",
                                    "startedAt" to System.currentTimeMillis(),
                                    "pausedRemainingMs" to 0L
                                )
                            )
                        }
                        "running" -> {
                            // 暂停：保存剩余时间
                            val curRemaining = computeRemaining(
                                status, startedAt, pausedRemainingMs, mode, System.currentTimeMillis()
                            )
                            params.onStateChange(
                                mapOf(
                                    "mode" to mode,
                                    "status" to "paused",
                                    "startedAt" to 0L,
                                    "pausedRemainingMs" to curRemaining
                                )
                            )
                        }
                        "paused" -> {
                            // 恢复：startedAt 回拨，使 remaining = pausedRemainingMs
                            val newStartedAt = System.currentTimeMillis() - (total - pausedRemainingMs)
                            params.onStateChange(
                                mapOf(
                                    "mode" to mode,
                                    "status" to "running",
                                    "startedAt" to newStartedAt,
                                    "pausedRemainingMs" to 0L
                                )
                            )
                        }
                    }
                },
                modifier = Modifier.size(56.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = accentColor),
                contentPadding = PaddingValues(0.dp)
            ) {
                Icon(
                    imageVector = if (status == "running") Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (status == "running") "暂停" else "开始",
                    tint = Color.White
                )
            }

            // 重置按钮
            Button(
                onClick = {
                    params.onStateChange(
                        mapOf(
                            "mode" to mode,
                            "status" to "idle",
                            "startedAt" to 0L,
                            "pausedRemainingMs" to total
                        )
                    )
                },
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0x1A000000),
                    contentColor = Color(0xFF666666)
                ),
                contentPadding = PaddingValues(0.dp)
            ) {
                Icon(Icons.Default.Refresh, contentDescription = "重置")
            }
        }
    }
}
