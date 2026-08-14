package xyz.shadowshub.daily.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.koin.androidx.compose.koinViewModel

/**
 * 对话主页（M0-2 占位实现：跑通链路的最小 UI，非最终设计——正式 UI 由用户主导，见 AGENT.md 红线）。
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
        // 顶部状态条
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = when {
                    !state.sessionReady && state.sessionError != null -> "⚠️ ${state.sessionError}"
                    state.streaming -> "● AI 思考中…"
                    state.busyWaiting -> "⏳ ${state.busyMessage ?: "排队中…"}"
                    state.error != null -> "⚠️ ${state.error}"
                    else -> "Daily AI"
                },
                style = MaterialTheme.typography.labelMedium,
                color = when {
                    state.error != null || state.sessionError != null -> MaterialTheme.colorScheme.error
                    state.streaming || state.busyWaiting -> MaterialTheme.colorScheme.primary
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.weight(1f),
            )
            state.lastUsage?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }

        // 会话失败：重试
        if (!state.sessionReady && state.sessionError != null) {
            Row(horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { viewModel.initSession() }) { Text("重试连接") }
            }
        }

        // 消息列表
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (state.messages.isEmpty()) {
                item {
                    Text(
                        text = "和 AI 说点什么吧",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
                        textAlign = TextAlign.Center,
                    )
                }
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

        // 输入栏（去 Scaffold 后自行适配手势条 inset）
        Row(
            modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("输入消息…") },
                maxLines = 5,
                enabled = state.sessionReady,
            )
            Spacer(Modifier.width(8.dp))
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
                if (state.streaming) Icon(Icons.Filled.Stop, contentDescription = "停止")
                else Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "发送")
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
            modifier = Modifier.widthIn(max = 300.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        ) {
            if (msg.thinking.isNotEmpty()) {
                Text(
                    text = "💭 ${if (msg.thinking.length > 120) msg.thinking.take(120) + "…" else msg.thinking}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
            msg.toolChips.forEach { chip ->
                val stateIcon = when (chip.state) {
                    "ok" -> "✓"
                    "fail" -> "✗"
                    else -> "…"
                }
                Text(
                    text = "🛠 ${chip.tool} $stateIcon",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
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
                        Text(msg.content, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}