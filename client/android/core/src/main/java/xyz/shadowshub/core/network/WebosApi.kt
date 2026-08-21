package xyz.shadowshub.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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
                // 按 id 去重：bootstrap = BUILTIN_APPS + 用户 state.apps，同一 system.* 可能出现两次
                // （后出现的用户版优先——版本/名称更新）
                val byId = LinkedHashMap<String, AppSummary>()
                arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    val id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
                    byId[id] = AppSummary(
                        id = id,
                        name = o["name"]?.jsonPrimitive?.content ?: "",
                        icon = o["icon"]?.jsonPrimitive?.contentOrNull,
                        source = o["source"]?.jsonPrimitive?.contentOrNull ?: "local",
                        installed = o["installed"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: true,
                    )
                }
                byId.values.toList()
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

    /** 删除 App：DELETE /webos/api/apps/:appId */
    suspend fun deleteApp(appId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}").delete().build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 回滚 App 版本：POST /webos/api/apps/:appId/rollback */
    suspend fun rollbackApp(appId: String, versionId: String? = null): Boolean = withContext(Dispatchers.IO) {
        try {
            val bodyObj = buildJsonObject { versionId?.let { put("versionId", it) } }
            val body = bodyObj.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/apps/${appId}/rollback").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 获取桌面多页布局：GET /webos/api/desktop-layout */
    suspend fun getDesktopLayout(): JsonObject? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/desktop-layout").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
                root?.get("layout") as? JsonObject ?: root
            }
        } catch (_: Exception) { null }
    }

    /** 保存桌面多页布局：PUT /webos/api/desktop-layout */
    suspend fun putDesktopLayout(layout: JsonObject): JsonObject? = withContext(Dispatchers.IO) {
        try {
            val body = layout.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/desktop-layout").put(body).build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
            }
        } catch (_: Exception) { null }
    }

    /** 调用 App API：POST /webos/api/appapi/:namespace/:endpoint */
    suspend fun invokeAppApi(namespace: String, endpoint: String, params: JsonObject = buildJsonObject {}): JsonObject? = withContext(Dispatchers.IO) {
        try {
            val body = params.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/appapi/${namespace}/${endpoint}").post(body).build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
            }
        } catch (_: Exception) { null }
    }

    // ========================================================================
    // Packages API (W1 体系)
    // ========================================================================

    /** 获取包列表：GET /webos/api/packages?type=&q= */
    suspend fun listPackages(type: String? = null, query: String? = null): List<PackageSummary> = withContext(Dispatchers.IO) {
        try {
            val urlBuilder = "$baseUrl/webos/api/packages".toHttpUrl().newBuilder()
            type?.let { urlBuilder.addQueryParameter("type", it) }
            query?.let { urlBuilder.addQueryParameter("q", it) }
            val req = Request.Builder().url(urlBuilder.build()).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyList()
                val arr = root["packages"] as? JsonArray ?: return@withContext emptyList()
                arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    val id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
                    PackageSummary(
                        id = id,
                        type = o["type"]?.jsonPrimitive?.content ?: "app",
                        name = o["name"]?.jsonPrimitive?.content ?: id,
                        icon = o["icon"]?.jsonPrimitive?.contentOrNull,
                        activeVersionId = o["activeVersionId"]?.jsonPrimitive?.contentOrNull,
                        installed = o["installed"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: true,
                    )
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    /** 获取包详情：GET /webos/api/packages/:id */
    suspend fun getPackageDetail(id: String): PackageDetail? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/packages/$id").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext null
                val pkg = root["package"] as? JsonObject ?: return@withContext null
                val versionsArr = pkg["versions"] as? JsonArray ?: JsonArray(emptyList())
                val versions = versionsArr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    PackageVersionDetail(
                        id = o["id"]?.jsonPrimitive?.content ?: "",
                        packageId = o["packageId"]?.jsonPrimitive?.content ?: id,
                        version = o["version"]?.jsonPrimitive?.content ?: "",
                        status = o["status"]?.jsonPrimitive?.content ?: "ready",
                        manifest = o["manifest"] as? JsonObject,
                        createdAt = o["createdAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                        createdBy = o["createdBy"]?.jsonPrimitive?.contentOrNull,
                    )
                }
                PackageDetail(
                    id = pkg["id"]?.jsonPrimitive?.content ?: id,
                    type = pkg["type"]?.jsonPrimitive?.content ?: "app",
                    name = pkg["name"]?.jsonPrimitive?.content ?: id,
                    icon = pkg["icon"]?.jsonPrimitive?.contentOrNull,
                    activeVersionId = pkg["activeVersionId"]?.jsonPrimitive?.contentOrNull,
                    versions = versions,
                )
            }
        } catch (_: Exception) { null }
    }

    /** 回滚包版本：POST /webos/api/packages/:id/rollback */
    suspend fun rollbackPackage(id: String, toVersionId: String? = null): Boolean = withContext(Dispatchers.IO) {
        try {
            val bodyObj = buildJsonObject { toVersionId?.let { put("toVersionId", it) } }
            val body = bodyObj.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/packages/$id/rollback").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 删除包：DELETE /webos/api/packages/:id */
    suspend fun deletePackage(id: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/packages/$id").delete().build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    // ========================================================================
    // Market API (W3 统一包市场)
    // ========================================================================

    /** 市场列表：GET /webos/api/market?type=&q= */
    suspend fun listMarket(type: String? = null, query: String? = null): MarketListing = withContext(Dispatchers.IO) {
        try {
            val urlBuilder = "$baseUrl/webos/api/market".toHttpUrl().newBuilder()
            type?.let { urlBuilder.addQueryParameter("type", it) }
            query?.let { urlBuilder.addQueryParameter("q", it) }
            val req = Request.Builder().url(urlBuilder.build()).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext MarketListing()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext MarketListing()
                val arr = root["items"] as? JsonArray ?: return@withContext MarketListing()
                val items = arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    MarketItem(
                        id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                        type = o["type"]?.jsonPrimitive?.content ?: "app",
                        name = o["name"]?.jsonPrimitive?.content ?: "",
                        description = o["description"]?.jsonPrimitive?.contentOrNull ?: "",
                        icon = o["icon"]?.jsonPrimitive?.contentOrNull,
                        author = o["author"]?.jsonPrimitive?.contentOrNull ?: "",
                        installed = o["installed"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: false,
                    )
                }
                MarketListing(items = items, total = root["total"]?.jsonPrimitive?.content?.toIntOrNull() ?: items.size)
            }
        } catch (_: Exception) { MarketListing() }
    }

    /** 安装市场包：POST /webos/api/market/:id/install */
    suspend fun installMarketPackage(id: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = "{}".toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/market/$id/install").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 市场详情：GET /webos/api/market/:id */
    suspend fun getMarketDetail(id: String): JsonObject? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/market/$id").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
            }
        } catch (_: Exception) { null }
    }

    /** 我的市场安装记录：GET /webos/api/market/mine */
    suspend fun listMarketMine(): List<String> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/market/mine").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyList()
                val arr = root["installed"] as? JsonArray ?: root["items"] as? JsonArray ?: return@withContext emptyList()
                arr.mapNotNull { (it as? JsonPrimitive)?.content }
            }
        } catch (_: Exception) { emptyList() }
    }

    /** 发布包到市场：POST /webos/api/market/publish { packageId } */
    suspend fun publishMarketPackage(packageId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject { put("packageId", packageId) }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/market/publish").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 从市场下架包：POST /webos/api/market/:id/unpublish */
    suspend fun unpublishMarketPackage(id: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = "{}".toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/market/$id/unpublish").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    // ========================================================================
    // App API 发布与密钥托管 (W2/W3 & M2-2 服务即包)
    // ========================================================================

    /** 发布命名空间为公开 API：POST /webos/api/appapi/:namespace/publish */
    suspend fun publishAppApiNamespace(namespace: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/appapi/$namespace/publish").post("{}".toRequestBody(JSON)).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 撤回公开 API：POST /webos/api/appapi/:namespace/unpublish */
    suspend fun unpublishAppApiNamespace(namespace: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/appapi/$namespace/unpublish").post("{}".toRequestBody(JSON)).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 获取 API 发布状态：GET /webos/api/appapi/:namespace/status */
    suspend fun getAppApiStatus(namespace: String): JsonObject? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/appapi/$namespace/status").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
            }
        } catch (_: Exception) { null }
    }

    /** 托管/更新 API 密钥（服务端安全托管，脱敏）：PUT /webos/api/appapi/:namespace/secrets */
    suspend fun setAppApiSecrets(namespace: String, values: Map<String, String>): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject {
                put("values", buildJsonObject {
                    values.forEach { (k, v) -> put(k, v) }
                })
            }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/appapi/$namespace/secrets").put(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 查询 API 密钥设置状态（不含明文）：GET /webos/api/appapi/:namespace/secrets */
    suspend fun getAppApiSecretsStatus(namespace: String): JsonObject? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/appapi/$namespace/secrets").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject
            }
        } catch (_: Exception) { null }
    }

    // ========================================================================
    // 账号认证与漫游 (M2-3)
    // ========================================================================

    /** 发送邮箱验证码：POST /api/auth/email/send-code */
    suspend fun sendEmailCode(email: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject { put("email", email) }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/api/auth/email/send-code").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 邮箱注册并自动登录：POST /api/auth/email/register */
    suspend fun registerWithEmail(email: String, code: String, password: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject {
                put("email", email)
                put("code", code)
                put("password", password)
            }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/api/auth/email/register").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 邮箱登录（自动迁移游客资产）：POST /api/auth/email/login */
    suspend fun loginWithEmail(email: String, password: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject {
                put("email", email)
                put("password", password)
            }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/api/auth/email/login").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 重置密码并登录：POST /api/auth/email/reset-password */
    suspend fun resetPassword(email: String, code: String, password: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject {
                put("email", email)
                put("code", code)
                put("newPassword", password)
            }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/api/auth/email/reset-password").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    // ========================================================================
    // File Service API (W-F 体系)
    // ========================================================================

    /** 获取文件清单：GET /webos/api/files/manifest?prefix= */
    suspend fun getFilesManifest(prefix: String = ""): List<FileManifestEntry> = withContext(Dispatchers.IO) {
        try {
            val urlBuilder = "$baseUrl/webos/api/files/manifest".toHttpUrl().newBuilder()
            if (prefix.isNotBlank()) urlBuilder.addQueryParameter("prefix", prefix)
            val req = Request.Builder().url(urlBuilder.build()).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyList()
                val arr = root["files"] as? JsonArray ?: return@withContext emptyList()
                arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    FileManifestEntry(
                        path = o["path"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                        size = o["size"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                        sha256 = o["sha256"]?.jsonPrimitive?.content ?: "",
                        updatedAt = o["updatedAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                    )
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    /** 删除文件：DELETE /webos/api/files?path= */
    suspend fun deleteFile(path: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val url = "$baseUrl/webos/api/files".toHttpUrl().newBuilder().addQueryParameter("path", path).build()
            val req = Request.Builder().url(url).delete().build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    // ========================================================================
    // NetSpaces API (W3 互通原语)
    // ========================================================================

    /** 共享空间列表：GET /webos/api/net/spaces */
    suspend fun listNetSpaces(): List<NetSpace> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("$baseUrl/webos/api/net/spaces").get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyList()
                val arr = root["spaces"] as? JsonArray ?: return@withContext emptyList()
                arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    val id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
                    NetSpace(
                        id = id,
                        name = o["name"]?.jsonPrimitive?.content ?: id,
                        ownerHandle = o["ownerHandle"]?.jsonPrimitive?.content ?: "",
                        mode = o["mode"]?.jsonPrimitive?.content ?: "private",
                        createdAt = o["createdAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                    )
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    /** 创建共享空间：POST /webos/api/net/spaces */
    suspend fun createNetSpace(name: String, mode: String = "private"): NetSpace? = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject {
                put("name", name)
                put("mode", mode)
            }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/net/spaces").post(body).build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext null
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext null
                val s = root["space"] as? JsonObject ?: return@withContext null
                val id = s["id"]?.jsonPrimitive?.content ?: return@withContext null
                NetSpace(
                    id = id,
                    name = s["name"]?.jsonPrimitive?.content ?: name,
                    ownerHandle = s["ownerHandle"]?.jsonPrimitive?.content ?: "",
                    mode = s["mode"]?.jsonPrimitive?.content ?: mode,
                    createdAt = s["createdAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                )
            }
        } catch (_: Exception) { null }
    }

    /** 发送空间事件：POST /webos/api/net/spaces/:id/events */
    suspend fun postNetSpaceEvent(spaceId: String, kind: String, payload: JsonObject, to: String? = null): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = buildJsonObject {
                put("kind", kind)
                put("payload", payload)
                to?.let { put("to", it) }
            }.toString().toRequestBody(JSON)
            val req = Request.Builder().url("$baseUrl/webos/api/net/spaces/$spaceId/events").post(body).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) { false }
    }

    /** 获取空间事件列表：GET /webos/api/net/spaces/:id/events?afterSeq=&to= */
    suspend fun getNetSpaceEvents(spaceId: String, afterSeq: Long? = null, to: String? = null): List<NetEvent> = withContext(Dispatchers.IO) {
        try {
            val urlBuilder = "$baseUrl/webos/api/net/spaces/$spaceId/events".toHttpUrl().newBuilder()
            afterSeq?.let { urlBuilder.addQueryParameter("afterSeq", it.toString()) }
            to?.let { urlBuilder.addQueryParameter("to", it) }
            val req = Request.Builder().url(urlBuilder.build()).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val root = json.parseToJsonElement(resp.body?.string() ?: "{}") as? JsonObject ?: return@withContext emptyList()
                val arr = root["events"] as? JsonArray ?: return@withContext emptyList()
                arr.mapNotNull { el ->
                    val o = el as? JsonObject ?: return@mapNotNull null
                    NetEvent(
                        seq = o["seq"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                        spaceId = o["spaceId"]?.jsonPrimitive?.content ?: spaceId,
                        fromHandle = o["fromHandle"]?.jsonPrimitive?.content ?: "",
                        toHandle = o["toHandle"]?.jsonPrimitive?.contentOrNull,
                        type = o["kind"]?.jsonPrimitive?.content ?: o["type"]?.jsonPrimitive?.content ?: "event",
                        payload = o["payload"] as? JsonObject ?: buildJsonObject {},
                        timestamp = o["timestamp"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                    )
                }
            }
        } catch (_: Exception) { emptyList() }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}