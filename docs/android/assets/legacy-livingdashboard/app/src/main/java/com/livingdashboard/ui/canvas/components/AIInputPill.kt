package com.livingdashboard.ui.canvas.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.ui.canvas.UiChatMessage
import com.livingdashboard.ui.components.MarkdownText
import kotlin.math.max

/**
 * AI 输入框，Spec 6.1 节。
 *
 * v4 #10：实现收起态/展开态切换（layout-design 2.10）。
 *
 * - 收起态：pill 形状输入框（44dp 高，圆角 22dp）
 * - 展开态：上方对话历史（消息气泡列表），下方固定底部输入框（pill + 发送按钮）
 *   融入页面（无边框、无标题）
 * - 点击输入框聚焦 → 自动展开（onFocus 回调）
 * - 点击外部或按返回 → 收起（onCollapse 回调，由父级 BackHandler 处理）
 *
 * M8：消息列表类型从 AiPlaceholderMessage 升级为 [UiChatMessage]，
 * 渲染时按 role 区分：user/assistant/assistant_thinking/tool_call/tool_result/error。
 *
 * @param text 当前输入文本
 * @param onTextChange 文本变化回调
 * @param onSend 发送回调
 * @param expanded 是否展开
 * @param messages 对话历史消息列表（展开态显示）
 * @param onFocus 输入框聚焦回调（触发父级展开）
 * @param onCollapse 收起回调
 * @param modifier 外层 Modifier
 */
@Composable
fun AIInputPill(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    expanded: Boolean,
    messages: List<UiChatMessage>,
    onFocus: () -> Unit,
    onCollapse: () -> Unit,
    modifier: Modifier = Modifier
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(expanded) {
        if (expanded) {
            try {
                focusRequester.requestFocus()
            } catch (e: Exception) {
                // 忽略焦点请求失败
            }
        }
    }
    if (!expanded) {
        // 收起态：pill 形状输入框
        // 修复：高度从 44dp 增至 56dp（Material3 TextField 默认最小高度 56dp），
        // 原 44dp 导致 TextField 内部文字被裁剪（只显示上半部分）
        Row(
            modifier = modifier
                .height(56.dp)
                .background(
                    color = Color(0x0D000000),  // D6 rgba(0,0,0,0.05)
                    shape = RoundedCornerShape(28.dp)
                )
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextField(
                value = text,
                onValueChange = onTextChange,
                placeholder = {
                    Text(
                        text = "有什么想问的...",
                        fontSize = 14.sp,
                        color = Color(0xFF999999)
                    )
                },
                modifier = Modifier.weight(1f),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                interactionSource = remember { MutableInteractionSource() }.also { source ->
                    LaunchedEffect(source) {
                        source.interactions.collect { interaction ->
                            if (interaction is FocusInteraction.Focus) {
                                onFocus()  // 聚焦时自动展开
                            }
                        }
                    }
                }
            )
            IconButton(
                onClick = {
                    onFocus()  // 点击发送按钮也展开
                    onSend()
                },
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    Icons.Default.Send,
                    contentDescription = "发送",
                    tint = Color(0xFF4A90E2)
                )
            }
        }
    } else {
        // 展开态：对话区域融入页面（无边框、无标题）
        Column(modifier = modifier) {
            // 顶部：收起按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                IconButton(onClick = onCollapse) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "收起 AI 对话"
                    )
                }
            }
            // 上方：对话历史（消息气泡列表，按 role 区分渲染）
            if (messages.isEmpty()) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        "开始和 AI 对话吧",
                        fontSize = 22.sp,
                        color = Color(0xFFC7C7CC),
                        fontWeight = FontWeight.Medium
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 任务3/4：用 itemsIndexed 计算 tool_call 累计次数与执行状态，传给 ChatMessageBubble
                    itemsIndexed(messages) { index, msg ->
                        val toolCallCount = messages.take(index + 1).count { it.role == "tool_call" }
                        val isExecuting = msg.role == "tool_call" &&
                            (index == messages.lastIndex ||
                                messages.getOrNull(index + 1)?.role != "tool_result")
                        ChatMessageBubble(
                            msg = msg,
                            toolCallCount = toolCallCount,
                            isExecuting = isExecuting,
                        )
                    }
                }
            }

            // 下方：固定底部输入框（pill + 发送按钮）
            // 修复：高度从 44dp 增至 56dp，圆角从 22dp 增至 28dp 保持 pill 形状
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .background(
                        color = Color(0x0D000000),
                        shape = RoundedCornerShape(28.dp)
                    )
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextField(
                    value = text,
                    onValueChange = onTextChange,
                    placeholder = {
                        Text(
                            text = "输入消息...",
                            fontSize = 14.sp,
                            color = Color(0xFF999999)
                        )
                    },
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focusRequester),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent
                    ),
                    textStyle = LocalTextStyle.current.copy(fontSize = 14.sp)
                )
                IconButton(
                    onClick = onSend,
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        Icons.Default.Send,
                        contentDescription = "发送",
                        tint = Color(0xFF4A90E2)
                    )
                }
            }
        }
    }
}

/**
 * 单条聊天消息气泡，按 role 区分样式（Spec 6.11.2 / 6.11.3 节）。
 *
 * - "user"：右对齐，浅灰底
 * - "assistant"：左对齐，更浅灰底；!isComplete 时尾部显示加载点
 * - "assistant_thinking"：左对齐，任务3 思维链默认折叠（"已思考 Xs"），点击展开显示完整内容
 * - "tool_call"：左对齐，任务4 顶部渐变流动条 + "工具执行了 N 次" 摘要 + 执行中状态
 * - "tool_result"：左对齐，✅/❌ 前缀，等宽小字
 * - "error"：左对齐，红色 ⚠ 前缀
 *
 * @param msg 消息体
 * @param toolCallCount 任务4：当前 tool_call 累计次数（含本次，1-indexed）
 * @param isExecuting 任务4：该 tool_call 是否仍在执行（无后续 tool_result）
 */
@Composable
private fun ChatMessageBubble(
    msg: UiChatMessage,
    toolCallCount: Int = 0,
    isExecuting: Boolean = false,
) {
    val isUser = msg.role == "user"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        when (msg.role) {
            "user" -> MessageBubble(
                text = msg.content,
                bgColor = Color(0x0D000000),
                textColor = Color(0xFF333333)
            )
            "assistant" -> Row(verticalAlignment = Alignment.CenterVertically) {
                MessageBubble(
                    text = msg.content,
                    bgColor = Color(0x08000000),
                    textColor = Color(0xFF333333)
                )
                // 流式累积中：显示加载指示
                if (!msg.isComplete) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .padding(start = 4.dp)
                            .size(10.dp),
                        strokeWidth = 1.5.dp,
                        color = Color(0xFF4A90E2)
                    )
                }
            }
            // 任务3：思维链默认折叠，点击展开
            "assistant_thinking" -> ThinkingBubble(text = msg.content)
            // 任务4：工具调用，渐变流动条 + 摘要 + 执行状态
            "tool_call" -> ToolCallBubble(
                text = msg.content,
                toolCallCount = toolCallCount,
                isExecuting = isExecuting,
            )
            "tool_result" -> MessageBubble(
                text = msg.content,
                bgColor = Color(0x05000000),
                textColor = Color(0xFF666666),
                fontSize = 12
            )
            "error" -> MessageBubble(
                text = msg.content,
                bgColor = Color(0x1AF44336),
                textColor = Color(0xFFD32F2F),
                fontWeight = FontWeight.Medium,
                fontSize = 12
            )
            else -> MessageBubble(
                text = msg.content,
                bgColor = Color(0x08000000),
                textColor = Color(0xFF333333)
            )
        }
    }
}

/**
 * 任务3：思维链气泡（默认折叠）。
 *
 * 折叠态：可点击 Row，显示"已思考 Xs" + ExpandMore 图标。
 * 展开态：完整思维内容（斜体灰色小字）+ ExpandLess 图标。
 *
 * 思考时长为基于内容长度的估算（约 30 字符/秒），仅作 UI 展示用途。
 *
 * @param text 思维链完整文本
 */
@Composable
private fun ThinkingBubble(text: String) {
    var thinkingExpanded by remember { mutableStateOf(false) }
    // 估算思考时长（约 30 字符/秒），最少 1s
    val estimatedSeconds = max(1, text.length / 30)
    Column {
        Row(
            modifier = Modifier
                .clickable { thinkingExpanded = !thinkingExpanded }
                .padding(horizontal = 12.dp, vertical = 6.dp)
                .background(
                    color = Color(0x05000000),
                    shape = RoundedCornerShape(12.dp),
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "已思考 ${estimatedSeconds}s",
                fontSize = 11.sp,
                color = Color(0xFF888888),
                fontStyle = FontStyle.Italic,
            )
            Icon(
                imageVector = if (thinkingExpanded) Icons.Default.ExpandLess
                else Icons.Default.ExpandMore,
                contentDescription = if (thinkingExpanded) "收起思维链" else "展开思维链",
                tint = Color(0xFF888888),
                modifier = Modifier
                    .padding(start = 2.dp)
                    .size(14.dp),
            )
        }
        AnimatedVisibility(visible = thinkingExpanded) {
            MessageBubble(
                text = text,
                bgColor = Color(0x05000000),
                textColor = Color(0xFF888888),
                fontStyle = FontStyle.Italic,
                fontSize = 11
            )
        }
    }
}

/**
 * 任务4：工具调用气泡（默认折叠，点击展开）。
 *
 * 折叠态：可点击的摘要行，显示工具名 + 执行状态 + 展开/收起图标。
 * 展开态：显示渐变流动条 + "工具执行了 N 次" 摘要 + 工具调用内容气泡 + 执行中状态。
 *
 * - 顶部 3dp 渐变流动条（1.8s 线性循环动画，透明 → 蓝 → 透明 水平位移）
 * - "工具执行了 N 次" 摘要文字
 * - 工具调用内容气泡
 * - 若仍在执行，显示"命令执行中..."状态文字
 *
 * @param text 工具调用内容
 * @param toolCallCount 累计工具调用次数（含本次）
 * @param isExecuting 是否仍在执行（无后续 tool_result）
 */
@Composable
private fun ToolCallBubble(
    text: String,
    toolCallCount: Int,
    isExecuting: Boolean,
) {
    var expanded by remember { mutableStateOf(false) }
    // 1.8s 线性循环动画
    val infiniteTransition = rememberInfiniteTransition(label = "toolFlow")
    val progress by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "toolFlowProgress",
    )
    Column(modifier = Modifier.fillMaxWidth(0.75f)) {
        // 折叠态摘要行（可点击展开）
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 12.dp, vertical = 6.dp)
                .background(
                    color = Color(0x0A000000),
                    shape = RoundedCornerShape(8.dp)
                ),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "${text.removePrefix("🔧 ")}${if (isExecuting) " ..." else " ✓"}",
                fontSize = 11.sp,
                color = Color(0xFF888888),
                modifier = Modifier.weight(1f)
            )
            Icon(
                imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                contentDescription = if (expanded) "收起" else "展开",
                tint = Color(0xFF888888),
                modifier = Modifier.size(14.dp)
            )
        }
        // 展开态：显示详细内容（渐变条 + 工具名 + 执行状态）
        AnimatedVisibility(visible = expanded) {
            Column {
                // 渐变流动条
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .drawBehind {
                            val w = size.width
                            // 高光从左到右循环移动：透明 → 蓝 → 透明
                            val brush = Brush.linearGradient(
                                colors = listOf(
                                    Color.Transparent,
                                    Color(0xFF4A90E2),
                                    Color.Transparent,
                                ),
                                start = Offset(x = -w + progress * 2f * w, y = 0f),
                                end = Offset(x = progress * 2f * w, y = 0f),
                            )
                            drawRect(brush)
                        }
                )
                // 工具执行次数摘要
                Text(
                    text = "工具执行了 $toolCallCount 次",
                    fontSize = 11.sp,
                    color = Color(0xFF999999),
                    modifier = Modifier.padding(start = 12.dp, top = 2.dp),
                )
                // 工具调用内容气泡
                MessageBubble(
                    text = text,
                    bgColor = Color(0x0A000000),
                    textColor = Color(0xFF555555),
                    fontWeight = FontWeight.Medium,
                    fontSize = 12
                )
                // 执行中状态文字
                if (isExecuting) {
                    Text(
                        text = "命令执行中...",
                        fontSize = 11.sp,
                        color = Color(0xFF4A90E2),
                        modifier = Modifier.padding(start = 12.dp, top = 2.dp),
                    )
                }
            }
        }
    }
}

/** 消息气泡（统一圆角背景 + 文本，支持 Markdown 渲染） */
@Composable
private fun MessageBubble(
    text: String,
    bgColor: Color,
    textColor: Color,
    fontStyle: FontStyle = FontStyle.Normal,
    fontWeight: FontWeight = FontWeight.Normal,
    fontSize: Int = 13,
) {
    val hasMarkdown = text.contains("**") || text.contains("##") ||
        text.contains("```") || text.contains("\n- ") || text.contains("`")
    Box(
        modifier = Modifier
            .background(
                color = bgColor,
                shape = RoundedCornerShape(12.dp)
            )
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        if (hasMarkdown) {
            // 含 markdown 语法的用 MarkdownText 渲染
            MarkdownText(
                markdown = text,
                textColor = textColor,
                fontSize = fontSize.sp,
                modifier = Modifier
            )
        } else {
            // 纯文本用 Text
            Text(
                text = text,
                fontSize = fontSize.sp,
                color = textColor,
                fontStyle = fontStyle,
                fontWeight = fontWeight,
                overflow = TextOverflow.Visible
            )
        }
    }
}


