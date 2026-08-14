package xyz.shadowshub.daily.di

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module
import xyz.shadowshub.core.network.SseSource
import xyz.shadowshub.core.network.WebosApi
import xyz.shadowshub.core.network.WebosRepository
import xyz.shadowshub.daily.BuildConfig
import xyz.shadowshub.daily.data.PersistentCookieJar
import xyz.shadowshub.daily.data.SessionStore
import xyz.shadowshub.daily.ui.apps.AppsViewModel
import xyz.shadowshub.daily.ui.chat.ChatViewModel
import java.util.concurrent.TimeUnit

/** Koin 依赖注入（M0-2：会话 + 对话链路） */
val appModule = module {
    single { SessionStore(get()) }

    // 显式按接口注册：OkHttpClient.cookieJar(get()) 按 CookieJar 解析
    single<okhttp3.CookieJar> { PersistentCookieJar(get()) }

    single {
        OkHttpClient.Builder()
            .cookieJar(get())
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // SSE 长连接：不设读超时
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    single { SseSource(get()) }

    single {
        WebosApi(
            client = get(),
            sse = get(),
            baseUrl = BuildConfig.API_BASE_URL,
        )
    }

    single {
        CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }

    single {
        WebosRepository(api = get(), scope = get())
    }

    viewModel {
        // 占位（D15 端侧 pi）：harness 就绪后改为真实 AgentChatSource 组合并用 get() 获取；
        // getOrNull 无注册时返回 null → ChatViewModel 走 SSE 分支。
        // 注意：不能用 single<AgentChatSource?> { null }——Koin single 的 value 为 null 时
        // SingleInstanceFactory.getValue 直接抛 IllegalStateException（2026-08-16 真机崩溃定位）。
        ChatViewModel(repository = get(), sessionStore = get(), agentSource = getOrNull())
    }

    viewModel {
        AppsViewModel(api = get())
    }
}

/** Application 初始化用（DailyApplication.startKoin） */
fun appModules() = appModule