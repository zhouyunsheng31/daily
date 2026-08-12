package com.livingdashboard.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class PermissionRequest(
    val toolName: String,
    val args: Map<String, Any>,
    val isDangerous: Boolean = false,
    val description: String = "",
)

@Composable
fun PermissionCard(
    request: PermissionRequest,
    onAllow: () -> Unit,
    onDeny: () -> Unit,
    onAddToWhitelist: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accentColor = if (request.isDangerous) Color(0xFFFF3B30) else Color(0xFFFF9500)
    val title = if (request.isDangerous) "危险操作" else "权限请求"

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            // 左侧彩色边框
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(accentColor)
            )
            Column(modifier = Modifier.padding(14.dp)) {
                // 标题行：图标 + 标题
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(accentColor.copy(alpha = 0.12f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = accentColor,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = title,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (request.isDangerous) accentColor
                                else MaterialTheme.colorScheme.onSurface
                    )
                }
                Spacer(Modifier.height(6.dp))
                // 描述
                Text(
                    text = request.description,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(Modifier.height(4.dp))
                // 函数签名（等宽字体）
                Text(
                    text = formatSignature(request),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace
                )
                // 危险卡：不可撤销提示
                if (request.isDangerous) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "此操作将修改本地文件系统，不可撤销",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.error,
                        fontStyle = FontStyle.Italic
                    )
                }
                Spacer(Modifier.height(10.dp))
                // 按钮行：允许(primary) / 拒绝(outlined) / 添加到白名单(文字+下划线)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = onAllow,
                        colors = if (request.isDangerous)
                            ButtonDefaults.buttonColors(containerColor = accentColor)
                        else ButtonDefaults.buttonColors()
                    ) {
                        Text("允许")
                    }
                    OutlinedButton(onClick = onDeny) {
                        Text("拒绝")
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onAddToWhitelist) {
                        Text(
                            text = "添加到白名单",
                            textDecoration = TextDecoration.Underline
                        )
                    }
                }
            }
        }
    }
}

private fun formatSignature(request: PermissionRequest): String {
    if (request.args.isEmpty()) return "${request.toolName}()"
    val argsStr = request.args.entries.joinToString(", ") {
        "${it.key}: ${formatArgValue(it.value)}"
    }
    return "${request.toolName}({$argsStr})"
}

private fun formatArgValue(value: Any): String = when (value) {
    is String -> "\"$value\""
    else -> value.toString()
}
