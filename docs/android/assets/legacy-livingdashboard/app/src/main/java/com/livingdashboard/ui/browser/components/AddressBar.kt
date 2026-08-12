package com.livingdashboard.ui.browser.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.livingdashboard.browser.normalizeUrlForDisplay
import com.livingdashboard.ui.components.glassmorphism
import com.livingdashboard.ui.theme.GlassBackground

/**
 * 浏览器地址栏（Spec 3.3.3 + Spec 9.3 M2 UI 升级）。
 *
 * 行为：
 * - 默认显示当前 URL（隐藏 http:// / https:// 协议），点击变为可编辑 TextField
 * - 进入编辑模式时全选当前文本
 * - 回车提交 → 调用 onUrlSubmit(url)，退出编辑模式
 * - 编辑过程中 currentUrl 变化时（如页面跳转），同步更新编辑框内容
 *
 * M2 UI 升级（D6 白色洁净色系 + 毛玻璃，Spec 9.3）：
 * - 背景改 GlassBackground（rgba(255,255,255,0.85)）+ glassmorphism（blur 12dp）
 * - OutlinedTextField shape 改 RoundedCornerShape(50)（pill 形）
 * - 移除默认边框（focusedIndicatorColor / unfocusedIndicatorColor 透明）
 *
 * @param currentUrl 当前页面 URL（完整 URL，含协议）
 * @param onUrlSubmit 用户提交 URL/搜索词时回调，参数为用户输入（未做 URL 补全，由 ViewModel 处理）
 * @param isLoading 页面是否正在加载（true=显示停止按钮，false=显示刷新按钮）
 * @param onRefresh 点击刷新按钮回调
 * @param onStop 点击停止按钮回调
 * @param modifier Compose Modifier
 */
@Composable
fun AddressBar(
    currentUrl: String,
    onUrlSubmit: (String) -> Unit,
    isLoading: Boolean = false,
    onRefresh: () -> Unit = {},
    onStop: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    var isEditing by remember { mutableStateOf(false) }
    var editText by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }

    // 进入编辑模式时，把当前 URL（隐藏协议）填入编辑框，并请求焦点
    LaunchedEffect(isEditing) {
        if (isEditing) {
            editText = normalizeUrlForDisplay(currentUrl)
            focusRequester.requestFocus()
        }
    }

    // 非编辑模式下，currentUrl 变化时不需要更新 editText（显示用 normalizeUrlForDisplay(currentUrl)）
    // 编辑模式下，不覆盖用户正在输入的内容

    val submit: () -> Unit = {
        val trimmed = editText.trim()
        if (trimmed.isNotEmpty()) {
            onUrlSubmit(trimmed)
        }
        isEditing = false
        keyboard?.hide()
    }

    // Spec 9.3：地址栏 pill 背景 rgba(255,255,255,0.85) + blur(12dp) 毛玻璃
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .glassmorphism(blurRadius = 12.dp, backgroundColor = GlassBackground),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // 左侧：地址输入/显示区（占满剩余宽度）
            Box(
                modifier = Modifier.weight(1f),
                contentAlignment = Alignment.CenterStart
            ) {
                if (isEditing) {
                    OutlinedTextField(
                        value = editText,
                        onValueChange = { editText = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusRequester),
                        singleLine = true,
                        shape = RoundedCornerShape(50),  // Spec 9.3：pill 形圆角
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,    // 移除边框
                            unfocusedIndicatorColor = Color.Transparent
                        ),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Uri,
                            imeAction = ImeAction.Go
                        ),
                        keyboardActions = KeyboardActions(
                            onGo = { submit() }
                        )
                    )
                } else {
                    // 默认显示模式：点击进入编辑
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { isEditing = true }
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        if (currentUrl.isNotEmpty()) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // HTTPS 锁图标（仅 https 显示）
                                if (currentUrl.startsWith("https://")) {
                                    Icon(
                                        imageVector = Icons.Default.Lock,
                                        contentDescription = "安全连接",
                                        modifier = Modifier.padding(end = 8.dp)
                                    )
                                }
                                Text(
                                    text = normalizeUrlForDisplay(currentUrl),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        } else {
                            Text(
                                text = "搜索或输入网址",
                                color = Color.Gray
                            )
                        }
                    }
                }
            }

            // 右侧：刷新/停止按钮（加载中显示停止，空闲显示刷新）
            IconButton(onClick = if (isLoading) onStop else onRefresh) {
                Icon(
                    imageVector = if (isLoading) Icons.Default.Close else Icons.Default.Refresh,
                    contentDescription = if (isLoading) "停止加载" else "刷新"
                )
            }
        }
    }
}
