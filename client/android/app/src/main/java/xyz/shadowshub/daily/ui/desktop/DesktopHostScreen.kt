package xyz.shadowshub.daily.ui.desktop

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.koin.android.ext.android.getKoin
import xyz.shadowshub.appruntime.AppRuntimeHost
import xyz.shadowshub.core.network.AppDetail
import xyz.shadowshub.core.network.WebosApi
import xyz.shadowshub.daily.BuildConfig

/** 系统桌面 App 固定 id（桌面层 = HTML App，AI 可改、版本化回滚，D3/D18） */
private const val SYSTEM_DESKTOP_ID = "system.desktop"

/**
 * 桌面页宿主（M1-1 · D18 方案 A）：
 * - 沉浸全屏 WebView 渲染 system.desktop（无顶栏、edge-to-edge）
 * - 透传 apps.open / system.navigate 给宿主（DailyApp 分发）
 * - M1-1 降级：桌面 WebView 会拦截横向触摸，Pager 在桌面页拖不动——
 *   顶部留一个低调的"返回对话"按钮切页（M1-4 做手势让渡后移除）
 */
@Composable
fun DesktopHostScreen(
    onOpenApp: (id: String, name: String) -> Unit = { _, _ -> },
    onNavigate: (view: String) -> Unit = {},
    onChat: () -> Unit = {},
) {
    val context = LocalContext.current
    val api: WebosApi = remember {
        (context.applicationContext as Application).getKoin().get()
    }
    val scope = rememberCoroutineScope()
    val host = remember { AppRuntimeHost(context, api, scope, BuildConfig.API_BASE_URL, onOpenApp, onNavigate) }

    var detail by remember { mutableStateOf<AppDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val d = api.appDetail(SYSTEM_DESKTOP_ID)
        android.util.Log.d("AppRuntime", "desktop appDetail: detail=${d != null}, htmlLen=${d?.activeHtml?.length ?: "null"}")
        if (d?.activeHtml != null) {
            detail = d
        } else {
            error = "系统桌面加载失败 [appId=$SYSTEM_DESKTOP_ID, html=${d?.activeHtml?.length ?: "null"}]"
        }
    }

    Box(Modifier.fillMaxSize()) {
        when {
            error != null -> Text(
                error!!,
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                color = MaterialTheme.colorScheme.error,
            )
            detail != null -> AndroidView(
                factory = { ctx ->
                    host.createWebView().also { wv ->
                        // 关键：延迟到 WebView 完成首次布局后再加载（M0-4 白屏根因，勿删）
                        wv.post { host.loadApp(wv, detail!!) }
                    }
                },
                update = {},
                onRelease = { AppRuntimeHost.destroy(it) },
            )
            else -> Text("加载中…", modifier = Modifier.align(Alignment.Center))
        }

        // M1-1 降级切页钮（M0 占位风格，非最终设计；M1-4 手势让渡后移除）
        IconButton(
            onClick = onChat,
            modifier = Modifier
                .align(Alignment.TopStart)
                .statusBarsPadding()
                .padding(6.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "对话",
                tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f),
            )
        }
    }
}