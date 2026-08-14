package xyz.shadowshub.daily.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel
import xyz.shadowshub.daily.R

/**
 * 对话主页（M1-1 收尾 · 按定稿设计语言重做：清亮通透 + 平面化）。
 * - 极简顶栏：E1 光点 logo + 状态/称呼 + 用量 chip（设置入口待 M1-1 后接入）
 * - 气泡：用户右=亮蓝 #4F8CFF 白字；AI 左=白卡 + 细边框
 * - 思考折叠条（样式化）/ 工具 chip（状态色）
 * - 空会话建议卡片（📐文案待用户定，当前为占位）
 * - 毛玻璃输入栏（半透明白 + 圆角 24 + 亮蓝发送钮）
 */
@Composable
fun ChatScreen(viewModel: ChatViewModel = koinViewModel()) {
    val state by viewModel.state.collectAsState()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // 新消息自动滚到底
    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.content?.length) {
        val last = state.messages.size
        if (last > 0) listState.animateScrollToItem(last - 1)
    }

    Column(modifier = Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        // ---- 极简状态行（无 logo / 无标题，仅异常与用量信息；正常时空）----
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val statusText = when {
                !state.sessionReady && state.sessionError != null -> "⚠️ ${state.sessionError}"
                state.streaming -> "● AI 思考中…"
                state.busyWaiting -> "⏳ ${state.busyMessage ?: "排队中…"}"
                state.error != null -> "⚠️ ${state.error}"
                else -> null
            }
            if (statusText != null) {
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.labelMedium,
                    color = when {
                        state.error != null || state.sessionError != null -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.primary
                    },
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(Modifier.weight(1f))
            }
            state.lastUsage?.let {
                Surface(
                    shape = RoundedCornerShape(99.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f),
                ) {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
        }

        // 会话失败：重试
        if (!state.sessionReady && state.sessionError != null) {
            Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { viewModel.initSession() }) { Text("重试连接") }
            }
        }

        // ---- 消息列表 ----
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (state.messages.isEmpty()) {
                item { EmptyState() }
            }
            items(state.messages, key = { it.id }) { msg ->
                MessageBubble(msg)
            }
        }

        // 断线恢复条
        if (state.error != null && state.sessionReady) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                TextButton(onClick = { viewModel.resume() }) { Text("断线了 · 点击恢复") }
            }
        }

        // ---- 毛玻璃输入栏 ----
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f))
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(24.dp))
                .padding(start = 16.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = Brush.linearGradient(listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primary)),
                enabled = state.sessionReady,
                singleLine = false,
                maxLines = 5,
                decorationBox = { inner ->
                    Box {
                        if (input.isEmpty()) {
                            Text(
                                "输入消息…",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        inner()
                    }
                },
            )
            Spacer(Modifier.width(6.dp))
            Surface(
                shape = CircleShape,
                color = if (state.streaming) MaterialTheme.colorScheme.surfaceVariant
                else MaterialTheme.colorScheme.primary,
            ) {
                IconButton(
                    onClick = {
                        if (state.streaming) viewModel.stop()
                        else {
                            viewModel.send(input)
                            input = ""
                        }
                    },
                    enabled = state.sessionReady,
                ) {
                    Icon(
                        if (state.streaming) Icons.Filled.Stop else Icons.AutoMirrored.Filled.Send,
                        contentDescription = if (state.streaming) "停止" else "发送",
                        tint = if (state.streaming) MaterialTheme.colorScheme.onSurfaceVariant else Color.White,
                    )
                }
            }
        }
    }
}

/** 空会话：E1 生成图 logo + 引导 + 建议卡片（📐文案待用户定） */
@Composable
private fun EmptyState() {
    Column(Modifier.fillMaxWidth().padding(top = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Image(
            painter = painterResource(R.drawable.icon_e1_logo),
            contentDescription = "Daily",
            modifier = Modifier.size(96.dp).clip(CircleShape),
        )
        Spacer(Modifier.height(14.dp))
        Text("和 AI 说点什么吧", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.height(4.dp))
        Text(
            "我能做 App、改桌面、查资料、画画",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(18.dp))
        listOf("帮我做个待办清单 App", "把桌面换成深色主题", "介绍一下 Daily").forEach { suggestion ->
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
            ) {
                Text(
                    suggestion,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(msg: UiMessage) {
    val isUser = msg.role == "user"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 310.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        ) {
            // 思考折叠条（AI）
            if (!isUser && msg.thinking.isNotEmpty()) {
                Text(
                    text = "💭 ${if (msg.thinking.length > 120) msg.thinking.take(120) + "…" else msg.thinking}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp, bottom = 3.dp),
                )
            }
            // 工具 chip 序列（AI）
            if (!isUser) {
                msg.toolChips.forEach { chip ->
                    val stateIcon = when (chip.state) {
                        "ok" -> "✓"
                        "fail" -> "✗"
                        else -> "…"
                    }
                    val chipColor = when (chip.state) {
                        "ok" -> MaterialTheme.colorScheme.tertiary
                        "fail" -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.primary
                    }
                    Surface(
                        shape = RoundedCornerShape(99.dp),
                        color = chipColor.copy(alpha = 0.1f),
                        modifier = Modifier.padding(bottom = 3.dp),
                    ) {
                        Text(
                            "  ${chip.tool} $stateIcon  ",
                            style = MaterialTheme.typography.labelSmall,
                            color = chipColor,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 3.dp),
                        )
                    }
                }
            }
            // 气泡
            Surface(
                shape = RoundedCornerShape(
                    topStart = 18.dp,
                    topEnd = 18.dp,
                    bottomStart = if (isUser) 18.dp else 6.dp,
                    bottomEnd = if (isUser) 6.dp else 18.dp,
                ),
                color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                border = if (isUser) null else androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                shadowElevation = if (isUser) 0.dp else 1.dp,
                modifier = Modifier.padding(vertical = 2.dp),
            ) {
                Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    if (msg.content.isEmpty() && msg.streaming) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(
                                strokeWidth = 2.dp,
                                modifier = Modifier.width(14.dp).height(14.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("…", style = MaterialTheme.typography.bodyMedium)
                        }
                    } else {
                        Text(
                            msg.content,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}