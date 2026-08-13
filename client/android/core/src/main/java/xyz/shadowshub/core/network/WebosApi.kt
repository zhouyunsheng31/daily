package xyz.shadowshub.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import xyz.shadowshub.core.chat.ChatEvent
import xyz.shadowshub.core.chat.ChatStreamRequest

/**
 * webOS API 客户端（M0-2 最小集）。
 * 协议要点（2026-08-15 从 server/src/routes/auth.ts + webos.ts 核实）：
 * - 鉴权：access_token cookie（CookieJar 持久化；服务端 res.cookie 设置）
 * - guest：POST /api/auth/guest {deviceId} → {authenticated, token, user}（同时种 cookie）
 * - bootstrap：GET /webos/api/bootstrap
 * - chat：POST /webos/api/chat/stream {messages, model, thinking, conversationId, resume?} → SSE
 * - SSE 格式：data: {json}\n\n
 */
class WebosApi(
    private val client: OkHttpClient,
    private val sse: SseSource,
    private val baseUrl: String = "https://shadowshub.xyz",
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** 游客登录：返回 token（cookie 已由服务端 Set-Cookie 种下，CookieJar 自动持久化） */
    suspend fun guest(deviceId: String): String? = withContext(Dispatchers.IO) {
        val body = """{"deviceId":"$deviceId"}""".toRequestBody(JSON)
        val req = Request.Builder().url("$baseUrl/api/auth/guest").post(body).build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext null
            val obj = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext null
            (obj["token"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        }
    }

    /** bootstrap：会话/余额/AI 配置/应用列表 */
    suspend fun bootstrap(): JsonObject? = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$baseUrl/webos/api/bootstrap").get().build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext null
            json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
        }
    }

    /** chat/stream SSE：返回事件流 */
    fun chatStream(request: ChatStreamRequest): Flow<ChatEvent> {
        val req = Request.Builder()
            .url("$baseUrl/webos/api/chat/stream")
            .post(request.json.toRequestBody(JSON))
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .build()
        return sse.events(req)
    }

    /** App 列表：GET /webos/api/apps → {apps:[...]} */
    suspend fun listApps(): List<AppSummary> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/apps").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyList()
                val arr = root["apps"] as? JsonArray ?: return@withContext emptyList()
                arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    AppSummary(
                        id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                        name = o["name"]?.jsonPrimitive?.content ?: "",
                        icon = o["icon"]?.jsonPrimitive?.contentOrNull,
                    )
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    /** App 详情（含版本 HTML）：GET /webos/api/apps/:appId → {app:{...}} */
    suspend fun appDetail(appId: String): AppDetail? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext null
                val app = root["app"] as? JsonObject ?: return@withContext null
                val versionsArr = app["versions"] as? JsonArray ?: JsonArray(emptyList())
                val versions = versionsArr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    AppVersion(
                        id = o["id"]?.jsonPrimitive?.content ?: "",
                        version = o["version"]?.jsonPrimitive?.content ?: "",
                        html = o["html"]?.jsonPrimitive?.contentOrNull,
                    )
                }
                AppDetail(
                    id = app["id"]?.jsonPrimitive?.content ?: appId,
                    name = app["name"]?.jsonPrimitive?.content ?: "",
                    activeVersionId = app["activeVersionId"]?.jsonPrimitive?.contentOrNull,
                    versions = versions,
                )
            }
        } catch (_: Exception) { null }
    }

    /** App 私有存储读：GET /apps/:appId/storage/:key */
    suspend fun storageGet(appId: String, key: String): String? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}/storage/${key}").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val obj = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext null
                obj["value"]?.jsonPrimitive?.contentOrNull
            }
        } catch (_: Exception) { null }
    }

    /** App 私有存储全量：GET /apps/:appId/storage → {items:{...}} */
    suspend fun storageList(appId: String): Map<String, String> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}/storage").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyMap()
                val obj = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyMap()
                val items = obj["items"] as? JsonObject ?: return@withContext emptyMap()
                items.mapNotNull { (k, v) -> (v as? kotlinx.serialization.json.JsonPrimitive)?.content?.let { k to it } }.toMap()
            }
        } catch (_: Exception) { emptyMap() }
    }

    /** App 私有存储写：PUT /apps/:appId/storage/:key */
    suspend fun storageSet(appId: String, key: String, value: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = """{"value":${Json.encodeToString(kotlinx.serialization.json.JsonPrimitive.serializer(), kotlinx.serialization.json.JsonPrimitive(value))}}""".toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}/storage/${key}").put(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** App 私有存储删：DELETE /apps/:appId/storage/:key */
    suspend fun storageDelete(appId: String, key: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}/storage/${key}").delete().build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}