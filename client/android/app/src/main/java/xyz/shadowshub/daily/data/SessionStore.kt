package xyz.shadowshub.daily.data

import android.content.Context
import java.util.UUID

/**
 * 设备身份存储（游客唯一标识）。
 * deviceId 首次生成后永久持久化（SharedPreferences），
 * 用于 POST /api/auth/guest 换取游客 JWT（换设备 = 新游客）。
 */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("daily_session", Context.MODE_PRIVATE)

    fun deviceId(): String {
        prefs.getString(KEY_DEVICE_ID, null)?.let { return it }
        val id = "android-" + UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
    }
}