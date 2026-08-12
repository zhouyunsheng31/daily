package com.livingdashboard.ui.home

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.data.SearchEngine
import com.livingdashboard.data.entity.BookmarkEntity
import com.livingdashboard.ui.components.BottomBar
import com.livingdashboard.ui.components.BottomBarMode
import com.livingdashboard.ui.home.components.LogoHeader
import com.livingdashboard.ui.home.components.QuickAccessGrid
import com.livingdashboard.ui.home.components.SearchBar
import com.livingdashboard.ui.theme.LivingDashboardTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.rememberCoroutineScope

/**
 * 浏览器主页（Spec 3.3.2）。
 *
 * 布局（类 Via）：
 * ```
 * ┌─────────────────────────────┐
 * │      [可自定义背景图]        │
 * │      [Logo]                 │  ← Logo/书签一体头部
 * │      🔍 搜索框              │
 * │   📌 常用网站               │  ← 书签 showOnHome=true
 * │   ◯ ◯ ◯ ◯                  │
 * └─────────────────────────────┘
 * ```
 *
 * 交互：
 * - 搜索框点击/回车 → viewModel.createTabAndNavigate(input) → onNavigateToBrowser(tabId)
 * - 常用网站图标点击 → 同上（用书签 URL 作为输入）
 *
 * 底部栏（D3 修复）：本 Composable 内部包含 BottomBar（mode = BROWSER），
 * Home 按钮回调调用 mainViewModel.onHomePressed()（由 AppNavGraph 传入）。
 *
 * @param onNavigateToBrowser 导航到浏览器页回调，参数为 tabId
 * @param onHome BottomBar Home 按钮回调（D3 状态机入口）
 * @param onTabs BottomBar 标签按钮回调
 * @param onMore BottomBar 更多按钮回调
 * @param viewModel 主页 ViewModel（由 hiltViewModel() 获取）
 */
@Composable
fun BrowserHomeScreen(
    onNavigateToBrowser: (String) -> Unit,
    onHome: () -> Unit = {},
    onTabs: () -> Unit = {},
    onMore: () -> Unit = {},
    onOpenBookmarks: () -> Unit = {},
    viewModel: BrowserHomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // 异步加载背景图 Bitmap
    val backgroundBitmap: ImageBitmap? by produceState<ImageBitmap?>(
        initialValue = null,
        uiState.backgroundUri
    ) {
        value = if (uiState.backgroundUri.isNullOrEmpty()) {
            null
        } else {
            withContext(Dispatchers.IO) {
                runCatching {
                    val stream = context.contentResolver.openInputStream(Uri.parse(uiState.backgroundUri))
                        ?: return@runCatching null
                    stream.use { BitmapFactory.decodeStream(it)?.asImageBitmap() }
                }.getOrNull()
            }
        }
    }

    // 创建标签页并导航的统一入口
    val navigateWithInput: (String) -> Unit = { input ->
        scope.launch {
            val tabId = viewModel.createTabAndNavigate(input)
            if (tabId.isNotEmpty()) {
                onNavigateToBrowser(tabId)
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // 背景图（如有设置）
            if (backgroundBitmap != null) {
                Image(
                    bitmap = backgroundBitmap!!,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            }

            // 主页内容
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Top
            ) {
                LogoHeader(
                    logoUri = uiState.logoUri,
                    onOpenBookmarks = onOpenBookmarks  // 问题4修复：Logo 点击 → BOOKMARKS 路由
                )

                Spacer(Modifier.height(16.dp))

                SearchBar(
                    onSearch = navigateWithInput,
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(Modifier.height(24.dp))

                if (uiState.showHomeShortcuts && uiState.homeShortcuts.isNotEmpty()) {
                    QuickAccessGrid(
                        shortcuts = uiState.homeShortcuts,
                        onShortcutClick = navigateWithInput,
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                // 底部留白，避免内容被底部栏遮挡
                Spacer(Modifier.height(80.dp))
            }

            // D3 修复：浏览器主页添加 BottomBar（mode = BROWSER）
            // Home 按钮回调调用 mainViewModel.onHomePressed()（由 AppNavGraph 传入）
            BottomBar(
                mode = BottomBarMode.BROWSER,
                modifier = Modifier.align(Alignment.BottomCenter),
                onHome = onHome,
                onTabs = onTabs,
                onMore = onMore
            )
        }
    }
}

// ===== Preview（验证 Composable 本身能编译） =====

@Preview(showBackground = true, name = "BrowserHomeScreen Preview")
@Composable
private fun BrowserHomeScreenPreview() {
    LivingDashboardTheme {
        BrowserHomeScreenPreviewContent()
    }
}

@Composable
private fun BrowserHomeScreenPreviewContent() {
    val sampleShortcuts = listOf(
        BookmarkEntity(id = 1, title = "百度", url = "https://www.baidu.com", showOnHome = true),
        BookmarkEntity(id = 2, title = "知乎", url = "https://www.zhihu.com", showOnHome = true),
        BookmarkEntity(id = 3, title = "微博", url = "https://weibo.com", showOnHome = true),
        BookmarkEntity(id = 4, title = "GitHub", url = "https://github.com", showOnHome = true)
    )
    val sampleState = BrowserHomeUiState(
        homeShortcuts = sampleShortcuts,
        searchEngine = SearchEngine.BAIDU,
        backgroundUri = null,
        logoUri = null,
        showHomeShortcuts = true
    )

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            LogoHeader(logoUri = null, onOpenBookmarks = null)
            Spacer(Modifier.height(16.dp))
            SearchBar(onSearch = {}, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(24.dp))
            QuickAccessGrid(
                shortcuts = sampleState.homeShortcuts,
                onShortcutClick = {},
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
