package com.livingdashboard.ui.home.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/**
 * 主页搜索框（Spec 3.3.2 + Spec 9.3 M2 UI 升级）。
 *
 * 行为：
 * - 输入文本，点搜索图标或软键盘回车（ImeAction.Search）触发 onSearch 回调
 * - 提交后清空输入框并隐藏软键盘
 *
 * M2 UI 升级（D6 白色洁净色系）：
 * - Shape 改 RoundedCornerShape(50)（圆角 50% = 完全圆角 pill 形）
 * - containerColor 改 Color(0x0A000000)（rgba(0,0,0,0.04) 淡灰）
 * - 移除 OutlinedTextField 默认边框（focusedIndicatorColor / unfocusedIndicatorColor 透明）
 *
 * @param onSearch 用户提交搜索/URL 时回调，参数为输入文本（未做 URL 补全，由 ViewModel 处理）
 * @param modifier Compose Modifier
 * @param placeholder 占位提示文本（默认"搜索或输入网址"）
 */
@Composable
fun SearchBar(
    onSearch: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "搜索或输入网址"
) {
    var text by remember { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current

    val submit: () -> Unit = {
        val trimmed = text.trim()
        if (trimmed.isNotEmpty()) {
            onSearch(trimmed)
            text = ""
            keyboard?.hide()
        }
    }

    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        placeholder = { Text(placeholder) },
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = "搜索"
            )
        },
        trailingIcon = {
            IconButton(onClick = submit) {
                Icon(
                    imageVector = Icons.Default.ArrowForward,
                    contentDescription = "提交搜索",
                    modifier = Modifier.size(20.dp)
                )
            }
        },
        singleLine = true,
        shape = RoundedCornerShape(50),  // Spec 9.3：pill 形圆角
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color(0x0A000000),    // Spec 9.3：rgba(0,0,0,0.04) 淡灰
            unfocusedContainerColor = Color(0x0A000000),
            focusedIndicatorColor = Color.Transparent,    // 移除边框
            unfocusedIndicatorColor = Color.Transparent
        ),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Search
        ),
        keyboardActions = KeyboardActions(
            onSearch = { submit() }
        )
    )
}
