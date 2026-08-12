package com.livingdashboard.ui.canvas.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livingdashboard.ui.canvas.FavoriteItem

/**
 * 收藏组件网格，Spec 6.1 节。
 *
 * 3 列网格，每个卡片正方形（aspectRatio = 1）。
 *
 * 交互：
 * - 点击 → onFavoriteClick(widgetId)（进入 WebOS 收藏页）
 * - 长按 → onLongClickFavorite(widgetId)（取消收藏，v5 #3）
 * - 末尾固定 + 卡片 → onAddWidget（添加新组件）
 *
 * @param favorites 收藏组件列表
 * @param onClickFavorite 点击回调
 * @param onAddWidget 添加组件回调
 * @param onLongClickFavorite 长按回调（取消收藏）
 * @param modifier 外层 Modifier
 */
@Composable
fun FavoriteWidgetGrid(
    favorites: List<FavoriteItem>,
    onClickFavorite: (String) -> Unit,
    onAddWidget: () -> Unit,
    onLongClickFavorite: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(favorites) { item ->
            FavoriteCard(
                item = item,
                onClick = { onClickFavorite(item.widgetId) },
                onLongClick = { onLongClickFavorite(item.widgetId) }
            )
        }
        item {
            AddWidgetCard(onClick = onAddWidget)
        }
    }
}

/**
 * 收藏组件卡片（v5 #3：用 combinedClickable 支持长按取消收藏）。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FavoriteCard(
    item: FavoriteItem,
    onClick: () -> Unit,
    onLongClick: () -> Unit = {}
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0x08000000)  // D6 rgba(0,0,0,0.03)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            val iconColor = when (item.type) {
                com.livingdashboard.data.entity.WidgetType.AI_ASSISTANT -> Color(0xFF4A90E2)
                com.livingdashboard.data.entity.WidgetType.WEBVIEW -> Color(0xFF34C759)
                com.livingdashboard.data.entity.WidgetType.HTML_CANVAS -> Color(0xFFFF9500)
                com.livingdashboard.data.entity.WidgetType.CALCULATOR -> Color(0xFFFF3B30)
                com.livingdashboard.data.entity.WidgetType.FOCUS_TIMER -> Color(0xFF5856D6)
                com.livingdashboard.data.entity.WidgetType.FREE_HTML -> Color(0xFF8E8E93)
            }
            val iconSymbol = when (item.type) {
                com.livingdashboard.data.entity.WidgetType.AI_ASSISTANT -> "AI"
                com.livingdashboard.data.entity.WidgetType.WEBVIEW -> "W"
                com.livingdashboard.data.entity.WidgetType.HTML_CANVAS -> "H"
                com.livingdashboard.data.entity.WidgetType.CALCULATOR -> "÷"
                com.livingdashboard.data.entity.WidgetType.FOCUS_TIMER -> "T"
                com.livingdashboard.data.entity.WidgetType.FREE_HTML -> "<>"
            }
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(iconColor),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = iconSymbol,
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
            }
            Text(
                text = item.name,
                fontSize = 11.sp,
                color = Color(0xFF666666)
            )
        }
    }
}

/**
 * 添加组件卡片（末尾固定的 + 卡片）。
 */
@Composable
private fun AddWidgetCard(onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0x08000000)),
        elevation = CardDefaults.cardElevation(0.dp),
        onClick = onClick
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.Default.Add,
                contentDescription = "添加",
                tint = Color(0xFF999999)
            )
        }
    }
}
