package com.livingdashboard.script

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.livingdashboard.ai.ActiveWebViewHolder
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

/**
 * GM_notification 点击事件接收器（Spec 2.3.6）。
 *
 * 监听 `com.livingdashboard.GM_NOTIF_CLICK` Action，收到后通过 [ActiveWebViewHolder]
 * 拿当前 WebView，调 `evaluateJavascript("__gmNotificationOnClick('$cbId')")`
 * 触发 JS 侧 callbacks[cbId].onclick 回调。
 *
 * v3 修复 S6/N2：在 AndroidManifest.xml 注册：
 * ```xml
 * <receiver android:name=".script.GmNotificationReceiver" android:exported="false">
 *     <intent-filter>
 *         <action android:name="com.livingdashboard.GM_NOTIF_CLICK" />
 *     </intent-filter>
 * </receiver>
 * ```
 *
 * BroadcastReceiver 由系统创建，无法用 @Inject 构造，用 EntryPoint 获取 Singleton 依赖。
 */
class GmNotificationReceiver : BroadcastReceiver() {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface GmNotificationEntryPoint {
        fun activeWebViewHolder(): ActiveWebViewHolder
    }

    override fun onReceive(context: Context, intent: Intent) {
        val cbId = intent.getStringExtra("cbId") ?: return
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext,
            GmNotificationEntryPoint::class.java,
        )
        val webview = entryPoint.activeWebViewHolder().value.value
        webview?.evaluateJavascript(
            "window.__gmNotificationOnClick && __gmNotificationOnClick('$cbId')",
            null,
        )
    }
}
