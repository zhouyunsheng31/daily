package com.livingdashboard.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Tab
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.ui.theme.GlassBackground
import com.livingdashboard.ui.theme.UserBubbleColor

/**
 * 底部栏（Spec 3.3.5 + 7.4 节 M2 扩展 + 6.13 节 M3 AI 模式）。
 *
 * 三种显示模式（M3 6.13 + 设计稿状态 1/2/3）：
 * - 按钮行（默认）：5 按钮 [后退/缩小][前进/放大][Home][标签][⋮]
 * - AI 输入框（aiMode=true）：灯泡 + 输入框 + 蓝色圆形发送按钮
 * - AI 工作态（aiWorking=true）：三点跳动 + 状态文字 + 时钟图标
 *
 * 左滑切换 AI 模式（onSwipeLeftToAiMode），右滑切回按钮模式（onSwipeRightToButtonMode）。
 * 底部栏顶部显示左右滑动指示器（箭头 + 拖拽条 + 提示文字）。
 *
 * @param mode 底部栏模式（BROWSER / CANVAS，默认 BROWSER 保持 M1 兼容）
 * @param modifier 修饰符
 * @param canGoBack WebView 是否可后退（浏览器模式用）
 * @param canGoForward WebView 是否可前进（浏览器模式用）
 * @param onBack 后退按钮回调
 * @param onForward 前进按钮回调
 * @param onHome Home 按钮回调
 * @param onTabs 标签按钮回调
 * @param onMore 更多按钮回调
 * @param onZoomOut 缩小按钮回调（画布模式）
 * @param onZoomIn 放大按钮回调（画布模式）
 * @param tabCount 当前标签总数（浏览器模式徽章用）
 * @param aiMode M3：是否处于 AI 输入框模式
 * @param aiInputText M3：AI 输入框文本
 * @param onAiInputTextChange M3：AI 输入框文本变化回调
 * @param onAiSend M3：AI 发送回调
 * @param onSwipeLeftToAiMode M3：左滑切换到 AI 模式
 * @param onSwipeRightToButtonMode M3：右滑切回按钮模式
 * @param showSwipeHint 任务2：是否显示左右滑动指示器（仅浏览器页传 true）
 * @param aiWorking AI 工作态（true=显示三点跳动状态 pill，优先于 aiMode）
 * @param aiWorkingStatusText AI 工作态状态文字（如"AI 正在浏览 baidu.com..."）
 * @param onExpandAiPanel 点击工作态 pill 展开对话面板回调
 */
@Composable
fun BottomBar(
    mode: BottomBarMode = BottomBarMode.BROWSER,
    modifier: Modifier = Modifier,
    canGoBack: Boolean = false,
    canGoForward: Boolean = false,
    onBack: () -> Unit = {},
    onForward: () -> Unit = {},
    onHome: () -> Unit = {},
    onTabs: () -> Unit = {},
    onMore: () -> Unit = {},
    onZoomOut: () -> Unit = {},
    onZoomIn: () -> Unit = {},
    tabCount: Int = 0,
    // M3 6.13 新增：AI 输入框模式
    aiMode: Boolean = false,
    aiInputText: String = "",
    onAiInputTextChange: (String) -> Unit = {},
    onAiSend: () -> Unit = {},
    onSwipeLeftToAiMode: () -> Unit = {},
    onSwipeRightToButtonMode: () -> Unit = {},
    showSwipeHint: Boolean = false,
    // AI 工作态（设计稿状态 3/3）
    aiWorking: Boolean = false,
    aiWorkingStatusText: String = "",
    onExpandAiPanel: () -> Unit = {},
) {
    // swipe 累计偏移量（任务2：左滑 < -80f 切 AI 模式，右滑 > 80f 切回按钮模式）
    var totalDrag by remember { mutableStateOf(0f) }

    // D6 白色洁净色系 + 毛玻璃（Spec 9.3：背景 rgba(255,255,255,0.85) + blur(20dp)）
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .glassmorphism(blurRadius = 20.dp, backgroundColor = GlassBackground)
            // 任务2：左右滑切换 AI 模式（替换原上下滑）。仅当 showSwipeHint=true 时拦截手势，
            // 避免在画布页等其他页面误触发空回调。
            .pointerInput(showSwipeHint) {
                if (!showSwipeHint) return@pointerInput
                detectHorizontalDragGestures(
                    onDragStart = { totalDrag = 0f },
                    onDragEnd = {
                        if (totalDrag < -80f) onSwipeLeftToAiMode()
                        else if (totalDrag > 80f) onSwipeRightToButtonMode()
                    },
                ) { _, dragAmount ->
                    totalDrag += dragAmount
                }
            },
        color = Color.Transparent,
        tonalElevation = 3.dp
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // 任务2：左右滑动指示器（仅浏览器页显示）
            if (showSwipeHint) {
                SwipeHintRow(aiMode = aiMode || aiWorking)
            }
            // 三态判断：aiWorking 优先于 aiMode 优先于默认按钮行
            when {
                aiWorking -> AiWorkingBar(
                    statusText = aiWorkingStatusText,
                    onExpandAiPanel = onExpandAiPanel,
                )
                aiMode -> AiInputBar(
                    text = aiInputText,
                    onTextChange = onAiInputTextChange,
                    onSend = onAiSend,
                )
                else -> ButtonRow(
                    mode = mode,
                    canGoBack = canGoBack,
                    canGoForward = canGoForward,
                    onBack = onBack,
                    onForward = onForward,
                    onHome = onHome,
                    onTabs = onTabs,
                    onMore = onMore,
                    onZoomOut = onZoomOut,
                    onZoomIn = onZoomIn,
                    tabCount = tabCount,
                )
            }
        }
    }
}

/**
 * 任务2：左右滑动指示器。
 *
 * 顶部一行：左箭头 + 36x4 dp 圆角拖拽条 + 右箭头，居中显示。
 * 下方一行：提示文字，AI 模式时显示"左右滑动切回底部栏"，否则显示"左右滑动切换 AI"。
 *
 * @param aiMode 是否处于 AI 输入框模式（决定提示文字）
 */
@Composable
private fun SwipeHintRow(aiMode: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 2.dp, bottom = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier.padding(top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Default.ChevronLeft,
                contentDescription = null,
                tint = Color(0xFF999999),
                modifier = Modifier.size(16.dp),
            )
            Box(
                modifier = Modifier
                    .padding(horizontal = 4.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .background(
                        color = Color(0xFFCCCCCC),
                        shape = RoundedCornerShape(2.dp),
                    )
            )
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = Color(0xFF999999),
                modifier = Modifier.size(16.dp),
            )
        }
        Text(
            text = if (aiMode) "左右滑动切回底部栏" else "左右滑动切换 AI",
            fontSize = 10.sp,
            color = Color(0xFF999999),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 2.dp),
        )
    }
}

/**
 * AI 输入框 pill（设计稿状态 2/3）：灯泡 + 输入框 + 蓝色圆形发送按钮。
 *
 * 样式对齐设计稿：pill 容器（圆角 22 + userBubble 背景）+ 灯泡 leadingIcon +
 * 蓝色圆形发送按钮（32dp 圆形 #4A90E2 底色 + 白色 Send 图标）。
 */
@Composable
private fun AiInputBar(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        try {
            focusRequester.requestFocus()
        } catch (e: Exception) {
            // 忽略焦点请求失败
        }
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(top = 6.dp, bottom = 10.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(UserBubbleColor)
                .padding(start = 16.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            // 左侧灯泡图标
            Icon(
                imageVector = Icons.Default.Lightbulb,
                contentDescription = null,
                tint = Color(0xFF4A90E2),
                modifier = Modifier.size(18.dp),
            )
            // 中间输入框
            TextField(
                value = text,
                onValueChange = onTextChange,
                placeholder = { Text("有什么想问的...", style = MaterialTheme.typography.bodySmall) },
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusRequester),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                textStyle = MaterialTheme.typography.bodySmall,
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(
                    onSend = {
                        onSend()
                        keyboard?.hide()
                    }
                ),
            )
            // 右侧蓝色圆形发送按钮（32dp 圆形 #4A90E2 底色 + 白色 Send 图标）
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF4A90E2))
                    .clickable {
                        onSend()
                        keyboard?.hide()
                    }
                    .semantics { contentDescription = "发送" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Send,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        // 底部提示文字
        Text(
            text = "点击输入框向上弹起对话面板",
            fontSize = 9.sp,
            color = Color(0xFF86868B),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
        )
    }
}

/**
 * AI 工作态 pill（设计稿状态 3/3）：三点跳动 + 状态文字 + 时钟图标。
 *
 * 点击此 pill 展开 AI 对话面板（调用 onExpandAiPanel）。
 */
@Composable
private fun AiWorkingBar(
    statusText: String,
    onExpandAiPanel: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
            .padding(top = 6.dp, bottom = 10.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(Color(0x144A90E2))  // rgba(74,144,226,0.08)
                .clickable { onExpandAiPanel() }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // 三点跳动动画
            AiWorkingDots()
            // 状态文字（斜体，aiAccent 色）
            Text(
                text = statusText.ifEmpty { "AI 正在工作..." },
                fontSize = 13.sp,
                color = Color(0xFF4A90E2),
                fontStyle = FontStyle.Italic,
                modifier = Modifier.weight(1f),
            )
            // 时钟图标
            Icon(
                imageVector = Icons.Default.Schedule,
                contentDescription = null,
                tint = Color(0xFF4A90E2),
                modifier = Modifier.size(16.dp),
            )
        }
        // 底部提示文字
        Text(
            text = "点击展开 AI 对话面板",
            fontSize = 9.sp,
            color = Color(0xFF86868B),
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
        )
    }
}

/**
 * 三点跳动动画（infiniteTransition + 三个小圆点错相位透明度动画）。
 *
 * 对齐设计稿 aiPulse 动效：1.2s 周期，三点错相位 0.15s，透明度 0.4↔1。
 */
@Composable
private fun AiWorkingDots() {
    val transition = rememberInfiniteTransition(label = "aiWorkingDots")
    val animValues = (0..2).map { i ->
        transition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 600, delayMillis = i * 150),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "dot$i",
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        animValues.forEach { anim ->
            val alpha by anim
            Box(
                modifier = Modifier
                    .size(5.dp)
                    .background(
                        color = Color(0xFF4A90E2).copy(alpha = alpha),
                        shape = CircleShape,
                    )
            )
        }
    }
}

/**
 * 按钮行（原 BottomBar 的按钮布局，M3 抽出复用）。
 */
@Composable
private fun ButtonRow(
    mode: BottomBarMode,
    canGoBack: Boolean,
    canGoForward: Boolean,
    onBack: () -> Unit,
    onForward: () -> Unit,
    onHome: () -> Unit,
    onTabs: () -> Unit,
    onMore: () -> Unit,
    onZoomOut: () -> Unit,
    onZoomIn: () -> Unit,
    tabCount: Int,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        when (mode) {
            BottomBarMode.BROWSER -> {
                IconButton(
                    onClick = onBack,
                    enabled = canGoBack,
                    modifier = Modifier.semantics { contentDescription = "后退" }
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = null,
                        tint = if (canGoBack) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                    )
                }

                IconButton(
                    onClick = onForward,
                    enabled = canGoForward,
                    modifier = Modifier.semantics { contentDescription = "前进" }
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                        tint = if (canGoForward) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                    )
                }

                IconButton(
                    onClick = onHome,
                    modifier = Modifier.semantics { contentDescription = "主页" }
                ) {
                    // 功能2：BROWSER 模式 Home 图标右下角叠加紫色 SwapHoriz 转换标识
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Home,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .size(12.dp)
                                .clip(CircleShape)
                                .background(Color.White),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.SwapHoriz,
                                contentDescription = null,
                                modifier = Modifier.size(9.dp),
                                tint = Color(0xFF6650A4)  // 紫色
                            )
                        }
                    }
                }

                BadgedBox(
                    badge = {
                        if (tabCount > 0) {
                            Badge {
                                Text(
                                    text = if (tabCount > 99) "99+" else tabCount.toString()
                                )
                            }
                        }
                    },
                    modifier = Modifier.padding(top = 8.dp)
                ) {
                    IconButton(
                        onClick = onTabs,
                        modifier = Modifier.semantics { contentDescription = "标签页" }
                    ) {
                        Icon(
                            imageVector = Icons.Default.Tab,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }

                IconButton(
                    onClick = onMore,
                    modifier = Modifier.semantics { contentDescription = "更多" }
                ) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }
            }

            BottomBarMode.CANVAS -> {
                IconButton(
                    onClick = onZoomOut,
                    modifier = Modifier.semantics { contentDescription = "缩小" }
                ) {
                    Icon(
                        imageVector = Icons.Default.ZoomOut,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }

                IconButton(
                    onClick = onZoomIn,
                    modifier = Modifier.semantics { contentDescription = "放大" }
                ) {
                    Icon(
                        imageVector = Icons.Default.ZoomIn,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }

                IconButton(
                    onClick = onHome,
                    modifier = Modifier.semantics { contentDescription = "主页" }
                ) {
                    // CANVAS 模式保持纯 Home（无转换标识）
                    Icon(
                        imageVector = Icons.Default.Home,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }

                IconButton(
                    onClick = onTabs,
                    modifier = Modifier.semantics { contentDescription = "标签页" }
                ) {
                    Icon(
                        imageVector = Icons.Default.Tab,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }

                IconButton(
                    onClick = onMore,
                    modifier = Modifier.semantics { contentDescription = "更多" }
                ) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }
    }
}
