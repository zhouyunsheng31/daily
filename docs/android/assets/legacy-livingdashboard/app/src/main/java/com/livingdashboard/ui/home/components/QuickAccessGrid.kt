package com.livingdashboard.ui.home.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.livingdashboard.data.entity.BookmarkEntity

/**
 * 常用网站网格（Spec 3.3.2）。
 *
 * - 用 LazyVerticalGrid 展示书签中 `showOnHome=true` 的项
 * - 每行 4 列，每个图标显示首字母占位 + title
 * - 点击图标触发 onShortcutClick(url)
 *
 * M1 简化：不加载真实 favicon（M1 未引入 Coil 等图片加载库），用首字母占位。
 * M7 可引入 Coil 加载 faviconUrl。
 *
 * @param shortcuts 主页快捷书签列表
 * @param onShortcutClick 点击快捷图标回调，参数为书签 URL
 * @param modifier Compose Modifier
 */
@Composable
fun QuickAccessGrid(
    shortcuts: List<BookmarkEntity>,
    onShortcutClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    if (shortcuts.isEmpty()) return

    Column(modifier = modifier.fillMaxWidth()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            // 嵌套滚动：限制高度避免无限延伸，按内容自适应
            modifier = Modifier
                .fillMaxWidth()
                // 让网格自适应行数高度（不滚动），交给外层 Column 滚动
                .height(((shortcuts.size + 3) / 4 * 96).dp)
        ) {
            items(
                items = shortcuts,
                key = { it.id }
            ) { bookmark ->
                ShortcutItem(
                    bookmark = bookmark,
                    onClick = { onShortcutClick(bookmark.url) }
                )
            }
        }
    }
}

/**
 * 单个快捷图标项。
 */
@Composable
private fun ShortcutItem(
    bookmark: BookmarkEntity,
    onClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // 首字母占位（M1 简化，不加载 favicon）
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = bookmark.title.take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontWeight = FontWeight.Bold
            )
        }

        Spacer(Modifier.height(4.dp))

        Text(
            text = bookmark.title,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
