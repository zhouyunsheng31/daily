package com.livingdashboard.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
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
 * 画布模式更多菜单半屏面板（Spec 6.1 / 6.3 节，v5 #N6）。
 *
 * ModalBottomSheet 内容：
 * - 面板管理 → TabManagerScreen（画布面板 Tab）
 * - 收藏管理 → 聚合面板
 * - 设置 → SettingsScreen
 *
 * @param show 是否显示
 * @param onDismiss 关闭回调（用户点击 scrim 或系统返回键时触发）
 * @param onOpenPanelManager 面板管理回调
 * @param onOpenFavorites 收藏管理回调
 * @param onOpenSettings 设置回调
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CanvasMoreMenuSheet(
    show: Boolean,
    onDismiss: () -> Unit,
    onOpenPanelManager: () -> Unit,
    onOpenFavorites: () -> Unit,
    onOpenSettings: () -> Unit
) {
    if (!show) return

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
                icon = Icons.Default.Dashboard,
                title = "面板管理",
                onClick = {
                    onDismiss()
                    onOpenPanelManager()
                }
            )
            MenuSheetItem(
                icon = Icons.Default.Star,
                title = "收藏管理",
                onClick = {
                    onDismiss()
                    onOpenFavorites()
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
