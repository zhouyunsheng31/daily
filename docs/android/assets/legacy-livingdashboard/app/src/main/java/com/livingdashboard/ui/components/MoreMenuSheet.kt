package com.livingdashboard.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.BookmarkAdd
import androidx.compose.material.icons.filled.Bookmarks
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.livingdashboard.ui.theme.GlassBackground

/**
 * 更多菜单半屏面板（Spec 3.3.6）。
 *
 * ModalBottomSheet 内容：
 * - 添加书签 / 查看书签
 * - 历史
 * - 下载（M1 占位，提示"暂未实现"）
 * - 分享（分享当前 URL）
 * - 复制链接
 * - 设置
 * - 设为默认浏览器
 * - 清除 Cookie
 * - 退出（finishAffinity）
 *
 * @param show 是否显示
 * @param onDismiss 关闭回调（用户点击 scrim 或系统返回键时触发）
 * @param onAddBookmark 添加书签回调
 * @param onOpenBookmarks 查看书签列表回调
 * @param onOpenHistory 查看历史记录回调
 * @param onDownload 下载回调（M1 由调用方 Toast 提示"暂未实现"）
 * @param onShare 分享当前 URL 回调
 * @param onCopyLink 复制当前 URL 回调
 * @param onOpenSettings 打开设置页回调
 * @param onSetDefaultBrowser 设为默认浏览器回调
 * @param onClearCookies 清除 Cookie 回调
 * @param onExit 退出 App 回调
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoreMenuSheet(
    show: Boolean,
    onDismiss: () -> Unit,
    onAddBookmark: () -> Unit,
    onOpenBookmarks: () -> Unit,
    onOpenHistory: () -> Unit,
    onDownload: () -> Unit,
    onShare: () -> Unit,
    onCopyLink: () -> Unit,
    onOpenSettings: () -> Unit,
    onSetDefaultBrowser: () -> Unit,
    onClearCookies: () -> Unit,
    onExit: () -> Unit
) {
    if (!show) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Spec 9.3：半屏面板背景 rgba(255,255,255,0.95) + blur(20dp) 毛玻璃
    // task 要求 containerColor = Color(0xD9FFFFFF)（GlassBackground）
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = GlassBackground
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 24.dp)
        ) {
            MenuSheetItem(
                icon = Icons.Default.BookmarkAdd,
                title = "添加书签",
                onClick = {
                    onDismiss()
                    onAddBookmark()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Bookmarks,
                title = "查看书签",
                onClick = {
                    onDismiss()
                    onOpenBookmarks()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.History,
                title = "历史",
                onClick = {
                    onDismiss()
                    onOpenHistory()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Download,
                title = "下载",
                onClick = {
                    onDismiss()
                    onDownload()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Share,
                title = "分享",
                onClick = {
                    onDismiss()
                    onShare()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.ContentCopy,
                title = "复制链接",
                onClick = {
                    onDismiss()
                    onCopyLink()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Settings,
                title = "设置",
                onClick = {
                    onDismiss()
                    onOpenSettings()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Public,
                title = "设为默认浏览器",
                onClick = {
                    onDismiss()
                    onSetDefaultBrowser()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Clear,
                title = "清除 Cookie",
                onClick = {
                    onDismiss()
                    onClearCookies()
                }
            )
            MenuSheetItem(
                icon = Icons.AutoMirrored.Filled.ExitToApp,
                title = "退出",
                onClick = {
                    onDismiss()
                    onExit()
                }
            )
        }
    }
}

/**
 * 菜单项（图标 + 标题，点击触发回调）。
 */
@Composable
private fun MenuSheetItem(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit
) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        headlineContent = {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge
            )
        },
        leadingContent = {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurface
            )
        }
    )
}
