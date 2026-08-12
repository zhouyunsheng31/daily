package com.livingdashboard.ui.widget

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.ui.canvas.UiChatMessage
import com.livingdashboard.ui.components.MarkdownText

/**
 * AIAssistantWidget（Spec A.1 + 6.12 节，M3 真实化）。
 *
 * M2 占位已替换为真实 AI 对话：
 * - 通过 [WidgetRenderParams.panelId] 拿到所属面板 ID
 * - [AiWidgetViewModel.initialize] 绑定 panelId，订阅 Room 历史恢复 + 发送消息走 AgentService
 * - 流式消息列表 + 输入框（INTERACTIVE/FULL）
 *
 * 分层渲染（D9）：
 * - THUMBNAIL：图标 + "AI 助手"标题
 * - SUMMARY：最近 3 条消息
 * - INTERACTIVE/FULL：完整对话界面（消息列表 + 输入框 + 发送按钮）
 *
 * @param params 渲染参数（panelId 必须由调用方传入真实面板 ID）
 */
@Composable
fun AIAssistantWidget(params: WidgetRenderParams) {
    val viewModel: AiWidgetViewModel = hiltViewModel()
    LaunchedEffect(params.panelId) {
        viewModel.initialize(params.panelId)
    }

    when (params.zoomLevel) {
        ZoomLevel.THUMBNAIL -> AIAssistantThumbnail(params)
        ZoomLevel.SUMMARY -> AIAssistantSummary(params, viewModel)
        ZoomLevel.INTERACTIVE, ZoomLevel.FULL -> AIAssistantInteractive(params, viewModel)
    }
}

/** 缩略图：图标 + "AI 助手"标题（Spec A.1） */
@Composable
private fun AIAssistantThumbnail(params: WidgetRenderParams) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Outlined.SmartToy,
            contentDescription = "AI 助手",
            modifier = Modifier.size(24.dp),
            tint = Color(0xFF4A90E2)
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = params.title.ifEmpty { "AI 助手" },
            fontSize = 10.sp,
            color = Color(0xFF999999),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** 摘要：最近 3 条消息（Spec A.1，M3 接入 ViewModel） */
@Composable
private fun AIAssistantSummary(
    params: WidgetRenderParams,
    viewModel: AiWidgetViewModel,
) {
    val messages by viewModel.uiMessages.collectAsStateWithLifecycle()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = params.title.ifEmpty { "AI 助手" },
            fontSize = 12.sp,
            color = Color(0xFF333333),
            maxLines = 1
        )
        val recent = messages.takeLast(3)
        if (recent.isEmpty()) {
            Text(
                text = "暂无消息",
                fontSize = 10.sp,
                color = Color(0xFF999999)
            )
        } else {
            recent.forEach { msg ->
                Text(
                    text = "${roleLabel(msg.role)}: ${msg.content.take(50)}",
                    fontSize = 10.sp,
                    color = Color(0xFF666666),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/** 交互/完整：完整对话界面（Spec A.1，M3 接入 ViewModel） */
@Composable
private fun AIAssistantInteractive(
    params: WidgetRenderParams,
    viewModel: AiWidgetViewModel,
) {
    val messages by viewModel.uiMessages.collectAsStateWithLifecycle()
    val inputText by viewModel.inputText.collectAsStateWithLifecycle()
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
        modifier = Modifier.fillMaxSize().padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // 标题
        Text(
            text = params.title.ifEmpty { "AI 助手" },
            fontSize = 12.sp,
            color = Color(0xFF333333),
            maxLines = 1
        )

        // 消息列表
        if (messages.isEmpty()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "开始和 AI 对话吧",
                    fontSize = 14.sp,
                    color = Color(0xFF999999)
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(messages) { msg ->
                    ChatMessageBubble(msg)
                }
            }
        }

        // 输入框 + 发送按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextField(
                value = inputText,
                onValueChange = viewModel::onInputTextChange,
                placeholder = { Text("问 AI...", fontSize = 12.sp) },
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusRequester),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                textStyle = LocalTextStyle.current.copy(fontSize = 12.sp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(
                    onSend = {
                        viewModel.onSend()
                        keyboard?.hide()
                    }
                ),
                shape = RoundedCornerShape(8.dp)
            )
            IconButton(
                onClick = {
                    viewModel.onSend()
                    keyboard?.hide()
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
    }
}

/** 单条消息气泡（按 role 分色，支持 Markdown 渲染） */
@Composable
private fun ChatMessageBubble(msg: UiChatMessage) {
    val color = when (msg.role) {
        "user" -> Color(0xFF333333)
        "assistant" -> Color(0xFF4A90E2)
        "assistant_thinking" -> Color(0xFF999999)
        "tool_call", "tool_result" -> Color(0xFF888888)
        "error" -> Color(0xFFD32F2F)
        else -> Color(0xFF666666)
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (msg.role == "user") Arrangement.End else Arrangement.Start
    ) {
        // tool_call / tool_result 折叠为一行小字
        if (msg.role == "tool_call" || msg.role == "tool_result") {
            Text(
                text = msg.content.take(50),
                fontSize = 10.sp,
                color = Color(0xFFAAAAAA),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 4.dp)
            )
        } else if (msg.role == "assistant" && (msg.content.contains("**") || msg.content.contains("```") || msg.content.contains("##"))) {
            // assistant 消息含 markdown 语法用 MarkdownText 渲染
            MarkdownText(
                markdown = msg.content,
                textColor = color,
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
            )
        } else {
            Text(
                text = "${roleLabel(msg.role)}: ${msg.content}",
                fontSize = 12.sp,
                color = color,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
            )
        }
    }
}

/** role → 显示标签 */
private fun roleLabel(role: String): String = when (role) {
    "user" -> "你"
    "assistant" -> "AI"
    "assistant_thinking" -> "思考"
    "tool_call" -> "工具"
    "tool_result" -> "结果"
    "error" -> "错误"
    else -> role
}
