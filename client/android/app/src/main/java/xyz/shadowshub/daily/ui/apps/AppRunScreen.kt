package xyz.shadowshub.daily.ui.apps

import android.app.Application
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import xyz.shadowshub.daily.ui.theme.LoadingView

/**
 * App 运行页（M1-1 沉浸化）：
 * - 全屏 WebView 沙箱运行，无顶栏、edge-to-edge（返回 = 系统手势/返回键，predictive back）
 * - apps.open / system.navigate 由宿主注入分发（onOpenApp/onNavigate）
 * - 顶部 12dp 拖拽热区预留：M1-3「呼出 App 信息面板」用
 */
@Composable
fun AppRunScreen(
    appId: String,
    appName: String,
    onBack: () -> Unit,
    onOpenApp: (id: String, name: String) -> Unit = { _, _ -> },
    onNavigate: (view: String) -> Unit = {},
) {
    val context = LocalContext.current
    val api: WebosApi = remember {
        (context.applicationContext as Application).getKoin().get()
    }
    val scope = rememberCoroutineScope()
    val host = remember { AppRuntimeHost(context, api, scope, BuildConfig.API_BASE_URL, onOpenApp, onNavigate) }

    var detail by remember { mutableStateOf<AppDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(appId) {
        val d = api.appDetail(appId)
        android.util.Log.d("AppRuntime", "appDetail($appId): detail=${d != null}, versions=${d?.versions?.size}, activeVersionId=${d?.activeVersionId}, activeHtmlLen=${d?.activeHtml?.length}")
        if (d?.activeHtml != null) {
            detail = d
        } else {
            error = "App 无可用版本或加载失败 [appId=$appId, html=${d?.activeHtml?.length ?: "null"}]"
        }
    }

    Box(Modifier.fillMaxSize()) {
        // 系统返回 = 关闭当前 App（不退出 Daily）——M1-1 收尾：BackHandler 拦截
        BackHandler { onBack() }
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
            else -> LoadingView()
        }
    }
}