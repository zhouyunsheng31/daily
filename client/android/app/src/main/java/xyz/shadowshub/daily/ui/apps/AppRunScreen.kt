package xyz.shadowshub.daily.ui.apps

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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

/**
 * App 运行页（M0-3）：WebView 沙箱全屏运行 + 返回。
 */
@Composable
fun AppRunScreen(appId: String, appName: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val api: WebosApi = remember {
        (context.applicationContext as Application).getKoin().get()
    }
    val scope = rememberCoroutineScope()
    val host = remember { AppRuntimeHost(context, api, scope, BuildConfig.API_BASE_URL) }

    var detail by remember { mutableStateOf<AppDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(appId) {
        val d = api.appDetail(appId)
        if (d?.activeHtml != null) detail = d else error = "App 无可用版本或加载失败"
    }

    Column(Modifier.fillMaxSize()) {
        // 顶栏
        Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
                Text(appName, style = MaterialTheme.typography.titleMedium)
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
                            host.loadApp(wv, detail!!)
                        }
                    },
                    update = {},
                    onRelease = { AppRuntimeHost.destroy(it) },
                )
                else -> Text("加载中…", modifier = Modifier.align(Alignment.Center))
            }
        }
    }
}