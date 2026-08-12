package com.livingdashboard.ui.script

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FileOpen
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.data.entity.UserScriptEntity

/**
 * 脚本管理页（Spec 2.6.5 / Phase M4 T6）。
 *
 * 布局：
 * - TopAppBar：标题"脚本管理" + 返回按钮 + 新建按钮 + 导入按钮
 * - 列表：每项显示 name / matches 摘要 / version / 状态 / 来源 tag + enabled Switch
 * - 空状态：居中 Icon + "还没有脚本"
 * - FAB：新建脚本
 *
 * 交互：
 * - 点击列表项 → [onEdit]
 * - Switch 切换 → viewModel.toggleEnabled
 * - 长按列表项 → 弹出菜单（删除/复制代码/分享）
 *
 * @param onBack 返回回调
 * @param onCreate 新建脚本回调
 * @param onEdit 编辑脚本回调（传 scriptId）
 * @param viewModel 列表 ViewModel（Hilt 注入）
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ScriptListScreen(
    onBack: () -> Unit,
    onCreate: () -> Unit,
    onEdit: (String) -> Unit,
    viewModel: ScriptListViewModel = hiltViewModel(),
) {
    val scripts by viewModel.scripts.collectAsStateWithLifecycle()
    val importState by viewModel.importState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var showImportDialog by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<UserScriptEntity?>(null) }

    // 导入成功后关闭对话框
    LaunchedEffect(importState) {
        if (importState is ScriptListViewModel.ImportState.Success) {
            showImportDialog = false
            viewModel.resetImportState()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("脚本管理") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 新建按钮
                    IconButton(onClick = onCreate) {
                        Icon(Icons.Default.Add, contentDescription = "新建脚本")
                    }
                    // 导入按钮（触发 ImportUserScriptDialog）
                    IconButton(onClick = { showImportDialog = true }) {
                        Icon(Icons.Default.FileOpen, contentDescription = "导入")
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onCreate,
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("新建脚本") },
            )
        }
    ) { padding ->
        if (scripts.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.Code,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "还没有脚本",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding)
            ) {
                items(items = scripts, key = { it.id }) { script ->
                    ScriptItem(
                        script = script,
                        onClick = { onEdit(script.id) },
                        onToggleEnabled = { viewModel.toggleEnabled(script.id) },
                        onDelete = { pendingDelete = script },
                        onCopyCode = {
                            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE)
                                as ClipboardManager
                            cm.setPrimaryClip(ClipData.newPlainText("script", script.code))
                            Toast.makeText(context, "代码已复制", Toast.LENGTH_SHORT).show()
                        },
                        onShare = {
                            val fullSource = if (script.rawMetadata.isNotEmpty()) {
                                script.rawMetadata + "\n\n" + script.code
                            } else {
                                script.code
                            }
                            val intent = Intent(Intent.ACTION_SEND).apply {
                                type = "application/javascript"
                                putExtra(Intent.EXTRA_TEXT, fullSource)
                            }
                            context.startActivity(Intent.createChooser(intent, "分享脚本"))
                        },
                    )
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                }
            }
        }
    }

    // 导入对话框
    if (showImportDialog) {
        ImportUserScriptDialog(
            onDismiss = {
                showImportDialog = false
                viewModel.resetImportState()
            },
            onImportFromUrl = { url -> viewModel.importFromUrl(url) },
            onImportFromFile = { uri -> viewModel.importFromFile(uri) },
        )
    }

    // 导入失败提示
    (importState as? ScriptListViewModel.ImportState.Error)?.let { err ->
        LaunchedEffect(err) {
            Toast.makeText(context, "导入失败: ${err.message}", Toast.LENGTH_LONG).show()
            viewModel.resetImportState()
        }
    }

    // 删除确认
    pendingDelete?.let { script ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除脚本") },
            text = { Text("确定删除 \"${script.name}\" 吗？此操作不可撤销。") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteScript(script.id)
                    pendingDelete = null
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("取消") }
            }
        )
    }
}

/**
 * 单个脚本列表项（Spec 2.6.5）。
 *
 * 卡片布局（无边框，背景色差分隔）：
 * - 第一行：name + matches 摘要 + enabled Switch
 * - 第二行：version · 启用/禁用 · 来源 tag
 *
 * 长按弹菜单：删除 / 复制代码 / 分享
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ScriptItem(
    script: UserScriptEntity,
    onClick: () -> Unit,
    onToggleEnabled: () -> Unit,
    onDelete: () -> Unit,
    onCopyCode: () -> Unit,
    onShare: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }
    Box {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = { showMenu = true },
                ),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = Color(0x08000000)
            )
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = script.name,
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (script.matches.isNotEmpty()) {
                            Text(
                                text = script.matches.joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                    Switch(
                        checked = script.enabled,
                        onCheckedChange = { onToggleEnabled() },
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "v${script.version}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "·",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    )
                    Text(
                        text = if (script.enabled) "启用" else "禁用",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "·",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    )
                    SourceTag(source = script.source)
                }
            }
        }
        DropdownMenu(
            expanded = showMenu,
            onDismissRequest = { showMenu = false },
        ) {
            DropdownMenuItem(
                text = { Text("删除") },
                onClick = { showMenu = false; onDelete() },
                leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
            )
            DropdownMenuItem(
                text = { Text("复制代码") },
                onClick = { showMenu = false; onCopyCode() },
                leadingIcon = { Icon(Icons.Default.ContentCopy, contentDescription = null) },
            )
            DropdownMenuItem(
                text = { Text("分享") },
                onClick = { showMenu = false; onShare() },
                leadingIcon = { Icon(Icons.Default.Share, contentDescription = null) },
            )
        }
    }
}

/**
 * 来源标签（ai / import / manual）。
 */
@Composable
private fun SourceTag(source: String) {
    val (label, color) = when (source) {
        "ai" -> "AI" to MaterialTheme.colorScheme.tertiary
        "import" -> "导入" to MaterialTheme.colorScheme.secondary
        else -> "手动" to MaterialTheme.colorScheme.primary
    }
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = color,
    )
}
