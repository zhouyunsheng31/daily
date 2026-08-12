package com.livingdashboard.ui.bookmark

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.data.entity.BookmarkEntity
import kotlinx.coroutines.launch

/**
 * 书签管理页（Spec 3.3.7）。
 *
 * 布局：顶部栏（标题"书签" + 添加按钮）→ 书签列表。
 *
 * 每项：title + URL + favicon占位。
 *
 * 操作：
 * - 点击 → onBookmarkClick(url)（打开书签）
 * - 长按 → 弹出菜单（编辑/删除/切换主页显示），用 Modifier.combinedClickable(onLongClick = ...)
 * - 添加按钮 → 弹出 Dialog（输入 title + URL）
 *
 * @param onBookmarkClick 点击书签回调（打开书签 URL）
 * @param onClose 关闭页面回调
 * @param viewModel 书签管理 ViewModel（由 hiltViewModel() 获取）
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun BookmarkScreen(
    onBookmarkClick: (url: String) -> Unit,
    onClose: () -> Unit,
    viewModel: BookmarkViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // 添加书签 Dialog 状态
    var showAddDialog by remember { mutableStateOf(false) }
    // 编辑书签 Dialog 状态
    var editingBookmark by remember { mutableStateOf<BookmarkEntity?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("书签") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.Close, contentDescription = "关闭")
                    }
                },
                actions = {
                    // 添加书签按钮
                    IconButton(onClick = { showAddDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = "添加书签")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            items(
                items = uiState.bookmarks,
                key = { it.id }
            ) { bookmark ->
                BookmarkItem(
                    bookmark = bookmark,
                    onClick = { onBookmarkClick(bookmark.url) },
                    onEdit = { editingBookmark = bookmark },
                    onDelete = {
                        scope.launch { viewModel.deleteBookmark(bookmark) }
                    },
                    onToggleHome = {
                        scope.launch { viewModel.toggleShowOnHome(bookmark) }
                    }
                )
            }
        }
    }

    // 添加书签 Dialog
    if (showAddDialog) {
        BookmarkEditDialog(
            initialTitle = "",
            initialUrl = "",
            onConfirm = { title, url ->
                scope.launch { viewModel.addBookmark(title, url) }
                showAddDialog = false
            },
            onDismiss = { showAddDialog = false }
        )
    }

    // 编辑书签 Dialog
    editingBookmark?.let { bookmark ->
        BookmarkEditDialog(
            initialTitle = bookmark.title,
            initialUrl = bookmark.url,
            onConfirm = { title, url ->
                val updated = bookmark.copy(title = title, url = url)
                scope.launch { viewModel.updateBookmark(updated) }
                editingBookmark = null
            },
            onDismiss = { editingBookmark = null }
        )
    }
}

/**
 * 单个书签项。
 *
 * 显示 title + URL + favicon占位 + 主页标记。
 * 长按弹出菜单（编辑/删除/切换主页显示）。
 *
 * @param bookmark 书签实体
 * @param onClick 点击回调
 * @param onEdit 编辑回调
 * @param onDelete 删除回调
 * @param onToggleHome 切换主页显示回调
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookmarkItem(
    bookmark: BookmarkEntity,
    onClick: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onToggleHome: () -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }
    Box {
        // Spec 9.3：卡片背景 rgba(0,0,0,0.03) 圆角 12dp，移除实线边框
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onClick,
                    onLongClick = { showMenu = true }
                ),
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(
                containerColor = Color(0x08000000)
            )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // favicon 占位（M1 用 Bookmark 图标占位，M7 接入真实 favicon）
                Icon(
                    Icons.Default.Bookmark,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 12.dp)
                ) {
                    Text(
                        text = bookmark.title,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = bookmark.url,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp)
                    )
                }
                // 主页显示标记
                if (bookmark.showOnHome) {
                    Icon(
                        Icons.Default.Home,
                        contentDescription = "显示在主页",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.secondary
                    )
                }
            }
        }
        // 长按菜单（编辑/删除/切换主页显示）
        DropdownMenu(
            expanded = showMenu,
            onDismissRequest = { showMenu = false }
        ) {
            DropdownMenuItem(
                text = { Text("编辑") },
                onClick = {
                    showMenu = false
                    onEdit()
                },
                leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) }
            )
            DropdownMenuItem(
                text = { Text(if (bookmark.showOnHome) "从主页移除" else "显示在主页") },
                onClick = {
                    showMenu = false
                    onToggleHome()
                },
                leadingIcon = { Icon(Icons.Default.Home, contentDescription = null) }
            )
            DropdownMenuItem(
                text = { Text("删除") },
                onClick = {
                    showMenu = false
                    onDelete()
                },
                leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) }
            )
        }
    }
}

/**
 * 添加/编辑书签 Dialog。
 *
 * 输入 title + URL，确定按钮在两者都非空时可用。
 *
 * @param initialTitle 初始标题（空=添加模式）
 * @param initialUrl 初始 URL
 * @param onConfirm 确认回调（title, url）
 * @param onDismiss 取消回调
 */
@Composable
private fun BookmarkEditDialog(
    initialTitle: String,
    initialUrl: String,
    onConfirm: (title: String, url: String) -> Unit,
    onDismiss: () -> Unit
) {
    var title by remember { mutableStateOf(initialTitle) }
    var url by remember { mutableStateOf(initialUrl) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initialTitle.isEmpty()) "添加书签" else "编辑书签") },
        text = {
            Column {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("标题") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("URL") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (title.isNotBlank() && url.isNotBlank()) {
                        onConfirm(title.trim(), url.trim())
                    }
                },
                enabled = title.isNotBlank() && url.isNotBlank()
            ) {
                Text("确定")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
