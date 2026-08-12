package xyz.shadowshub.daily

import android.app.Application
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin

/**
 * Daily Android Shell 入口。
 * M0-1 仅初始化 Koin 空模块；M0-2 起注册 core 网络/SSE 模块。
 */
class DailyApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidLogger()
            androidContext(this@DailyApplication)
            modules(emptyList())
        }
    }
}