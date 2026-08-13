package xyz.shadowshub.daily.data

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * 持久化 CookieJar：cookie 存 SharedPreferences（进程重启不丢）。
 * webOS 鉴权依赖 access_token cookie（服务端 res.cookie 种下）。
 */
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("daily_cookies", Context.MODE_PRIVATE)

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val all = loadAll().toMutableMap()
        cookies.forEach { c ->
            val key = "${c.name}@${url.host}"
            all[key] = c.toString()
        }
        val editor = prefs.edit()
        editor.clear()
        all.forEach { (k, v) -> editor.putString(k, v) }
        editor.apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val all = loadAll()
        return all.mapNotNull { (_, raw) ->
            try {
                Cookie.parse(url, raw)?.takeIf { it.matches(url) }
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun loadAll(): Map<String, String> =
        prefs.all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()

    companion object {
        fun clear(context: Context) {
            context.getSharedPreferences("daily_cookies", Context.MODE_PRIVATE).edit().clear().apply()
        }
    }
}