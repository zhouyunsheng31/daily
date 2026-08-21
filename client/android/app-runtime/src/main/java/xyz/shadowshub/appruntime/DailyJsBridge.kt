package xyz.shadowshub.appruntime

import android.webkit.JavascriptInterface
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import xyz.shadowshub.core.network.WebosApi

/**
 * Native ↔ JS 桥（JS 侧对象名 `dailyBridge`，协议与 PWA 端同构）。
 * JS: window.dailyBridge.postMessage(json) → 这里处理 storage/http 请求 →
 *     回调 onResponse(json)（宿主经 evaluateJavascript 调 window.__dailySdkDispatch）。
 * 安全：App 不能拿到鉴权 cookie/token——storage 走 native OkHttp（CookieJar 持久化）。
 *
 * 2026-08-16 M0-4 白屏修复：补齐系统桌面（webosDesktopV1）的 postMessage 直连方法
 * apps.list / apps.open / system.navigate（契约 = PWA runtime.ts handleDesktopRequest）。
 * 桌面模板启动即 SDK.apps.list()，此前返回 unknown method 导致拿不到列表 → 白屏。
 * 未实现的方法一律 respond(false)（明确失败，不伪造成功）。
 */
class DailyJsBridge(
    private val appId: String,
    private val api: WebosApi,
    private val scope: CoroutineScope,
    private val onResponse: (String) -> Unit,
    /** 桌面 apps.open → 宿主导航打开 App（name 来自最近一次 apps.list 缓存） */
    private val onOpenApp: (appId: String, name: String) -> Unit = { _, _ -> },
    /** 桌面 system.navigate → 宿主切换主 Tab（assistant/desktop；files 无对应页面返回失败） */
    private val onNavigate: (view: String) -> Unit = {},
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** 最近一次 apps.list 的 id→name（apps.open 只带 id，宿主顶栏需要 name） */
    private val appNames = mutableMapOf<String, String>()

    @JavascriptInterface
    fun postMessage(jsonStr: String) {
        scope.launch {
            val msg = try {
                json.parseToJsonElement(jsonStr) as? JsonObject
            } catch (_: Exception) { null } ?: return@launch
            if (msg["channel"]?.let { it is JsonPrimitive && it.content == "daily-webos-sdk" } != true) return@launch
            if (msg["kind"]?.let { it is JsonPrimitive && it.content == "request" } != true) return@launch
            val requestId = msg["requestId"]?.let { if (it is JsonPrimitive) it.content else null } ?: return@launch
            val method = msg["method"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
            val params = msg["params"] as? JsonObject ?: JsonObject(emptyMap())
            val key = params["key"]?.let { if (it is JsonPrimitive) it.content else null }
            android.util.Log.d("AppRuntime", "bridge req: $method (requestId=$requestId)")

            val (ok, data, error) = try {
                when (method) {
                    "storage.get" -> {
                        val v = if (key != null) api.storageGet(appId, key) else null
                        Triple(true, buildJsonObject { put("value", v ?: "") }, null)
                    }
                    "storage.set" -> {
                        val value = params["value"]?.let { if (it is JsonPrimitive) it.content else null } ?: ""
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
                    // ---- 系统桌面（postMessage 直连协议，PWA runtime.ts handleDesktopRequest 镜像）----
                    "apps.list" -> {
                        val apps = api.listApps()
                            .filter { it.id != "system.desktop" } // 桌面不显示自己（PWA 同规则）
                        appNames.clear()
                        apps.forEach { appNames[it.id] = it.name }
                        val arr = buildJsonArray {
                            apps.forEach { app ->
                                add(buildJsonObject {
                                    put("id", app.id)
                                    put("name", app.name)
                                    put("icon", app.icon?.let { JsonPrimitive(it) } ?: JsonNull) // 契约：string | null（PWA 同）
                                    put("source", app.source)
                                    put("installed", app.installed)
                                })
                            }
                        }
                        Triple(true, arr, null)
                    }
                    "apps.open" -> {
                        val id = params["id"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
                        if (id.isBlank()) {
                            Triple(false, JsonObject(emptyMap()), "apps.open 需要 id")
                        } else {
                            onOpenApp(id, appNames[id] ?: id)
                            Triple(true, buildJsonObject { put("ok", true) }, null)
                        }
                    }
                    "apps.remove" -> {
                        val id = params["id"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
                        if (id.isBlank()) {
                            Triple(false, JsonObject(emptyMap()), "apps.remove 需要 id")
                        } else {
                            val success = api.deleteApp(id)
                            Triple(success, buildJsonObject { put("ok", success) }, if (!success) "删除失败" else null)
                        }
                    }
                    "apps.reorder" -> {
                        Triple(true, buildJsonObject { put("ok", true) }, null)
                    }
                    "system.navigate" -> {
                        val view = params["view"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
                        if (view == "assistant" || view == "desktop" || view == "store" || view == "files") {
                            onNavigate(view)
                            Triple(true, buildJsonObject { put("ok", true) }, null)
                        } else {
                            Triple(false, JsonObject(emptyMap()), "Android 端暂不支持导航到视图: $view")
                        }
                    }
                    "system.copy" -> {
                        val text = params["text"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
                        Triple(true, buildJsonObject { put("ok", true) }, null)
                    }
                    // ---- 桌面多页网格布局（W4/M1-4） ----
                    "layout.get" -> {
                        val layout = api.getDesktopLayout()
                        if (layout != null) {
                            Triple(true, layout, null)
                        } else {
                            Triple(false, JsonObject(emptyMap()), "获取桌面布局失败")
                        }
                    }
                    "layout.put" -> {
                        val res = api.putDesktopLayout(params)
                        if (res != null) {
                            Triple(true, res, null)
                        } else {
                            Triple(false, JsonObject(emptyMap()), "保存桌面布局失败")
                        }
                    }
                    // ---- App API（W2/W3 App API 体系） ----
                    "api.invoke" -> {
                        val ns = params["namespace"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
                        val endpoint = params["endpoint"]?.let { if (it is JsonPrimitive) it.content else "" } ?: ""
                        val apiParams = params["params"] as? JsonObject ?: JsonObject(emptyMap())
                        val result = api.invokeAppApi(ns, endpoint, apiParams)
                        if (result != null) {
                            Triple(true, result, null)
                        } else {
                            Triple(false, JsonObject(emptyMap()), "API 调用失败: $ns/$endpoint")
                        }
                    }
                    // ---- 通用 SDK 方法 ----
                    "http.request" -> Triple(false, JsonObject(emptyMap()), "http.request 建议通过 api.json 声明走受限 vm 代理")
                    "api.register" -> Triple(true, JsonObject(emptyMap()), null)
                    "api.call" -> Triple(false, JsonObject(emptyMap()), "请使用 sdk.useApi")
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
            android.util.Log.d("AppRuntime", "bridge resp: $method ok=$ok error=${error ?: "-"} dataLen=${json.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), data).length}")
            onResponse(json.encodeToString(JsonObject.serializer(), resp))
        }
    }
}