package com.livingdashboard.ui.script

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 导入脚本对话框（Spec 2.6.7 / Phase M4 T6）。
 *
 * 两种导入方式（Tab 切换）：
 * - URL 导入：输入 .user.js URL → 调 [onImportFromUrl]
 * - 文件导入：SAF 选文件 → 调 [onImportFromFile]
 *
 * @param onDismiss 关闭对话框
 * @param onImportFromUrl URL 导入回调（传入 .user.js URL）
 * @param onImportFromFile 文件导入回调（传入 SAF 返回的 URI）
 */
@Composable
fun ImportUserScriptDialog(
    onDismiss: () -> Unit,
    onImportFromUrl: (String) -> Unit,
    onImportFromFile: (Uri) -> Unit,
) {
    var selectedTab by remember { mutableStateOf(0) }
    var urlInput by remember { mutableStateOf("") }

    // SAF 文件选择 launcher（Spec 2.6.7 方式 B）
    val filePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            onImportFromFile(uri)
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("导入脚本") },
        text = {
            Column {
                TabRow(selectedTabIndex = selectedTab) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("URL 导入") },
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = { Text("文件导入") },
                    )
                }
                Spacer(Modifier.height(12.dp))
                when (selectedTab) {
                    0 -> {
                        OutlinedTextField(
                            value = urlInput,
                            onValueChange = { urlInput = it },
                            label = { Text(".user.js URL") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    1 -> {
                        Text(
                            text = "选择本地 .user.js 文件",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = {
                                filePicker.launch(
                                    arrayOf("application/javascript", "text/plain", "*/*")
                                )
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("选择文件")
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (selectedTab == 0) {
                Button(
                    onClick = {
                        val url = urlInput.trim()
                        if (url.isNotEmpty()) {
                            onImportFromUrl(url)
                        }
                    },
                    enabled = urlInput.isNotBlank(),
                ) {
                    Text("导入")
                }
            } else {
                TextButton(onClick = onDismiss) { Text("关闭") }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
