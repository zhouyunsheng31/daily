package com.livingdashboard.sync

import com.livingdashboard.BuildConfig
import java.net.URLEncoder

class ServerConfig(private val deviceAuth: DeviceAuth) {
    /**
     * 构建带 deviceId + token 的完整 WS URL
     * WS_URL 来自 BuildConfig（编译时由 local.properties 注入）
     * 真机验收前在 local.properties 设置 LIVING_DASHBOARD_WS_URL=ws://<主机IP>:3456/ws
     */
    fun buildWsUrl(): String {
        val base = BuildConfig.WS_URL
        val deviceId = deviceAuth.getDeviceId()
        val token = deviceAuth.getServerToken()
        val sb = StringBuilder(base)
        sb.append(if (base.contains("?")) "&" else "?")
        sb.append("deviceId=").append(URLEncoder.encode(deviceId, "UTF-8"))
        if (token != null) {
            sb.append("&token=").append(URLEncoder.encode(token, "UTF-8"))
        }
        return sb.toString()
    }

    fun getDisplayUrl(): String = BuildConfig.WS_URL
}
