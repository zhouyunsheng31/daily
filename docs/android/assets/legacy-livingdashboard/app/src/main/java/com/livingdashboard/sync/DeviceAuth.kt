package com.livingdashboard.sync

import android.content.Context
import java.util.UUID

class DeviceAuth(private val context: Context) {
    companion object {
        private const val PREFS_NAME = "living_dashboard_prefs"
        private const val KEY_DEVICE_ID = "living_dashboard_device_id"
        private const val KEY_SERVER_TOKEN = "living_dashboard_server_token"
    }

    fun getDeviceId(): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun getServerToken(): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_SERVER_TOKEN, null)
    }

    fun setServerToken(token: String?) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (token.isNullOrEmpty()) {
            prefs.edit().remove(KEY_SERVER_TOKEN).apply()
        } else {
            prefs.edit().putString(KEY_SERVER_TOKEN, token).apply()
        }
    }
}
