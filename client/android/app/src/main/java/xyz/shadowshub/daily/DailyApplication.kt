package xyz.shadowshub.daily

import android.app.Application
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin
import xyz.shadowshub.daily.di.appModule

/**
 * Daily Android Shell 入口。
 * M0-2：注册 appModule（会话存储/CookieJar/OkHttp/SSE/API/Repository）。
 */
class DailyApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidLogger()
            androidContext(this@DailyApplication)
            modules(appModule)
        }
    }
}