package com.livingdashboard.ui.tab

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.TabEntity
import com.livingdashboard.ui.canvas.PanelTabViewModel
import com.livingdashboard.ui.components.BottomBarMode
import com.livingdashboard.ui.theme.CardBackground
import kotlinx.coroutines.launch

/**
 * 标签页管理页（Spec 3.3.4 + Spec 6.7 节 M2 扩展）。
 *
 * M2 改造点（v4 #12）：
 * - 加 TabRow（网页标签 / 画布面板 两个 Tab）
 * - 签名改为 TabManagerScreen(onBack, onTabClick, onPanelClick, initialMode, tabViewModel, panelTabViewModel)
 * - 网页标签 Tab：保留现有标签列表 UI
 * - 画布面板 Tab：显示面板列表 + 创建/删除面板
 * - 聚合面板不可删除（spec 6.7 / PanelTabViewModel.deletePanel 内部判断）
 * - 卡片用 CardBackground（Spec 9.3 白色洁净色系）
 *
 * M1 API 对接：
 * - tabViewModel.uiState（StateFlow<TabManagerUiState>，含 tabs）
 * - tabViewModel.createNewTab()（suspend，返回 tabId）
 * - tabViewModel.closeTab(tabId: String)（suspend）
 *
 * @param onBack 关闭页面回调
 * @param onTabClick 点击网页标签卡片回调（切换到该标签，导航到 browser/{tabId}）
 * @param onPanelClick 点击画布面板卡片回调（导航到 canvas/{panelId}）
 * @param initialMode 进入时默认选中的 Tab（BROWSER→网页标签，CANVAS→画布面板）
 * @param tabViewModel M1 已有：管理 TabEntity
 * @param panelTabViewModel M2 新增：管理 PanelEntity
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabManagerScreen(
    onBack: () -> Unit,
    onTabClick: (String) -> Unit,
    onPanelClick: (String) -> Unit,
    initialMode: BottomBarMode = BottomBarMode.BROWSER,
    tabViewModel: TabManagerViewModel = hiltViewModel(),
    panelTabViewModel: PanelTabViewModel = hiltViewModel()
) {
    // v4 #12：默认 Tab 由 initialMode 决定
    var selectedTab by remember { mutableStateOf(if (initialMode == BottomBarMode.CANVAS) 1 else 0) }
    val tabTitles = listOf("网页标签", "画布面板")

    // M1 TabManagerViewModel.createNewTab()/closeTab() 是 suspend，需协程作用域
    val scope = rememberCoroutineScope()

    // M1 TabManagerViewModel 暴露 uiState: StateFlow<TabManagerUiState>（含 tabs: List<TabEntity>）
    val tabUiState by tabViewModel.uiState.collectAsStateWithLifecycle()
    val panels by panelTabViewModel.panels.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("标签管理") },
                navigationIcon = {
                    // 关闭页面按钮
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.Close, contentDescription = "关闭")
                    }
                },
                actions = {
                    // 新建按钮：根据当前 Tab 决定是新建标签还是新建面板
                    IconButton(onClick = {
                        if (selectedTab == 0) {
                            // 网页标签 Tab：M1 suspend API
                            scope.launch {
                                val newTabId = tabViewModel.createNewTab()
                                onTabClick(newTabId)
                            }
                        } else {
                            // 画布面板 Tab：M2 新增（task API 是 suspend，需协程作用域）
                            scope.launch {
                                panelTabViewModel.createPanel("新面板")
                            }
                        }
                    }) {
                        Icon(Icons.Default.Add, contentDescription = "新建")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            // v4 #12：顶部 TabRow 统一两个 Tab
            TabRow(selectedTabIndex = selectedTab) {
                tabTitles.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) }
                    )
                }
            }

            when (selectedTab) {
                0 -> {
                    // 网页标签 Tab（M1 已有逻辑，复用 tabUiState.tabs）
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = tabUiState.tabs,
                            key = { it.id }
                        ) { tab ->
                            TabCard(
                                tab = tab,
                                onClick = { onTabClick(tab.id) },
                                onClose = {
                                    scope.launch { tabViewModel.closeTab(tab.id) }
                                }
                            )
                        }
                    }
                }
                1 -> {
                    // 画布面板 Tab（M2 新增，原 PanelManagerScreen 逻辑迁入）
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = panels,
                            key = { it.id }
                        ) { panel ->
                            PanelCard(
                                name = panel.name,
                                description = if (panel.type == PanelType.AGGREGATE) "聚合面板（系统）" else "",
                                isAggregate = panel.type == PanelType.AGGREGATE,
                                onClick = { onPanelClick(panel.id) },
                                onDelete = {
                                    // task API 是 suspend，需协程作用域
                                    scope.launch {
                                        panelTabViewModel.deletePanel(panel)
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 单个网页标签卡片（M1 保留 + M2 白色洁净色系升级）。
 *
 * @param tab 标签页实体
 * @param onClick 点击卡片回调
 * @param onClose 点击关闭按钮回调
 */
@Composable
private fun TabCard(
    tab: TabEntity,
    onClick: () -> Unit,
    onClose: () -> Unit
) {
    // Spec 9.3：标签卡片 rgba(0,0,0,0.03) 圆角 12dp
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = CardBackground)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = tab.title.ifBlank { "新标签页" },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = tab.url.ifBlank { "空白页" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
            // 关闭按钮（右侧，避免遮挡文本）
            IconButton(onClick = onClose) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "关闭标签",
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}

/**
 * 单个画布面板卡片（M2 新增）。
 *
 * @param name 面板名称
 * @param description 描述（聚合面板显示"聚合面板（系统）"，普通面板为空）
 * @param isAggregate 是否为聚合面板（聚合面板不显示删除按钮）
 * @param onClick 点击卡片回调
 * @param onDelete 删除面板回调
 */
@Composable
private fun PanelCard(
    name: String,
    description: String,
    isAggregate: Boolean,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    // Spec 9.3：标签卡片 rgba(0,0,0,0.03) 圆角 12dp
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = CardBackground)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (description.isNotEmpty()) {
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
            // 聚合面板不可删除（D12）
            if (!isAggregate) {
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "删除面板",
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}
