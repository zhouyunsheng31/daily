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
import xyz.shadowshub.daily.ui.chat.ChatViewModel
import java.util.concurrent.TimeUnit

/** Koin 依赖注入（M0-2：会话 + 对话链路） */
val appModule = module {
    single { SessionStore(get()) }

    single {
        PersistentCookieJar(get())
    }

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
        ChatViewModel(repository = get(), sessionStore = get())
    }
}

/** Application 初始化用（DailyApplication.startKoin） */
fun appModules() = appModule