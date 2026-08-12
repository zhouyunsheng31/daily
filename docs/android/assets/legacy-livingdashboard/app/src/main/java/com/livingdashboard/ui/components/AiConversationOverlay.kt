package com.livingdashboard.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.livingdashboard.ui.canvas.UiChatMessage

/**
 * AI 对话浮层（Spec 6.13，半屏）。
 *
 * 浏览器/画布底部栏左右滑动切换 AI 模式后，在内容区底部显示半屏对话浮层，
 * 展示 AI 对话历史消息。
 *
 * 消息渲染按 role 区分：
 * - "assistant"：用 [MarkdownText] 渲染（支持 markdown 语法）
 * - 其他角色：用 [Text] 渲染（工具调用等折叠为一行摘要）
 *
 * @param messages AI 对话消息列表
 * @param onClose 关闭浮层回调
 * @param modifier 外层 Modifier（调用方 align 到 BottomCenter）
 */
@Composable
fun AiConversationOverlay(
    messages: List<UiChatMessage>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .fillMaxHeight(0.5f),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
        tonalElevation = 6.dp,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            // 顶栏：标题 + 关闭按钮
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "AI 助手",
                    style = MaterialTheme.typography.titleSmall,
                )
                IconButton(onClick = onClose) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭",
                    )
                }
            }
            // 消息列表
            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(messages) { msg ->
                    when (msg.role) {
                        "assistant" -> MarkdownText(
                            markdown = msg.content,
                            textColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                            fontSize = MaterialTheme.typography.bodySmall.fontSize,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        else -> Text(
                            text = "${roleLabel(msg.role)}: ${msg.content}",
                            style = MaterialTheme.typography.bodySmall,
                            color = when (msg.role) {
                                "user" -> MaterialTheme.colorScheme.onSurface
                                "error" -> MaterialTheme.colorScheme.error
                                else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                            },
                        )
                    }
                }
            }
        }
    }
}

/** role → 显示标签（与 AIAssistantWidget 一致） */
private fun roleLabel(role: String): String = when (role) {
    "user" -> "你"
    "assistant" -> "AI"
    "assistant_thinking" -> "思考"
    "tool_call" -> "工具"
    "tool_result" -> "结果"
    "error" -> "错误"
    else -> role
}
