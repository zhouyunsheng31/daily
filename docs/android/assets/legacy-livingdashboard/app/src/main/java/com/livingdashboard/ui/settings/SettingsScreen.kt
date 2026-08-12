@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.livingdashboard.ui.settings

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.livingdashboard.browser.DefaultBrowserHelper
import com.livingdashboard.data.SearchEngine
import com.livingdashboard.data.prefs.UaMode
import com.livingdashboard.sync.WsState
import com.livingdashboard.ui.theme.ThemeColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 危险操作类型（数据管理分组，二次确认 Dialog 用）。
 */
private enum class DangerousAction(val title: String, val message: String) {
    CLEAR_COOKIES("清除 Cookie", "确定要清除所有 Cookie 吗？此操作不可撤销。"),
    CLEAR_HISTORY("清除历史", "确定要清空所有历史记录吗？此操作不可撤销。"),
    CLEAR_BOOKMARKS("清除书签", "确定要清空所有书签吗？此操作不可撤销。")
}

/**
 * 设置页（Spec 3.3.9 节）。
 *
 * 分组：
 * 0. AI 配置（M8）：导航到 AiConfigScreen（provider/apiKey/endpoint/model + 测试连接）
 * 1. 主页定制：主题色（6 色预设 + "跟随系统"）、背景图（SAF 选图/清除）、Logo（SAF 选图/恢复默认）、显示常用网站（开关）
 * 2. 浏览器设置：搜索引擎（百度/Google/Bing）、UA 模式（移动/桌面）、JavaScript 启用（开关）
 * 3. 默认浏览器：设为默认浏览器按钮（DefaultBrowserHelper + rememberLauncherForActivityResult）
 * 4. 数据管理：清除 Cookie、清除历史、清除书签（危险操作二次确认 Dialog）
 * 5. 调试信息（C4：M0 WS 信息迁移到此）：WS 状态、设备 ID、服务器地址、最近消息列表、重新连接按钮
 *
 * @param onClose 关闭页面回调
 * @param onNavigateToAiConfig M8：导航到 AI 配置页（Routes.AI_CONFIG）
 * @param viewModel 设置 ViewModel（由 hiltViewModel() 获取）
 */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onClose: () -> Unit,
    onNavigateToAiConfig: () -> Unit = {},
    onNavigateToScripts: () -> Unit = {},  // M4 新增（Spec 2.6.2）：导航到脚本管理页
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // 收集设置项状态
    val themeColorIndex by viewModel.themeColorIndex.collectAsStateWithLifecycle()
    val searchEngine by viewModel.searchEngine.collectAsStateWithLifecycle()
    val uaMode by viewModel.uaMode.collectAsStateWithLifecycle()
    val javaScriptEnabled by viewModel.javaScriptEnabled.collectAsStateWithLifecycle()
    val showHomeShortcuts by viewModel.showHomeShortcuts.collectAsStateWithLifecycle()
    val backgroundUri by viewModel.backgroundUri.collectAsStateWithLifecycle()
    val logoUri by viewModel.logoUri.collectAsStateWithLifecycle()
    val allowAllTools by viewModel.allowAllTools.collectAsStateWithLifecycle()

    // 收集调试信息
    val wsState by viewModel.wsConnectionState.collectAsStateWithLifecycle()
    val deviceId = viewModel.deviceId
    val serverUrl = viewModel.serverUrl
    val recentMessages by viewModel.recentMessages.collectAsStateWithLifecycle()

    // SAF 选图 launcher（背景图）
    val backgroundPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val path = copyUriToPrivateDir(context, uri, "home_background")
                viewModel.setBackgroundUri(path)
            }
        }
    }

    // SAF 选图 launcher（Logo）
    val logoPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val path = copyUriToPrivateDir(context, uri, "home_logo")
                viewModel.setLogoUri(path)
            }
        }
    }

    // 默认浏览器 launcher（Android 10+ 用 RoleManager）
    val roleLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result: ActivityResult ->
        if (result.resultCode == Activity.RESULT_OK) {
            Toast.makeText(context, "已设为默认浏览器", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(context, "未设为默认浏览器", Toast.LENGTH_SHORT).show()
        }
    }

    // 危险操作确认 Dialog 状态
    var pendingDangerousAction by remember { mutableStateOf<DangerousAction?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.Close, contentDescription = "关闭")
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
            // ===== M8：AI 配置入口（Spec 6.11.3 节，导航到 AiConfigScreen） =====
            item { SettingsGroupHeader("AI 配置") }
            item {
                ActionItem(title = "AI 配置（Provider / API Key / 测试连接）") {
                    onNavigateToAiConfig()
                }
            }
            // M4（Spec 2.6.2）：脚本管理入口，导航到 ScriptListScreen
            item {
                ActionItem(title = "脚本管理（用户脚本 / 油猴 API）") {
                    onNavigateToScripts()
                }
            }
            // 全允许模式开关（开启后所有工具调用自动执行，不再询问）
            item {
                SwitchItem(
                    title = "全允许模式",
                    checked = allowAllTools,
                    onCheckedChange = { checked ->
                        scope.launch { viewModel.setAllowAllTools(checked) }
                    }
                )
            }
            // 开启时显示红色风险提示卡片
            if (allowAllTools) {
                item { AllowAllToolsRiskCard() }
            }

            // ===== 1. 主页定制 =====
            item { SettingsGroupHeader("主页定制") }

            item {
                ThemeColorItem(
                    selectedIndex = themeColorIndex,
                    onSelected = { index ->
                        scope.launch { viewModel.setThemeColor(index) }
                    }
                )
            }

            item {
                BackgroundImageItem(
                    currentUri = backgroundUri,
                    onPick = { backgroundPicker.launch(arrayOf("image/*")) },
                    onClear = { scope.launch { viewModel.setBackgroundUri(null) } }
                )
            }

            item {
                LogoItem(
                    currentUri = logoUri,
                    onPick = { logoPicker.launch(arrayOf("image/*")) },
                    onReset = { scope.launch { viewModel.setLogoUri(null) } }
                )
            }

            item {
                SwitchItem(
                    title = "显示常用网站",
                    checked = showHomeShortcuts,
                    onCheckedChange = { checked ->
                        scope.launch { viewModel.setShowHomeShortcuts(checked) }
                    }
                )
            }

            // ===== 2. 浏览器设置 =====
            item { SettingsGroupHeader("浏览器设置") }

            item {
                SearchEngineItem(
                    currentEngine = searchEngine,
                    onSelected = { engine ->
                        scope.launch { viewModel.setSearchEngine(engine) }
                    }
                )
            }

            item {
                UaModeItem(
                    currentMode = uaMode,
                    onSelected = { mode ->
                        scope.launch { viewModel.setUaMode(mode) }
                    }
                )
            }

            item {
                SwitchItem(
                    title = "启用 JavaScript",
                    checked = javaScriptEnabled,
                    onCheckedChange = { checked ->
                        scope.launch { viewModel.setJsEnabled(checked) }
                    }
                )
            }

            // ===== 3. 默认浏览器 =====
            item { SettingsGroupHeader("默认浏览器") }
            item {
                DefaultBrowserItem(
                    context = context,
                    roleLauncher = roleLauncher
                )
            }

            // ===== 4. 数据管理 =====
            item { SettingsGroupHeader("数据管理") }
            item {
                ActionItem(title = "清除 Cookie") {
                    pendingDangerousAction = DangerousAction.CLEAR_COOKIES
                }
            }
            item {
                ActionItem(title = "清除历史") {
                    pendingDangerousAction = DangerousAction.CLEAR_HISTORY
                }
            }
            item {
                ActionItem(title = "清除书签") {
                    pendingDangerousAction = DangerousAction.CLEAR_BOOKMARKS
                }
            }

            // ===== 5. 调试信息（C4：M0 WS 信息迁移到此） =====
            item { SettingsGroupHeader("调试信息") }
            item {
                DebugInfoItem(
                    wsState = wsState,
                    deviceId = deviceId,
                    serverUrl = serverUrl,
                    recentMessages = recentMessages,
                    onReconnect = { scope.launch { viewModel.reconnectWs() } }
                )
            }
        }
    }

    // 危险操作确认 Dialog
    pendingDangerousAction?.let { action ->
        AlertDialog(
            onDismissRequest = { pendingDangerousAction = null },
            title = { Text(action.title) },
            text = { Text(action.message) },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    pendingDangerousAction = null
                    scope.launch {
                        when (action) {
                            DangerousAction.CLEAR_COOKIES -> viewModel.clearCookies()
                            DangerousAction.CLEAR_HISTORY -> viewModel.clearHistory()
                            DangerousAction.CLEAR_BOOKMARKS -> viewModel.clearBookmarks()
                        }
                    }
                }) { Text("确定") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { pendingDangerousAction = null }) {
                    Text("取消")
                }
            }
        )
    }
}

// ===== 辅助 Composable =====

/**
 * 分组标题（带分隔线）。
 */
@Composable
private fun SettingsGroupHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    )
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
}

/**
 * 主题色选择项（7 选项：1 个"跟随系统" + 6 色预设）。
 *
 * @param selectedIndex 当前选中的索引（-1=跟随系统，0..5=预设色）
 * @param onSelected 选中回调
 */
@Composable
private fun ThemeColorItem(
    selectedIndex: Int,
    onSelected: (Int) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Text(
            text = "主题色",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(Modifier.height(8.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // "跟随系统"选项（用边框圆圈表示，选中时打勾）
            ColorCircle(
                color = MaterialTheme.colorScheme.surfaceVariant,
                isSelected = selectedIndex == -1,
                isFollowSystem = true,
                onClick = { onSelected(-1) }
            )
            // 6 色预设
            ThemeColors.forEachIndexed { index, color ->
                ColorCircle(
                    color = color,
                    isSelected = selectedIndex == index,
                    isFollowSystem = false,
                    onClick = { onSelected(index) }
                )
            }
        }
    }
}

/**
 * 单个色块（圆形，选中时显示对勾或边框高亮）。
 */
@Composable
private fun ColorCircle(
    color: Color,
    isSelected: Boolean,
    isFollowSystem: Boolean,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(color)
            .then(
                if (isSelected) Modifier.border(3.dp, MaterialTheme.colorScheme.primary, CircleShape)
                else Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        if (isFollowSystem) {
            // "跟随系统"用图标表示
            Icon(
                imageVector = Icons.Default.Public,
                contentDescription = "跟随系统",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
        }
        if (isSelected && !isFollowSystem) {
            Icon(
                imageVector = Icons.Default.Check,
                contentDescription = "已选中",
                tint = Color.White,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/**
 * 背景图选择项。
 */
@Composable
private fun BackgroundImageItem(
    currentUri: String?,
    onPick: () -> Unit,
    onClear: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Image,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp)
        )
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "主页背景图",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = if (currentUri.isNullOrEmpty()) "未设置" else "已设置",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        OutlinedButton(onClick = onPick) { Text("选择") }
        Spacer(Modifier.size(8.dp))
        if (!currentUri.isNullOrEmpty()) {
            OutlinedButton(onClick = onClear) { Text("清除") }
        }
    }
}

/**
 * Logo 选择项。
 */
@Composable
private fun LogoItem(
    currentUri: String?,
    onPick: () -> Unit,
    onReset: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.BrokenImage,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp)
        )
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "主页 Logo",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = if (currentUri.isNullOrEmpty()) "默认" else "已自定义",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        OutlinedButton(onClick = onPick) { Text("选择") }
        Spacer(Modifier.size(8.dp))
        if (!currentUri.isNullOrEmpty()) {
            OutlinedButton(onClick = onReset) { Text("恢复默认") }
        }
    }
}

/**
 * 开关项（标题 + Switch）。
 */
@Composable
private fun SwitchItem(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

/**
 * 全允许模式风险提示卡片（红色背景 + 红色文字 + Warning 图标）。
 */
@Composable
private fun AllowAllToolsRiskCard() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x1AF44336))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Warning,
            contentDescription = null,
            tint = Color(0xFFF44336),
            modifier = Modifier.size(20.dp)
        )
        Spacer(Modifier.size(8.dp))
        Text(
            text = "风险提示：开启后所有工具调用将自动执行，不再询问",
            color = Color(0xFFF44336),
            style = MaterialTheme.typography.bodySmall
        )
    }
}

/**
 * 搜索引擎选择项（3 个 RadioButton）。
 */
@Composable
private fun SearchEngineItem(
    currentEngine: SearchEngine,
    onSelected: (SearchEngine) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Text(
            text = "搜索引擎",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(Modifier.height(4.dp))
        SearchEngine.values().forEach { engine ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelected(engine) }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RadioButton(
                    selected = currentEngine == engine,
                    onClick = { onSelected(engine) }
                )
                Text(
                    text = engine.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }
}

/**
 * UA 模式选择项（2 个 RadioButton）。
 */
@Composable
private fun UaModeItem(
    currentMode: UaMode,
    onSelected: (UaMode) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Text(
            text = "UA 模式",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
        Spacer(Modifier.height(4.dp))
        UaMode.values().forEach { mode ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onSelected(mode) }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RadioButton(
                    selected = currentMode == mode,
                    onClick = { onSelected(mode) }
                )
                Text(
                    text = if (mode == UaMode.MOBILE) "移动端" else "桌面端",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }
}

/**
 * 默认浏览器设置项（用 DefaultBrowserHelper + roleLauncher）。
 */
@Composable
private fun DefaultBrowserItem(
    context: Context,
    roleLauncher: androidx.activity.compose.ManagedActivityResultLauncher<Intent, ActivityResult>
) {
    val activity = context as? Activity ?: return
    val isDefault = DefaultBrowserHelper.isDefaultBrowser(activity)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Public,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(24.dp)
        )
        Spacer(Modifier.size(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "设为默认浏览器",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = if (isDefault) "已是默认浏览器" else "未设为默认浏览器",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Button(onClick = {
            val intent = DefaultBrowserHelper.createRequestRoleIntent(activity)
            if (intent != null) {
                // Android 10+ 用 roleLauncher，<10 直接 startActivity（打开系统设置页）
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    roleLauncher.launch(intent)
                } else {
                    activity.startActivity(intent)
                }
            }
        }) { Text("设置") }
    }
}

/**
 * 操作项（标题 + 右箭头，点击触发回调）。
 */
@Composable
private fun ActionItem(
    title: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * 调试信息项（WS 状态、设备 ID、服务器地址、最近消息、重新连接按钮）。
 */
@Composable
private fun DebugInfoItem(
    wsState: WsState,
    deviceId: String,
    serverUrl: String,
    recentMessages: List<String>,
    onReconnect: () -> Unit
) {
    // Spec 9.3：分组卡片 rgba(0,0,0,0.03) 圆角 12dp
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color(0x08000000)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // WS 状态行
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(wsStateColor(wsState))
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    text = "WS 状态: ${wsStateText(wsState)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(Modifier.height(8.dp))

            // 设备 ID
            Text(
                text = "设备 ID: $deviceId",
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(4.dp))

            // 服务器地址
            Text(
                text = "服务器: $serverUrl",
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(12.dp))

            // 最近消息标题
            Text(
                text = "最近消息（${recentMessages.size}/20）",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(4.dp))

            // 最近消息列表
            if (recentMessages.isEmpty()) {
                Text(
                    text = "（暂无消息）",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                )
            } else {
                recentMessages.forEach { msg ->
                    Text(
                        text = "• $msg",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // 重新连接按钮
            OutlinedButton(
                onClick = onReconnect,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.size(8.dp))
                Text("重新连接 WS")
            }
        }
    }
}

// ===== 辅助函数 =====

/**
 * WS 状态对应颜色（与 M0 HomeScreen 保持一致）。
 */
private fun wsStateColor(state: WsState): Color = when (state) {
    WsState.CONNECTED -> Color(0xFF4CAF50)      // 绿
    WsState.DISCONNECTED -> Color(0xFFF44336)   // 红
    WsState.CONNECTING -> Color(0xFFFFC107)     // 黄
    WsState.RECONNECTING -> Color(0xFFFFC107)   // 黄
}

/**
 * WS 状态文本（与 M0 HomeScreen 保持一致）。
 */
private fun wsStateText(state: WsState): String = when (state) {
    WsState.CONNECTED -> "已连接"
    WsState.DISCONNECTED -> "断开"
    WsState.CONNECTING -> "连接中"
    WsState.RECONNECTING -> "重连中"
}

/**
 * 把 SAF 选中的 URI 复制到 App 私有目录，返回 file:// URI 字符串。
 *
 * Spec 3.3.9 节：SAF 选图后复制到 App 私有目录，存路径到 SettingsStore。
 * 不依赖持久化 URI 权限（避免权限丢失）。
 *
 * @param context Context
 * @param uri SAF 选中的 URI
 * @param fileName 文件名前缀（如 "home_background"）
 * @return 复制后的 file:// URI 字符串
 */
private suspend fun copyUriToPrivateDir(
    context: Context,
    uri: Uri,
    fileName: String
): String = withContext(Dispatchers.IO) {
    val privateDir = File(context.filesDir, "custom_assets")
    if (!privateDir.exists()) privateDir.mkdirs()
    // 用时间戳避免覆盖
    val targetFile = File(privateDir, "${fileName}_${System.currentTimeMillis()}.img")
    context.contentResolver.openInputStream(uri)?.use { input ->
        targetFile.outputStream().use { output ->
            input.copyTo(output)
        }
    }
    Uri.fromFile(targetFile).toString()
}
