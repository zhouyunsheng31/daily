package xyz.shadowshub.appruntime

import android.webkit.JavascriptInterface
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import xyz.shadowshub.core.network.WebosApi

/**
 * Native ↔ JS 桥（JS 侧对象名 `dailyBridge`，协议与 PWA 端同构）。
 * JS: window.dailyBridge.postMessage(json) → 这里处理 storage/http 请求 →
 *     回调 onResponse(json)（宿主经 evaluateJavascript 调 window.__dailySdkDispatch）。
 * 安全：App 不能拿到鉴权 cookie/token——storage 走 native OkHttp（CookieJar 持久化）。
 */
class DailyJsBridge(
    private val appId: String,
    private val api: WebosApi,
    private val scope: CoroutineScope,
    private val onResponse: (String) -> Unit,
) {
    private val json = Json { ignoreUnknownKeys = true }

    @JavascriptInterface
    fun postMessage(jsonStr: String) {
        scope.launch {
            val msg = try {
                json.parseToJsonElement(jsonStr) as? JsonObject
            } catch (_: Exception) { null } ?: return@launch
            if (msg["channel"]?.let { it is kotlinx.serialization.json.JsonPrimitive && it.content == "daily-webos-sdk" } != true) return@launch
            if (msg["kind"]?.let { it is kotlinx.serialization.json.JsonPrimitive && it.content == "request" } != true) return@launch
            val requestId = msg["requestId"]?.let { if (it is kotlinx.serialization.json.JsonPrimitive) it.content else null } ?: return@launch
            val method = msg["method"]?.let { if (it is kotlinx.serialization.json.JsonPrimitive) it.content else "" } ?: ""
            val params = msg["params"] as? JsonObject ?: JsonObject(emptyMap())
            val key = params["key"]?.let { if (it is kotlinx.serialization.json.JsonPrimitive) it.content else null }

            val (ok, data, error) = try {
                when (method) {
                    "storage.get" -> {
                        val v = if (key != null) api.storageGet(appId, key) else null
                        Triple(true, buildJsonObject { put("value", v ?: "") }, null)
                    }
                    "storage.set" -> {
                        val value = params["value"]?.let { if (it is kotlinx.serialization.json.JsonPrimitive) it.content else null } ?: ""
                        Triple(api.storageSet(appId, key ?: "", value), JsonObject(emptyMap()), null)
                    }
                    "storage.remove" -> Triple(api.storageDelete(appId, key ?: ""), JsonObject(emptyMap()), null)
                    "storage.list" -> {
                        val items = api.storageList(appId)
                        val obj = buildJsonObject {
                            items.forEach { (k, v) -> put(k, v) }
                        }
                        Triple(true, obj, null)
                    }
                    "http.request" -> Triple(false, JsonObject(emptyMap()), "http.request 未实现（M0-3 暂不代理外部请求）")
                    "api.register" -> Triple(true, JsonObject(emptyMap()), null)
                    "api.call" -> Triple(false, JsonObject(emptyMap()), "api.call 未实现（M0-3 范围外）")
                    else -> Triple(false, JsonObject(emptyMap()), "unknown method: $method")
                }
            } catch (e: Exception) {
                Triple(false, JsonObject(emptyMap()), e.message ?: "bridge error")
            }

            val resp = buildJsonObject {
                put("channel", "daily-webos-sdk")
                put("kind", "response")
                put("requestId", requestId)
                put("ok", ok)
                put("data", data)
                if (error != null) put("error", error)
            }
            onResponse(json.encodeToString(JsonObject.serializer(), resp))
        }
    }
}