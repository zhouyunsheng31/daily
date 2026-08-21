package xyz.shadowshub.appruntime

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * WebOS 离线静态资源与 App 缓存管理器（M1-4 核心机制）。
 */
class WebResourceCacheHelper(
    private val context: Context,
    private val client: OkHttpClient,
    private val scope: CoroutineScope,
) {
    private val cacheDir = File(context.cacheDir, "webos_static_cache").apply {
        if (!exists()) mkdirs()
    }

    /** 是否应当缓存该静态资源 */
    fun shouldCache(url: String): Boolean {
        val cleanUrl = url.split("?").first().lowercase()
        return cleanUrl.endsWith(".js") ||
                cleanUrl.endsWith(".css") ||
                cleanUrl.endsWith(".woff2") ||
                cleanUrl.endsWith(".woff") ||
                cleanUrl.endsWith(".ttf") ||
                cleanUrl.endsWith(".png") ||
                cleanUrl.endsWith(".jpg") ||
                cleanUrl.endsWith(".jpeg") ||
                cleanUrl.endsWith(".svg") ||
                cleanUrl.endsWith(".ico")
    }

    fun interceptRequest(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString()
        if (request.method.uppercase() != "GET") return null
        if (!shouldCache(url)) return null

        val cacheKey = hashUrl(url)
        val ext = url.split("?").first().substringAfterLast('.', "")
        val localFile = File(cacheDir, "$cacheKey.$ext")

        val mime = getMimeType(url)

        // 1. 本地命中缓存 -> 直接返回
        if (localFile.exists() && localFile.length() > 0) {
            return try {
                WebResourceResponse(mime, "UTF-8", FileInputStream(localFile))
            } catch (_: Exception) { null }
        }

        // 2. 本地未命中 -> 异步抓取并写盘
        scope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder().url(url).build()
                client.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val bytes = resp.body?.bytes()
                        if (bytes != null && bytes.isNotEmpty()) {
                            localFile.writeBytes(bytes)
                        }
                    }
                }
            } catch (_: Exception) {}
        }

        return null
    }

    private fun getMimeType(url: String): String {
        val cleanUrl = url.split("?").first().lowercase()
        return when {
            cleanUrl.endsWith(".js") -> "application/javascript"
            cleanUrl.endsWith(".css") -> "text/css"
            cleanUrl.endsWith(".woff2") -> "font/woff2"
            cleanUrl.endsWith(".woff") -> "font/woff"
            cleanUrl.endsWith(".ttf") -> "font/ttf"
            cleanUrl.endsWith(".png") -> "image/png"
            cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg") -> "image/jpeg"
            cleanUrl.endsWith(".svg") -> "image/svg+xml"
            cleanUrl.endsWith(".ico") -> "image/x-icon"
            else -> "application/octet-stream"
        }
    }

    private fun hashUrl(url: String): String {
        val md = MessageDigest.getInstance("MD5")
        val bytes = md.digest(url.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
