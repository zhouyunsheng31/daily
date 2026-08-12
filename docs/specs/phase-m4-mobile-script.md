# Phase M4 移动端脚本系统 Spec v3.1

> 生成日期：2026-06-30
> v3.1 修订（v3 修订补丁）：基于 v3 第二轮对抗审查报告修复 2 阻塞项 + 4 非阻塞项
>   - B1（阻塞）：S3 `lastInjectedUrl` 去重 if 块为空体，补 `return` 语句
>   - B2（阻塞）：`GM_getValue` defaultValue 链路断裂，JS 侧补发 `default` 字段
>   - N1：删除 `GM_notification` `onclick` 死代码（JSON.stringify 丢弃函数属性）
>   - N2：在 2.3.6 节补充 AndroidManifest `<receiver>` 声明
>   - N3：删除 `gm_api_init.js` payload 冗余 `_cbId` 字段
>   - N4：`BrowserViewModel` 参数计数 11→13（核对实际 13 个参数）
> v3 修订：基于 v2 对抗审查报告修复 3 致命 + 8 严重 + 8 中等 + 5 轻微问题
> v2 修订：基于 v1 对抗审查报告修复 11 个严重问题 + 12 个中等问题
> 关联 roadmap：[roadmap_mobile_v1.md](../roadmap_mobile_v1.md) 第 3.5 节 + Phase M4 任务表
> 架构依据：[architecture_refactor.md](../architecture_refactor.md) 第四/五/六章
> 布局参考：layout-design-mobile.md（M4 设计缺失，本 Spec 自补）
>
> 执行铁律：本 Spec → 对抗审查 Spec → 编码 → 对抗审查（含运行时验证）→ git commit

---

## 一、项目目的与上下文

### 1.1 项目定位
Living Dashboard 移动端 = AI 浏览器客户端（Kotlin + Compose + WebView，包体 < 20MB）。Phase M4 在 M0/M1/M2/M3/M8 完成的基础上补齐**脚本系统**：兼容油猴 `.user.js` + GM_* API + AI 生成脚本 + 常驻 UI + 脚本管理。

### 1.2 当前状态
- M0/M1/M2/M3/M8 已完成，versionCode=9, versionName=0.1.0-m3
- `client/android/app/src/main/java/com/livingdashboard/script/` 仅 `.gitkeep` 占位
- 数据库名 `"living.db"`（**非** living_dashboard.db），当前 version=3
- `LivingDatabase` 仅定义 `MIGRATION_2_3`（**无 MIGRATION_1_2**）
- `Converters.kt` 仅有 PanelType/WidgetType（**无 stringListConverter，必须新增**）
- `LivingWebChromeClient` 无 `onConsoleMessage` / `onJsPrompt`（必须新增 onJsPrompt）
- `KvStorage` 仅异步 read/write/listKeys（必须扩展同步 readSync + memoryCache + preload）
- 桌面端无油猴脚本体系，不可复用代码
- layout-design-mobile.md 缺失 M4 UI 设计

### 1.3 范围与边界

**本 Phase 做**：
- T1 数据层：UserScriptEntity + Dao + Repository + Room Migration 3→4 + Converters 扩展
- T2 元数据解析器：ScriptMetadataParser
- T3 GM_* API 桥接：GmApiBridge（v3 修复 F2：7 个 API，含 GM_xhrAbort）+ onJsPrompt 桥接协议
- T4 脚本注入器：ScriptInjector + 集成到 LivingWebViewClient / LivingWebChromeClient / LivingWebView
- T5 AI 工具扩展：4 个 userscript 工具（完整代码见 2.5）
- T6 UI：ScriptListScreen + ScriptEditScreen + 导入流程 + Settings 入口 + NavGraph
- T7 单元测试
- T8 构建 Release APK + 运行时验证

**本 Phase 跳过（依赖 M5）**：
- 脚本多端服务器同步：本地 Room 持久化 + 预留 `versionCode` 字段供 M5 接入乐观锁。

**本 Phase 不做**：
- `@require` / `@resource` / `GM_registerMenuCommand` / `GM_getResourceText` / 脚本市场

### 1.4 硬约束
- Kotlin + Compose，包体 < 20MB
- gradle `F:\allmylife\gradle-8.2-bin`，java `D:\Java`，Android SDK `F:\Android SDK`
- 不下载到 C 盘
- 真机/模拟器若不可用，用 Robolectric 验证纯逻辑 + Release APK 编译验证；GM_* 桥接端到端验证需真机，无真机则标记为已知遗留（与 M3/M8 一致）

---

## 二、技术方案

### 2.1 数据模型

#### 2.1.1 UserScriptEntity

```kotlin
@Entity(
    tableName = "userscripts",
    indices = [Index("enabled"), Index("updated_at")]
)
data class UserScriptEntity(
    @PrimaryKey val id: String,           // UUID
    val name: String,
    val namespace: String,
    val version: String,
    val description: String,
    val author: String,
    val matches: List<String>,             // 由 Converters.stringListToString 转换
    val includes: List<String>,
    val excludes: List<String>,
    val grants: List<String>,
    val runAt: String,                     // document-start | document-end | document-idle
    val code: String,
    val rawMetadata: String,
    val enabled: Boolean,
    val source: String,                    // import | ai | manual
    val createdAt: Long,
    val updatedAt: Long,
    val versionCode: Int                   // M5 乐观锁预留
)
```

**Entity 注解生成的期望 DDL**（用于校验 Migration SQL 一致性）：
```sql
CREATE TABLE IF NOT EXISTS `userscripts` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `name` TEXT NOT NULL,
    `namespace` TEXT NOT NULL,
    `version` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `author` TEXT NOT NULL,
    `matches` TEXT NOT NULL,
    `includes` TEXT NOT NULL,
    `excludes` TEXT NOT NULL,
    `grants` TEXT NOT NULL,
    `run_at` TEXT NOT NULL,
    `code` TEXT NOT NULL,
    `raw_metadata` TEXT NOT NULL,
    `enabled` INTEGER NOT NULL,
    `source` TEXT NOT NULL,
    `created_at` INTEGER NOT NULL,
    `updated_at` INTEGER NOT NULL,
    `version_code` INTEGER NOT NULL
)
```
（v3 修复 F1：删除所有 DEFAULT 子句。Room 2.4+ 的 schema 校验会比对 `TableInfo` 的 `defaultValue`，Entity 字段无 `@ColumnDefault` 注解时期望 `defaultValue = null`，若 Migration SQL 含 DEFAULT 会触发 `IllegalStateException: Migration didn't properly handle: userscripts`，由于 DatabaseModule 启用了 `fallbackToDestructiveMigration()` 会直接 DROP 整库重建，丢失 tabs/bookmarks/history/panels/widgets/ai_conversations 全部数据。Migration SQL 风格与 MIGRATION_2_3 一致，无 DEFAULT。）

#### 2.1.2 Room Migration 3→4

```kotlin
val MIGRATION_3_4: Migration = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // v3 修复 F1：删除所有 DEFAULT 子句，避免 Room schema 校验失败触发 fallbackToDestructiveMigration
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS `userscripts` (
                `id` TEXT NOT NULL PRIMARY KEY,
                `name` TEXT NOT NULL,
                `namespace` TEXT NOT NULL,
                `version` TEXT NOT NULL,
                `description` TEXT NOT NULL,
                `author` TEXT NOT NULL,
                `matches` TEXT NOT NULL,
                `includes` TEXT NOT NULL,
                `excludes` TEXT NOT NULL,
                `grants` TEXT NOT NULL,
                `run_at` TEXT NOT NULL,
                `code` TEXT NOT NULL,
                `raw_metadata` TEXT NOT NULL,
                `enabled` INTEGER NOT NULL,
                `source` TEXT NOT NULL,
                `created_at` INTEGER NOT NULL,
                `updated_at` INTEGER NOT NULL,
                `version_code` INTEGER NOT NULL
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_userscripts_enabled` ON `userscripts` (`enabled`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_userscripts_updated_at` ON `userscripts` (`updated_at`)")
    }
}
```

#### 2.1.3 Converters 扩展（必须新增）

当前 `Converters.kt` 仅有 PanelType/WidgetType 转换器。**必须新增** stringList 转换器：

```kotlin
@TypeConverter
fun stringListFromString(value: String?): List<String> =
    if (value.isNullOrEmpty()) emptyList()
    else value.split("\n").filter { it.isNotEmpty() }

@TypeConverter
fun stringListToString(list: List<String>?): String =
    (list ?: emptyList()).joinToString("\n")
```

用换行分隔而非 JSON：油猴元数据值不会含 `\n`；解析开销小。

### 2.2 元数据解析器 ScriptMetadataParser

#### 2.2.1 数据类

```kotlin
data class ScriptMetadata(
    val name: String = "Unnamed",
    val namespace: String = "",
    val version: String = "1.0",
    val description: String = "",
    val author: String = "",
    val matches: List<String> = emptyList(),
    val includes: List<String> = emptyList(),
    val excludes: List<String> = emptyList(),
    val grants: List<String> = emptyList(),
    val runAt: String = "document-end",
)

data class ParsedScript(
    val rawMetadata: String,
    val metadata: ScriptMetadata,
    val code: String,
)
```

#### 2.2.2 解析算法

1. 正则 `(?s)//\s*==UserScript==\s*\n(.*?)//\s*==/UserScript==` 匹配元数据块（要求 `==UserScript==` 后无其他字符，行尾锚定）
2. 块内逐行扫描 `// @key value`，key 转小写
3. 多值 key（@match/@include/@exclude/@grant）累加到 List
4. `@run-at` 校验枚举值（document-start/document-end/document-idle），非法值回退 `document-end`
5. `code` = 原文去掉元数据块后的部分（trim 前后空行）
6. 无元数据块：`metadata` 全默认值，`code` = 原文，`rawMetadata` = ""

容错：重复 @key 单值取最后、多值全累加；@key 拼写错误忽略；value 含 `//` 时从 `// @key` 后第一个空格到行尾整段作为 value。

#### 2.2.3 Kotlin 实现（v3 修复 L2）

> v3 修复 L2：补充 ScriptMetadataParser 的 Kotlin 函数签名 + 正则常量 + 解析逻辑。

```kotlin
object ScriptMetadataParser {
    // 正则常量：匹配 ==UserScript== ... ==/UserScript== 块
    // (?s) 开启 DOTALL；要求 ==UserScript== 后无其他字符（行尾锚定），==/UserScript== 同理
    private val METADATA_BLOCK_REGEX = Regex(
        """(?s)//\s*==UserScript==\s*\n(.*?)//\s*==/UserScript=="""
    )
    // 行内 @key value 解析：// @key value（key 转小写；value 从 @key 后第一个空格到行尾）
    private val KEY_VALUE_REGEX = Regex("""^\s*//\s*@(\S+)\s*(.*)$""")

    // 多值 key 集合（每个 @match/@include/@exclude/@grant 都累加）
    private val MULTI_VALUE_KEYS = setOf("match", "include", "exclude", "grant")

    // @run-at 合法值
    private val VALID_RUN_AT = setOf("document-start", "document-end", "document-idle")

    /**
     * 解析脚本源码，提取元数据与代码正文。
     * @param source 完整的 .user.js 源码
     * @return ParsedScript（无元数据块时返回默认值）
     */
    fun parse(source: String): ParsedScript {
        val match = METADATA_BLOCK_REGEX.find(source) ?: return ParsedScript(
            rawMetadata = "",
            metadata = ScriptMetadata(),
            code = source.trim(),
        )

        val rawMetadata = match.value
        val block = match.groupValues[1]
        val code = source.removeRange(match.range).trim()

        // 解析块内每行 @key value
        val singles = mutableMapOf<String, String>()
        val multis = mutableMapOf<String, MutableList<String>>()

        block.lineSequence().forEach { line ->
            val kv = KEY_VALUE_REGEX.find(line) ?: return@forEach
            val key = kv.groupValues[1].lowercase()
            val value = kv.groupValues[2].trim()
            if (key.isEmpty()) return@forEach

            if (key in MULTI_VALUE_KEYS) {
                multis.getOrPut(key) { mutableListOf() }.add(value)
            } else {
                singles[key] = value  // 单值 key 重复时取最后
            }
        }

        val runAt = singles["run-at"]?.let { if (it in VALID_RUN_AT) it else "document-end" } ?: "document-end"

        val metadata = ScriptMetadata(
            name = singles["name"] ?: "Unnamed",
            namespace = singles["namespace"] ?: "",
            version = singles["version"] ?: "1.0",
            description = singles["description"] ?: "",
            author = singles["author"] ?: "",
            matches = multis["match"] ?: emptyList(),
            includes = multis["include"] ?: emptyList(),
            excludes = multis["exclude"] ?: emptyList(),
            grants = multis["grant"] ?: emptyList(),
            runAt = runAt,
        )
        return ParsedScript(rawMetadata = rawMetadata, metadata = metadata, code = code)
    }

    /**
     * v3 修复 M4：用表单元数据重写代码中的 ==UserScript== 块（表单字段为 source of truth）。
     * 保持代码正文不变，仅同步元数据块。
     */
    fun rewriteMetadata(code: String, metadata: ScriptMetadata): String {
        val body = METADATA_BLOCK_REGEX.find(code)?.let { code.removeRange(it.range).trim() } ?: code.trim()
        val sb = StringBuilder()
        sb.append("// ==UserScript==\n")
        sb.append("// @name ${metadata.name}\n")
        if (metadata.namespace.isNotEmpty()) sb.append("// @namespace ${metadata.namespace}\n")
        sb.append("// @version ${metadata.version}\n")
        if (metadata.description.isNotEmpty()) sb.append("// @description ${metadata.description}\n")
        if (metadata.author.isNotEmpty()) sb.append("// @author ${metadata.author}\n")
        metadata.matches.forEach { sb.append("// @match $it\n") }
        metadata.includes.forEach { sb.append("// @include $it\n") }
        metadata.excludes.forEach { sb.append("// @exclude $it\n") }
        metadata.grants.forEach { sb.append("// @grant $it\n") }
        sb.append("// @run-at ${metadata.runAt}\n")
        sb.append("// ==/UserScript==\n\n")
        sb.append(body)
        return sb.toString()
    }
}
```

### 2.3 GM_* API 桥接（onJsPrompt 协议）

#### 2.3.1 桥接策略（v2 修订：用 onJsPrompt 替代 console.log）

**不使用 `addJavascriptInterface`**（安全风险）。
**不使用 `console.log`**（Chromium 对 ConsoleMessage.message 有长度截断，GM_xmlhttpRequest details 含 headers/data 易超 1KB）。

**改用 `onJsPrompt` 桥接**：
- JS 侧调用 `prompt('__GM_CALL__|' + JSON.stringify({api, args, callbackId}))`
- Kotlin 侧 `LivingWebChromeClient.onJsPrompt` 拦截 `__GM_CALL__|` 前缀，分发到 `GmApiBridge.handleCall`
- `onJsPrompt` 是同步调用：JS 调 `prompt()` 时 WebView 线程阻塞，Kotlin 在 `onJsPrompt` 中可同步返回结果（用 `JsPromptResult.confirm(resultJson)`）
- 异步 API（GM_xmlhttpRequest / GM_notification）：`onJsPrompt` 立即 `confirm("{}")` 返回 callbackId，Kotlin 异步处理后用 `webView.evaluateJavascript("window.__gmCbSuccess('$cbId', $resultJson)", null)` 回调

**优点**：
- 无长度截断（prompt message 无大小限制）
- 同步 API（GM_addStyle/GM_setValue/GM_getValue/GM_setClipboard）可在 `onJsPrompt` 内直接处理并 confirm 结果
- 无 `addJavascriptInterface` 安全风险（不暴露 Java 对象）
- 网页恶意 JS 调 `prompt('__GM_CALL__|...')` 也会被拦截，但**安全约束**：Kotlin 侧校验调用源（`ConsoleMessage.sourceId` 或仅信任特定 URL/行号范围）；M4 阶段简化为"前缀匹配 + 参数 schema 校验"（v3 修复 M7：必填字段 `api`(String) / `args`(JsonObject)，缺失或类型不符时 `result.cancel()` 返回 false）；残留风险记录文档

#### 2.3.2 7 个 API 实现

> v3 修复 F2：将标题从"6 个 API"改为"7 个 API"（新增 `GM_xhrAbort` 同步分支）。
> v3 修复 F3：`GM_addStyle` Kotlin 侧只 `confirm("{}")`，不调用 `evaluateJavascript`（JS 侧已处理样式注入，避免 `<style>` 双重注入）。

| API | 类型 | Kotlin 实现 |
|-----|------|------|
| `GM_addStyle(css)` | 同步 | （v3 修复 F3）Kotlin 侧只 `result.confirm("{}")`，**不**调用 `evaluateJavascript`——`<style>` 注入由 JS 侧 `gm_api_init.js` 完成（L910-L917），避免双重注入 |
| `GM_setValue(key, value)` | 同步 | `kvStorage.memoryCache[key] = String(value)`（同步）+ `coroutineScope.launch(Dispatchers.IO) { kvStorage.write(key, String(value)) }`（异步落盘）；`result.confirm("{}")` |
| `GM_getValue(key, default?)` | 同步 | （v3 修复 B2：JS 侧已补发 `default` 字段，`args["default"]` 链路完整；原 v3 JS 只发 `key`，`defaultV` 永远为 null，key 缺失时返回 `""` 而非 defaultValue）`val v = kvStorage.readSync(key) ?: args["default"]?.jsonPrimitive?.contentOrNull ?: ""`；`result.confirm("""{"value":"${v.replace("\\","\\\\").replace("\"","\\\"")}"}""")`（v3 修复 L1：值强制转 String，数字/布尔/对象类型丢失，需用户脚本自行 `JSON.stringify`） |
| `GM_setClipboard(text)` | 同步 | `val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager; cm.setPrimaryClip(ClipData.newPlainText("gm", text))`；`result.confirm("{}")` |
| `GM_notification(details)` | 异步 | （v3 修复 S6/S7）见 2.3.6 节 NotificationChannel + 权限降级 |
| `GM_xmlhttpRequest(details)` | 异步 | `coroutineScope.launch { handleXhr(cbId, details) }`；`result.confirm("""{"cbId":"$cbId"}""")` |
| `GM_xhrAbort(id)` | 同步 | （v3 修复 F2 新增）`val xhrId = call.args["id"]?.jsonPrimitive?.contentOrNull; if (xhrId != null) cancelXhr(xhrId); result.confirm("{}")` |

#### 2.3.3 GmApiBridge 类设计

> v3 修复 M5：展开 4 个同步 API 关键实现（不再用 `{ ... }` 省略）。
> v3 修复 M7：handlePrompt 加 try-catch + 参数 schema 校验。
> v3 修复 F2：增加 `GM_xhrAbort` 分支 + `cancelXhr` 私有方法。
> v3 修复 L3：jsonString 辅助函数定义为 `Json.encodeToString(String.serializer(), css)`（GmApiBridge 内私有函数）。
> v3 修复 S7：init 块创建 NotificationChannel。

```kotlin
class GmApiBridge(
    private val kvStorage: KvStorage,
    private val okHttpClient: OkHttpClient,
    private val context: Context,
    private val coroutineScope: CoroutineScope,  // @ApplicationScope
    private val webviewHolder: ActiveWebViewHolder,  // 拿当前 WebView 做异步回调
) {
    // v3 修复 S7：NotificationChannel（API 26+ 必需）
    private val channelId = "gm_notification"
    private val notifMgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "GM Notification", NotificationManager.IMPORTANCE_DEFAULT)
            notifMgr.createNotificationChannel(channel)
        }
    }

    // v3 修复 F2：跟踪进行中的 XHR 请求，用于 abort
    private val pendingXhrs = ConcurrentHashMap<String, Call>()

    /** v3 修复 L3：JSON 字符串字面量编码（用于 evaluateJavascript 参数） */
    private fun jsonString(s: String): String = Json.encodeToString(String.serializer(), s)

    /**
     * onJsPrompt 入口：解析 message，分发到对应 API。
     * @return true 表示已处理（调用 JsPromptResult.confirm/cancel）；false 表示非 GM 调用，让默认 onJsPrompt 处理
     */
    fun handlePrompt(message: String, result: JsPromptResult): Boolean {
        if (!message.startsWith("__GM_CALL__|")) return false
        // v3 修复 M7：try-catch 包裹，解析失败或 schema 校验失败时 result.cancel() 返回 false
        try {
            val json = message.removePrefix("__GM_CALL__|")
            val call = Json.decodeFromString(GmCall.serializer(), json)
            // v3 修复 M7：参数 schema 校验（api 必填 String 已由 @Serializable 保证；args 必填 JsonObject）
            if (call.api.isEmpty()) { result.cancel(); return false }
            when (call.api) {
                // v3 修复 F3：GM_addStyle 只 confirm "{}"，不调 evaluateJavascript（JS 侧已注入 <style>）
                "GM_addStyle" -> {
                    result.confirm("{}")
                }
                "GM_setValue" -> {
                    val key = call.args["key"]?.jsonPrimitive?.contentOrNull ?: ""
                    val value = call.args["value"]?.jsonPrimitive?.contentOrNull ?: ""
                    kvStorage.writeSync(key, value)  // 写内存缓存
                    coroutineScope.launch(Dispatchers.IO) { kvStorage.write(key, value) }  // 异步落盘
                    result.confirm("{}")
                }
                // v3 修复 B2：确认 args["default"] 链路完整（JS 侧已补发 default 字段，defaultV 不再永远为 null）
                "GM_getValue" -> {
                    val key = call.args["key"]?.jsonPrimitive?.contentOrNull ?: ""
                    val defaultV = call.args["default"]?.jsonPrimitive?.contentOrNull
                    val v = kvStorage.readSync(key) ?: defaultV ?: ""
                    result.confirm("""{"value":"${v.replace("\\","\\\\").replace("\"","\\\"")}"}""")
                }
                "GM_setClipboard" -> {
                    val text = call.args["text"]?.jsonPrimitive?.contentOrNull ?: ""
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("gm", text))
                    result.confirm("{}")
                }
                "GM_notification" -> {
                    val cbId = call.cbId
                    coroutineScope.launch { handleNotification(cbId, call.args) }
                    result.confirm("""{"cbId":"${cbId ?: ""}"}""")
                }
                "GM_xmlhttpRequest" -> {
                    val cbId = call.cbId ?: run { result.confirm("{}"); return true }
                    coroutineScope.launch { handleXhr(cbId, call.args) }
                    result.confirm("""{"cbId":"$cbId"}""")
                }
                // v3 修复 F2：GM_xhrAbort 分支，避免 JsPromptResult 未 confirm 导致 WebView 挂起
                "GM_xhrAbort" -> {
                    val xhrId = call.args["id"]?.jsonPrimitive?.contentOrNull
                    if (xhrId != null) cancelXhr(xhrId)
                    result.confirm("{}")
                }
                else -> {
                    // 未知 API 兜底（防止恶意 JS 探测分支；confirm 空 JSON 不挂起 WebView）
                    result.confirm("{}")
                }
            }
            return true
        } catch (e: Exception) {
            // v3 修复 M7：JSON 解析失败/字段缺失 → cancel + 返回 false（让默认 prompt 处理）
            result.cancel()
            return false
        }
    }

    private suspend fun handleXhr(cbId: String, details: JsonObject) {
        val url = details["url"]?.jsonPrimitive?.contentOrNull ?: return
        // 安全约束：仅 http/https
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            callbackError(cbId, "only http/https allowed")
            return
        }
        try {
            val request = buildXhrRequest(details)
            val call = okHttpClient.newCall(request)
            // v3 修复 F2：将 Call 注册到 pendingXhrs，供 GM_xhrAbort 取消
            pendingXhrs[cbId] = call
            call.execute().use { resp ->
                val text = resp.body?.string()?.take(1_000_000) ?: ""  // ≤1MB
                val payload = buildJsonObject {
                    put("status", resp.code)
                    put("responseText", text)
                    put("finalUrl", resp.request.url.toString())
                }
                callbackSuccess(cbId, payload)
            }
        } catch (e: Exception) {
            callbackError(cbId, e.message ?: "xhr failed")
        } finally {
            pendingXhrs.remove(cbId)
        }
    }

    /** v3 修复 F2：取消进行中的 XHR（从 pendingXhrs 移除并 call.cancel()） */
    private fun cancelXhr(xhrId: String) {
        pendingXhrs.remove(xhrId)?.cancel()
    }

    private fun callbackSuccess(cbId: String, payload: JsonObject) {
        webviewHolder.value.value?.evaluateJavascript(
            "window.__gmCbSuccess && __gmCbSuccess('$cbId', ${Json.encodeToString(JsonObject.serializer(), payload)})",
            null
        )
    }

    private fun callbackError(cbId: String, msg: String) {
        webviewHolder.value.value?.evaluateJavascript(
            "window.__gmCbError && __gmCbError('$cbId', ${jsonString(msg)})",
            null
        )
    }
}
```

#### 2.3.4 GM_xmlhttpRequest 安全约束

- 仅允许 http/https scheme（拦截 file/content/ftp）
- 超时 30s（OkHttp call.timeout()）
- 响应体 ≤ 1MB（`take(1_000_000)`）
- 无 CORS 限制（GM_xhr 核心价值）
- SSRF 防护：M4 不做白名单（记录为已知风险，M7 补）

#### 2.3.5 GM_setValue/GM_getValue 同步问题

`KvStorage` 基于 DataStore（异步）。但 `GM_getValue` 必须同步返回。

**解决方案**：
- `KvStorage` 内部维护 `ConcurrentHashMap<String, String>` 内存缓存
- 启动时 `preload()` 预加载所有 KV 到内存（v3 修复 S1：在 `LivingDashboardApp.onCreate` 的 `appScope.launch { ... }` 中异步调用，不阻塞主线程；与 2.7.3 节描述一致，不再使用 `runBlocking`）
- `GM_getValue` 读内存缓存（同步）
- `GM_setValue` 写内存缓存（同步） + 异步落 DataStore
- preload 完成前 GM_getValue 返回 defaultValue（油猴规范允许）

#### 2.3.6 GM_notification 详细实现（v3 修复 S6 + S7）

> v3 修复 S6：Android 13+ 需要 `POST_NOTIFICATIONS` 运行时权限，AndroidManifest.xml 必须声明；权限拒绝时降级为 Toast 兜底。
> v3 修复 S7：Android 8.0+ 必须创建 `NotificationChannel`，否则 `NotificationManager.notify(...)` 静默失败。

**AndroidManifest.xml 改造**（修改文件清单新增）：
```xml
<!-- v3 修复 S6：GM_notification 必需 -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- v3 修复 N2：注册 GmNotificationReceiver 接收通知点击广播（PendingIntent.getBroadcast 用 action com.livingdashboard.GM_NOTIF_CLICK） -->
<receiver
    android:name=".script.GmNotificationReceiver"
    android:exported="false">
    <intent-filter>
        <action android:name="com.livingdashboard.GM_NOTIF_CLICK" />
    </intent-filter>
</receiver>
```

**handleNotification 实现**：
```kotlin
private suspend fun handleNotification(cbId: String?, details: JsonObject) {
    val title = details["title"]?.jsonPrimitive?.contentOrNull ?: ""
    val text = details["text"]?.jsonPrimitive?.contentOrNull ?: ""
    // v3 修复 N1：删除 onclick 字段读取（JSON.stringify 静默丢弃函数属性，永远为 null，死代码）
    // onclick 通过 cbId 路由：JS 侧 callbacks[cbId].onclick 已在 gmCall 异步分支注册，
    //   Kotlin 侧通过 PendingIntent → GmNotificationReceiver →
    //   evaluateJavascript("__gmNotificationOnClick('$cbId')") 触发。
    //   如需更细粒度回调隔离，可演化为 __gmNotificationOnClick_<cbId> 单独 callback 注册（与 v2 设计一致）。

    // v3 修复 S6：检查 POST_NOTIFICATIONS 权限（API 33+）
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            // v3 修复 S6：降级为 Toast 兜底（不崩溃，用户可见）
            Handler(Looper.getMainLooper()).post {
                Toast.makeText(context, "$title: $text", Toast.LENGTH_LONG).show()
            }
            return
        }
    }

    // v3 修复 S7：使用 init 块创建的 channelId
    val builder = NotificationCompat.Builder(context, channelId)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(text)
        .setAutoCancel(true)

    // 点击事件：通过 PendingIntent 路由回 GmApiBridge 触发 __gmNotificationOnClick
    if (cbId != null) {
        val intent = Intent("com.livingdashboard.GM_NOTIF_CLICK").putExtra("cbId", cbId)
        val pi = PendingIntent.getBroadcast(
            context, cbId.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        builder.setContentIntent(pi)
    }

    notifMgr.notify(System.currentTimeMillis().toInt(), builder.build())
}
```

**点击回调路由**：通过 `BroadcastReceiver` 监听 `com.livingdashboard.GM_NOTIF_CLICK` Action，收到后调 `gmApiBridge.callbackNotificationOnClick(cbId)` → `evaluateJavascript("__gmNotificationOnClick('$cbId')")`。

#### 2.3.7 GmCall 数据类定义（v3 修复 M1）

> v3 修复 M1：明确 `GmCall` 数据类结构，新增文件 `script/GmCall.kt`。

```kotlin
@Serializable
data class GmCall(
    val api: String,           // GM_addStyle / GM_setValue / GM_getValue / GM_setClipboard / GM_notification / GM_xmlhttpRequest / GM_xhrAbort
    val args: JsonObject,      // 各 API 的参数对象（key/value/text/details/url/id 等）
    val cbId: String? = null,  // 异步 API 的回调 ID（同步 API 为 null）
)
```

字段说明：
- `api`：API 名称（必填 String）
- `args`：参数对象（必填 JsonObject，kotlinx.serialization.json.JsonObject）
- `cbId`：回调 ID（可空，仅异步 API `GM_xmlhttpRequest` / `GM_notification` 携带）

#### 2.3.8 ProGuard/R8 keep 规则（v3 修复 L4）

> v3 修复 L4：无需手动添加 ProGuard 规则。kotlinx-serialization 编译器插件会自动为 `@Serializable` 类（GmCall、UserScriptEntity、ScriptMetadata 等）生成 keep 规则；Room 编译器自动为 Entity 生成 keep 规则。R8 `isMinifyEnabled = true` 不会裁剪这些类。

### 2.4 脚本注入器 ScriptInjector

#### 2.4.1 注入流程

```
WebView.onPageStarted(url) 触发：
  1. 从 UserScriptRepository.snapshot() 同步读 enabled=true 的脚本（Repository 内部维护内存缓存）
  2. 对每个脚本用 UrlMatcher 匹配 url
  3. 按 runAt 分组注入：
     - document-start：onPageStarted 时立即注入
     - document-end：onPageFinished 时注入
     - document-idle：onPageFinished 后 view.postDelayed(100ms) 注入
  4. 注入顺序：
     a. gm_api_init.js（assets 读取，首次缓存）
     b. 脚本正文（IIFE 包裹）
  5. 注入方式：webView.evaluateJavascript(script, null)
```

#### 2.4.2 UrlMatcher（host/path 分段处理）

油猴 `@match` 规则：scheme://host/path 三段。

```kotlin
object UrlMatcher {
    /**
     * @match 模式匹配（油猴规范）。
     * - scheme: * → (http|https)
     * - host: *.example.com → [^/.]*\.example\.com（v3 修复 S4：* 不跨 / 也不跨 .，与注释一致）
     * - path: * → .*（任意字符）；其他正则元字符先 escape 再恢复 *（v3 修复 S5）
     */
    fun matches(pattern: String, url: String): Boolean {
        try {
            val regex = patternToRegex(pattern)
            return regex.matches(url)
        } catch (e: Exception) { return false }
    }

    private fun patternToRegex(pattern: String): Regex {
        // 解析 scheme://host/path
        val schemeEnd = pattern.indexOf("://")
        if (schemeEnd < 0) return Regex(Regex.escape(pattern))
        val scheme = pattern.substring(0, schemeEnd)
        val rest = pattern.substring(schemeEnd + 3)
        val slashIdx = rest.indexOf('/')
        val host = if (slashIdx < 0) rest else rest.substring(0, slashIdx)
        val path = if (slashIdx < 0) "" else rest.substring(slashIdx)

        val schemeRegex = if (scheme == "*") "(http|https)" else Regex.escape(scheme)
        // v3 修复 S4：host 段 * 替换为 [^/.]*（不跨 / 也不跨 .），与注释一致；先 escape . 再处理 *
        val hostRegex = Regex.escape(host).replace("\\*", "[^/.]*")
        // v3 修复 S5：path 段先 escape 所有正则元字符，再把 \* 恢复为 .*（Tampermonkey 规范 path 段只有 * 是通配符）
        val pathRegex = Regex.escape(path).replace("\\*", ".*")

        return Regex("^$schemeRegex://$hostRegex$pathRegex$")
    }

    /** @include 更宽松（支持正则），@exclude 同 @match 语义 */
    fun includes(pattern: String, url: String): Boolean {
        return try { Regex(pattern).containsMatchIn(url) } catch (e: Exception) { matches(pattern, url) }
    }
}
```

匹配规则：
- matches 任一匹配 → 通过
- excludes 任一匹配 → 拒绝
- includes 兜底（若 matches 为空，includes 任一匹配 → 通过）

#### 2.4.3 RunAt 枚举

```kotlin
enum class RunAt(val value: String) {
    DOCUMENT_START("document-start"),
    DOCUMENT_END("document-end"),
    DOCUMENT_IDLE("document-idle");
    companion object {
        fun fromString(s: String): RunAt = entries.firstOrNull { it.value == s } ?: DOCUMENT_END
    }
}
```

#### 2.4.4 LivingWebViewClient 改造

```kotlin
class LivingWebViewClient(
    private val onUrlChange: (String) -> Unit,
    private val onBackForwardStateChange: (Boolean, Boolean) -> Unit,
    private val onPageFinished: (String, String) -> Unit,
    private val onError: (String) -> Unit,
    private val scriptInjector: ScriptInjector? = null,  // M4 新增，可选，默认 null 不破坏现有调用
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        // v3 修复 M8：拦截 .user.js 后缀 URL（导入方式 C），交给 ScriptInjector 处理（下载→解析→弹 Dialog）
        if (url.endsWith(".user.js")) {
            scriptInjector?.onUserScriptUrlDetected(url)
            return true  // 拦截下载
        }
        return super.shouldOverrideUrlLoading(view, request)
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        onUrlChange(url)
        onBackForwardStateChange(view.canGoBack(), view.canGoForward())
        scriptInjector?.injectForUrl(view, url, RunAt.DOCUMENT_START)
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        val title = view.title ?: ""
        onPageFinished(url, title)
        onBackForwardStateChange(view.canGoBack(), view.canGoForward())
        scriptInjector?.injectForUrl(view, url, RunAt.DOCUMENT_END)
        view.postDelayed({ scriptInjector?.injectForUrl(view, url, RunAt.DOCUMENT_IDLE) }, 100L)
    }
}
```

> v3 修复 M8：`shouldOverrideUrlLoading` 增加 `.user.js` 后缀检测分支，调用 `scriptInjector.onUserScriptUrlDetected(url)` 触发导入流程（方式 C）。ScriptInjector 需新增 `fun onUserScriptUrlDetected(url: String)` 方法（OkHttp 下载 → ScriptMetadataParser 解析 → 通过 `webviewHolder` 路由 ScriptImportDialog 显示）。

#### 2.4.5 LivingWebChromeClient 改造（完整代码）

```kotlin
class LivingWebChromeClient(
    private val onProgressChange: (Int) -> Unit,
    private val onTitleChange: (String) -> Unit,
    private val onFaviconChange: (Bitmap?) -> Unit,
    private val gmApiBridge: GmApiBridge? = null,  // M4 新增，可选
) : WebChromeClient() {

    // ===== 现有方法保持不变（onProgressChanged/onReceivedTitle/onReceivedIcon/onShowFileChooser/onJsAlert/onJsConfirm/onPermissionRequest）=====

    /**
     * M4 新增：拦截 GM_* API 调用（onJsPrompt 桥接）。
     *
     * - message 以 "__GM_CALL__|" 开头 → 分发到 gmApiBridge，confirm 结果
     * - 其他 prompt → 走默认行为（返回 false）
     *
     * 同步 API（GM_addStyle/GM_setValue/GM_getValue/GM_setClipboard）在 confirm 中直接返回结果。
     * 异步 API（GM_xmlhttpRequest/GM_notification）confirm 立即返回 cbId，结果后续 evaluateJavascript 回调。
     */
    override fun onJsPrompt(
        view: WebView?, url: String?, message: String?, defaultValue: String?,
        result: JsPromptResult?
    ): Boolean {
        if (message != null && message.startsWith("__GM_CALL__|") && gmApiBridge != null && result != null) {
            return gmApiBridge.handlePrompt(message, result)
        }
        return false  // 走默认行为
    }
}
```

#### 2.4.6 LivingWebView Composable 改造

```kotlin
@Composable
fun LivingWebView(
    url: String,
    uaMode: UaMode = UaMode.MOBILE,
    javaScriptEnabled: Boolean = true,
    onUrlChange: (String) -> Unit,
    onTitleChange: (String) -> Unit,
    onProgressChange: (Int) -> Unit,
    onBackForwardStateChange: (canGoBack: Boolean, canGoForward: Boolean) -> Unit,
    onFaviconChange: (Bitmap?) -> Unit = {},
    onError: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    controller: WebViewController? = null,
    activeWebViewHolder: ActiveWebViewHolder? = null,
    scriptInjector: ScriptInjector? = null,  // M4 新增
    gmApiBridge: GmApiBridge? = null,        // M4 新增
) {
    // ...
    val webView = remember {
        WebView(context.applicationContext).apply {
            // ... 现有 settings ...
            webViewClient = LivingWebViewClient(
                onUrlChange = { currentOnUrlChange(it) },
                onBackForwardStateChange = { b, f -> currentOnBackForwardStateChange(b, f) },
                onPageFinished = { _, t -> currentOnTitleChange(t) },
                onError = { currentOnError(it) },
                scriptInjector = scriptInjector,  // M4 透传
            )
            webChromeClient = LivingWebChromeClient(
                onProgressChange = { currentOnProgressChange(it) },
                onTitleChange = { currentOnTitleChange(it) },
                onFaviconChange = { currentOnFaviconChange(it) },
                gmApiBridge = gmApiBridge,  // M4 透传
            )
            // ... 现有 download listener / controller / holder ...
        }
    }
    // ... 现有 DisposableEffect + AndroidView ...
}
```

#### 2.4.7 BrowserScreen / WebviewWidget 注入路径

**BrowserScreen**：
- （v3 修复 M2）`BrowserViewModel` 用 Hilt `@Inject constructor` 注入，新增两个 `val` 属性（直接属性，不暴露 StateFlow）：
  ```kotlin
  @HiltViewModel
  class BrowserViewModel @Inject constructor(
      // ... 现有 13 个参数 ...  // v3 修复 N4：11→13（核对 BrowserViewModel.kt:93-108 实际 13 个参数：tabRepository/historyRepository/bookmarkRepository/settingsStore/cookieManager/savedStateHandle/activeWebViewHolder/localAgentService/cloudAgentService/runtimeModeManager/askUserDialogState/activePanelIdHolder/aiConversationRepository）
      val scriptInjector: ScriptInjector,  // v3 修复 M2：@Singleton 直接 val 属性
      val gmApiBridge: GmApiBridge,
  ) : ViewModel()
  ```
- BrowserScreen 调 `LivingWebView(..., scriptInjector = viewModel.scriptInjector, gmApiBridge = viewModel.gmApiBridge, activeWebViewHolder = viewModel.activeWebViewHolder)`
- `activeWebViewHolder` 已由 BrowserViewModel 现有依赖持有，需在 `LivingWebView` 调用中一并透传（v3 修复 S8）

**WebviewWidget**（不在 ViewModel 体系内）：
- 用 `LocalContext` + `EntryPointAccessors.fromApplication(context.applicationContext, ScriptInjectorEntryPoint::class.java)` 获取（v3 修复 M3：用 `EntryPointAccessors.fromApplication` 替代 `EntryPoints.get`，避免 Activity context 在某些 Hilt 版本下抛 `IllegalStateException`）
- 同理获取 `GmApiBridge` 和 `ActiveWebViewHolder`（v3 修复 S8：必须传 `activeWebViewHolder`，否则 GM 异步回调路由到错误 WebView）
- 传给 `LivingWebView`

```kotlin
// 在 WebviewWidget.kt 内
@Composable
private fun rememberScriptDeps(): Triple<ScriptInjector?, GmApiBridge?, ActiveWebViewHolder?> {
    val context = LocalContext.current
    // v3 修复 M3：用 EntryPointAccessors.fromApplication 获取 SingletonComponent EntryPoint
    val entryPoint = remember(context) {
        EntryPointAccessors.fromApplication(
            context.applicationContext,
            ScriptInjectorEntryPoint::class.java
        )
    }
    return Triple(entryPoint.scriptInjector(), entryPoint.gmApiBridge(), entryPoint.activeWebViewHolder())
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface ScriptInjectorEntryPoint {
    fun scriptInjector(): ScriptInjector
    fun gmApiBridge(): GmApiBridge
    fun activeWebViewHolder(): ActiveWebViewHolder  // v3 修复 S8：补传 holder
}
```

调用处（v3 修复 S8）：
```kotlin
val (scriptInjector, gmApiBridge, activeWebViewHolder) = rememberScriptDeps()
LivingWebView(
    url = url,
    // ... 其他参数 ...
    scriptInjector = scriptInjector,
    gmApiBridge = gmApiBridge,
    activeWebViewHolder = activeWebViewHolder,  // v3 修复 S8：必须传，否则 GM 异步回调路由到错误 WebView
)
```

### 2.5 AI 工具扩展（4 个完整代码）

#### 2.5.1 UserScriptRepository API

```kotlin
class UserScriptRepository(private val dao: UserScriptDao) {
    private val cache = ConcurrentHashMap<String, UserScriptEntity>()

    suspend fun insert(entity: UserScriptEntity) {
        dao.insert(entity)
        cache[entity.id] = entity
    }
    suspend fun update(entity: UserScriptEntity) {
        val updated = entity.copy(updatedAt = System.currentTimeMillis(), versionCode = entity.versionCode + 1)
        dao.update(updated)
        cache[updated.id] = updated
    }
    suspend fun delete(id: String) {
        dao.deleteById(id)
        cache.remove(id)
    }
    suspend fun getById(id: String): UserScriptEntity? = cache[id] ?: dao.findById(id)?.also { cache[id] = it }
    fun observeAll(): Flow<List<UserScriptEntity>> = dao.observeAll()
    fun observeEnabled(): Flow<List<UserScriptEntity>> = dao.observeEnabled()
    /** 同步快照（ScriptInjector 用，避免每次注入都查 DB） */
    fun snapshot(): List<UserScriptEntity> = cache.values.filter { it.enabled }
    /** 启动时预加载 */
    suspend fun preload() {
        dao.getAllOnce().forEach { cache[it.id] = it }
    }
}
```

#### 2.5.2 UserScriptDao

```kotlin
@Dao
interface UserScriptDao {
    @Query("SELECT * FROM userscripts ORDER BY updated_at DESC")
    fun observeAll(): Flow<List<UserScriptEntity>>

    @Query("SELECT * FROM userscripts WHERE enabled = 1 ORDER BY updated_at DESC")
    fun observeEnabled(): Flow<List<UserScriptEntity>>

    @Query("SELECT * FROM userscripts")
    suspend fun getAllOnce(): List<UserScriptEntity>

    @Query("SELECT * FROM userscripts WHERE id = :id LIMIT 1")
    suspend fun findById(id: String): UserScriptEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: UserScriptEntity)

    @Update
    suspend fun update(entity: UserScriptEntity)

    @Query("DELETE FROM userscripts WHERE id = :id")
    suspend fun deleteById(id: String)
}
```

#### 2.5.3 create_userscript

```kotlin
class CreateUserscriptTool(
    private val repository: UserScriptRepository,
) : Tool {
    override val definition = ToolDefinition(
        name = "create_userscript",
        description = "Create a userscript that will be injected into matching web pages. Provide JavaScript code body (no ==UserScript== header needed).",
        parameters = toolObjectSchema {
            putJsonObject("name") { put("type", "string"); put("description", "Script name") }
            putJsonObject("code") { put("type", "string"); put("description", "JavaScript code body") }
            putJsonObject("matches") {
                put("type", "array")
                put("items", buildJsonObject { put("type", "string") })
                put("description", "URL glob patterns, e.g. *://example.com/*")
            }
            putJsonObject("description_text") { put("type", "string") }
            putJsonArray("required") { add("name"); add("code") }
        }
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val name = args["name"]?.jsonPrimitive?.contentOrNull ?: return ToolResult.error("missing name")
        val code = args["code"]?.jsonPrimitive?.contentOrNull ?: return ToolResult.error("missing code")
        val matches = args["matches"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
        val desc = args["description_text"]?.jsonPrimitive?.contentOrNull ?: ""
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        repository.insert(UserScriptEntity(
            id=id, name=name, namespace="", version="1.0", description=desc, author="AI",
            matches=matches, includes=emptyList(), excludes=emptyList(), grants=emptyList(),
            runAt="document-end", code=code, rawMetadata="", enabled=true, source="ai",
            createdAt=now, updatedAt=now, versionCode=1
        ))
        return ToolResult.success(buildJsonObject { put("id", id); put("name", name); put("enabled", true) })
    }
}
```

#### 2.5.4 update_userscript

```kotlin
class UpdateUserscriptTool(private val repository: UserScriptRepository) : Tool {
    override val definition = ToolDefinition(
        name = "update_userscript",
        description = "Update an existing userscript by id. All fields optional except id.",
        parameters = toolObjectSchema {
            putJsonObject("id") { put("type", "string") }
            putJsonObject("name") { put("type", "string") }
            putJsonObject("code") { put("type", "string") }
            putJsonObject("matches") { put("type","array"); put("items", buildJsonObject { put("type","string") }) }
            putJsonObject("enabled") { put("type", "boolean") }
            putJsonArray("required") { add("id") }
        }
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val id = args["id"]?.jsonPrimitive?.contentOrNull ?: return ToolResult.error("missing id")
        val existing = repository.getById(id) ?: return ToolResult.error("script not found: $id")
        val updated = existing.copy(
            name = args["name"]?.jsonPrimitive?.contentOrNull ?: existing.name,
            code = args["code"]?.jsonPrimitive?.contentOrNull ?: existing.code,
            matches = args["matches"]?.jsonArray?.map { it.jsonPrimitive.content } ?: existing.matches,
            enabled = args["enabled"]?.jsonPrimitive?.booleanOrNull ?: existing.enabled,
        )
        repository.update(updated)
        return ToolResult.success(buildJsonObject { put("id", id); put("updated", true) })
    }
}
```

#### 2.5.5 list_userscripts

```kotlin
class ListUserscriptsTool(private val repository: UserScriptRepository) : Tool {
    override val definition = ToolDefinition(
        name = "list_userscripts",
        description = "List all userscripts. Optionally filter by enabled status.",
        parameters = toolObjectSchema {
            putJsonObject("enabled") { put("type", "boolean") }
        }
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val enabledFilter = args["enabled"]?.jsonPrimitive?.booleanOrNull
        val list = repository.snapshot().let { all ->
            if (enabledFilter == null) all else all.filter { it.enabled == enabledFilter }
        }
        return ToolResult.success(buildJsonObject {
            putJsonArray("scripts") {
                list.forEach { s ->
                    add(buildJsonObject {
                        put("id", s.id); put("name", s.name)
                        put("enabled", s.enabled); put("matches", Json.encodeToJsonElement(s.matches))
                    })
                }
            }
        })
    }
}
```

#### 2.5.6 delete_userscript

```kotlin
class DeleteUserscriptTool(private val repository: UserScriptRepository) : Tool {
    override val definition = ToolDefinition(
        name = "delete_userscript",
        description = "Delete a userscript by id.",
        parameters = toolObjectSchema {
            putJsonObject("id") { put("type", "string") }
            putJsonArray("required") { add("id") }
        }
    )
    override suspend fun execute(args: JsonObject): ToolResult {
        val id = args["id"]?.jsonPrimitive?.contentOrNull ?: return ToolResult.error("missing id")
        repository.delete(id)
        return ToolResult.success(buildJsonObject { put("id", id); put("deleted", true) })
    }
}
```

### 2.6 UI 设计

#### 2.6.1 设计原则（遵循 roadmap 第七/七.5 章）

- 反 AI slop：禁止紫渐变、禁止 emoji（dingbats 除外）
- 无边框美学：列表项用背景色差分隔（Surface 颜色），不画 border
- 视觉对齐 SettingsScreen 现有风格（Material3 Scaffold + TopAppBar）

#### 2.6.2 SettingsScreen 改造（新签名）

```kotlin
@Composable
fun SettingsScreen(
    onClose: () -> Unit,
    onNavigateToAiConfig: () -> Unit = {},
    onNavigateToScripts: () -> Unit = {},  // M4 新增
    viewModel: SettingsViewModel = hiltViewModel()
)
```

在 SettingsScreen 的"AI 配置"项下方加"脚本管理"项（图标 Icons.Default.Code + 文字 + 箭头），点击触发 `onNavigateToScripts()`。

#### 2.6.3 AppNavGraph 改造

```kotlin
composable(Routes.SETTINGS) {
    SettingsScreen(
        onClose = { navController.popBackStack() },
        onNavigateToAiConfig = { navController.navigate(Routes.AI_CONFIG) },
        onNavigateToScripts = { navController.navigate(Routes.SCRIPT_LIST) }  // M4 新增
    )
}
composable(Routes.SCRIPT_LIST) {
    ScriptListScreen(
        onClose = { navController.popBackStack() },
        onEditScript = { id -> navController.navigate(Routes.scriptEdit(id)) },
        onNewScript = { navController.navigate(Routes.SCRIPT_NEW) }
    )
}
composable(Routes.SCRIPT_NEW) {
    ScriptEditScreen(scriptId = null, onClose = { navController.popBackStack() })
}
composable(Routes.SCRIPT_EDIT) { backStackEntry ->
    val id = backStackEntry.arguments?.getString("scriptId") ?: return@composable
    ScriptEditScreen(scriptId = id, onClose = { navController.popBackStack() })
}
```

#### 2.6.4 路由（驼峰风格，与项目一致）

```kotlin
object Routes {
    // 现有路由...
    const val SCRIPT_LIST = "scriptList"
    const val SCRIPT_NEW = "scriptNew"
    const val SCRIPT_EDIT = "scriptEdit/{scriptId}"
    fun scriptEdit(id: String) = "scriptEdit/$id"
}
```

#### 2.6.5 ScriptListScreen

```
┌─────────────────────────────────┐
│ ← 脚本管理            [+ 导入]   │  TopAppBar
├─────────────────────────────────┤
│ 贴吧去广告              [开关●]  │  Surface 项
│ *://tieba.baidu.com/*           │  matches 摘要
│ v1.0 · 启用 · 导入      [编辑]  │  版本/状态/来源
│ ──────────────────────────────  │  分隔线（淡色）
│ 知乎净化                [开关○]  │
│ ...                             │
└─────────────────────────────────┘
        [+ 新建脚本]               FAB
```

- 空状态：居中 Icon + "还没有脚本"
- 列表项用 Surface + 淡色分隔线（非 border）
- 长按菜单：编辑/删除/复制代码到剪贴板/分享 .user.js（ACTION_SEND）

#### 2.6.6 ScriptEditScreen

- 名称/描述：TextField
- 匹配：多行 TextField（一行一个 pattern）
- 运行时机：ExposedDropdownMenuBox（document-start/document-end/document-idle）
- 代码：多行 TextField，FontFamily.Monospace
- 保存（v3 修复 M4：明确表单字段为 source of truth）：
  - **加载时**：若代码含 `==UserScript==` 块，用 ScriptMetadataParser 解析后填充表单字段空值；用户可在 UI 中覆盖
  - **保存时**：表单字段是 source of truth——用表单字段值**重写**代码中的 `==UserScript==` 块（保持代码正文不变，仅同步元数据块），确保下次解析时表单与代码块一致
  - 实现方式：`ScriptMetadataParser.rewriteMetadata(code, formMetadata)` → 返回新代码（含更新后的 `==UserScript==` 块 + 原代码正文）

#### 2.6.7 导入流程

**方式 A：URL 导入** — 弹对话框输入 .user.js URL → OkHttp 下载 → 解析 → 预览 → 保存
**方式 B：文件导入** — SAF (ACTION_OPEN_DOCUMENT) 选文件 → 读取 → 解析 → 预览 → 保存
**方式 C：网页拦截** — `LivingWebViewClient.shouldOverrideUrlLoading` 检测 url 以 `.user.js` 结尾 → 拦截 → 下载 → 解析 → 弹 ScriptImportDialog → 保存

### 2.7 DI 集成

#### 2.7.1 DatabaseModule 扩展

```kotlin
@Provides @Singleton
fun provideDatabase(@ApplicationContext ctx: Context): LivingDatabase =
    Room.databaseBuilder(ctx, LivingDatabase::class.java, "living.db")  // S1 修复：living.db
        .addMigrations(LivingDatabase.MIGRATION_2_3, LivingDatabase.MIGRATION_3_4)  // S2 修复
        .fallbackToDestructiveMigration()
        .fallbackToDestructiveMigrationOnDowngrade()
        .build()

@Provides fun provideUserScriptDao(db: LivingDatabase): UserScriptDao = db.userScriptDao()

@Provides @Singleton
fun provideUserScriptRepository(dao: UserScriptDao): UserScriptRepository = UserScriptRepository(dao)
```

#### 2.7.2 AppModule 扩展

```kotlin
@Provides @Singleton
fun provideGmApiBridge(
    kvStorage: KvStorage,
    okHttpClient: OkHttpClient,
    @ApplicationContext context: Context,
    coroutineScope: CoroutineScope,  // provideApplicationScope
    webviewHolder: ActiveWebViewHolder,
): GmApiBridge = GmApiBridge(kvStorage, okHttpClient, context, coroutineScope, webviewHolder)

@Provides @Singleton
fun provideScriptInjector(
    userScriptRepository: UserScriptRepository,
    @ApplicationContext context: Context,
    okHttpClient: OkHttpClient,  // v3 修复 M8：用于 .user.js 下载
    coroutineScope: CoroutineScope,  // v3 修复 M8：用于异步下载
): ScriptInjector = ScriptInjector(userScriptRepository, context, okHttpClient, coroutineScope)
```

`provideToolRegistry` 末尾追加：
```kotlin
register(CreateUserscriptTool(userScriptRepository))
register(UpdateUserscriptTool(userScriptRepository))
register(ListUserscriptsTool(userScriptRepository))
register(DeleteUserscriptTool(userScriptRepository))
```

#### 2.7.3 LivingDashboardApp.onCreate 扩展（preload）

```kotlin
@HiltAndroidApp
class LivingDashboardApp : Application() {
    @Inject lateinit var wsClient: WsClient
    @Inject lateinit var canvasRepository: CanvasRepository
    @Inject lateinit var wsToolCallDispatcher: WsToolCallDispatcher
    @Inject lateinit var kvStorage: KvStorage              // M4 新增
    @Inject lateinit var userScriptRepository: UserScriptRepository  // M4 新增

    override fun onCreate() {
        super.onCreate()
        wsClient.connect()
        wsToolCallDispatcher.start()
        appScope.launch {
            // M2
            val aggregate = canvasRepository.getAggregatePanel()
            if (aggregate == null) canvasRepository.createAggregatePanel()
            // M4：预加载 KV 和脚本到内存缓存（GM_getValue 同步读 / ScriptInjector snapshot 用）
            kvStorage.preload()
            userScriptRepository.preload()
        }
    }
}
```

注：preload 在 IO 协程异步执行，不阻塞 onCreate。preload 完成前 GM_getValue 返回 defaultValue（油猴规范允许）；preload 完成后内存缓存就绪。若需"首脚本注入前 preload 必须完成"，可在 ScriptInjector.injectForUrl 内 `runBlocking { if (!preloaded) { repository.preload(); preloaded = true } }`——但通常 preload 在 App 启动后秒级完成，用户打开第一个网页前已就绪。

### 2.8 assets/scripts/gm_api_init.js

> v3 修复 L5：完整路径 `src/main/assets/scripts/gm_api_init.js`（assets 默认路径即 `src/main/assets`，无需在 build.gradle.kts sourceSets 中显式声明）。

```javascript
// v3 修复 S2：初始化守卫——防止 ScriptInjector 在 document-start / document-end / document-idle 三阶段重复注入导致 callbacks 字典被重置、异步回调丢失
if (window.__gmApiInitialized) {
    // 已初始化过，跳过本次注入（保留原 callbacks 闭包）
} else {
    window.__gmApiInitialized = true;
    (function() {
        const callbacks = {};
        let cbId = 0;

        function gmCall(api, args, isAsync) {
            const id = isAsync ? ('cb' + (++cbId)) : null;
            // v3 修复 N3：删除 _cbId 冗余字段（Kotlin 侧只读顶层 call.cbId，从不读 call.args._cbId）
            const payload = args;
            const msg = '__GM_CALL__|' + JSON.stringify({ api: api, args: payload, cbId: id });
            // 同步调用：prompt 返回 Kotlin confirm 的结果
            // 异步调用：prompt 立即返回 cbId，结果后续 __gmCbSuccess 回调
            const result = prompt(msg);
            if (isAsync) {
                try {
                    const parsed = JSON.parse(result || '{}');
                    if (parsed.cbId) {
                        callbacks[parsed.cbId] = {
                            onSuccess: args.onSuccess,
                            onError: args.onError,
                            onclick: args.onclick
                        };
                    }
                } catch (e) {}
            }
            return isAsync ? id : result;
        }

        window.GM_addStyle = function(css) {
            // v3 修复 F3：JS 侧负责 <style> 注入，Kotlin 侧只 confirm("{}")
            gmCall('GM_addStyle', { css: css }, false);
            const s = document.createElement('style');
            s.textContent = css;
            document.head.appendChild(s);
            return s;
        };

        window.GM_setValue = function(key, value) {
            gmCall('GM_setValue', { key: key, value: String(value) }, false);
        };

        window.GM_getValue = function(key, defaultValue) {
            // v3 修复 B2：JS 侧补发 default 字段，使 Kotlin 侧 args["default"] 能读到 defaultValue
            // （原 v3 只发 key，Kotlin 侧 defaultV 永远为 null，key 缺失时返回 "" 而非 defaultValue，违反油猴规范）
            const result = gmCall('GM_getValue', {
                key: key,
                default: defaultValue == null ? "" : String(defaultValue)
            }, false);
            try {
                const parsed = JSON.parse(result || '{}');
                return parsed.value !== undefined ? parsed.value : defaultValue;
            } catch (e) { return defaultValue; }
        };

        window.GM_setClipboard = function(text) {
            gmCall('GM_setClipboard', { text: text }, false);
        };

        window.GM_notification = function(details) {
            if (typeof details === 'string') details = { text: details };
            gmCall('GM_notification', details, true);  // 异步（onclick 回调）
        };

        window.GM_xmlhttpRequest = function(details) {
            const id = gmCall('GM_xmlhttpRequest', details, true);
            return { abort: function() { gmCall('GM_xhrAbort', { id: id }, false); } };
        };

        // 异步回调入口（Kotlin evaluateJavascript 调用）
        window.__gmCbSuccess = function(cbId, result) {
            const cb = callbacks[cbId];
            if (!cb) return;
            if (cb.onSuccess) cb.onSuccess(result);
            delete callbacks[cbId];
        };

        window.__gmCbError = function(cbId, error) {
            const cb = callbacks[cbId];
            if (!cb) return;
            if (cb.onError) cb.onError(error);
            delete callbacks[cbId];
        };

        window.__gmNotificationOnClick = function(cbId) {
            const cb = callbacks[cbId];
            if (cb && cb.onclick) cb.onclick();
            delete callbacks[cbId];
        };
    })();
}
```

### 2.9 KvStorage 扩展

```kotlin
class KvStorage(private val dataStore: DataStore<Preferences>) {
    private val memoryCache = ConcurrentHashMap<String, String>()

    suspend fun read(key: String): String? {
        memoryCache[key]?.let { return it }
        return dataStore.data.first()[stringPreferencesKey(key)]?.also { memoryCache[key] = it }
    }

    /** M4 新增：同步读（GM_getValue 用，依赖 preload 提前加载） */
    fun readSync(key: String): String? = memoryCache[key]

    /** v3 新增：同步写内存缓存（GM_setValue 用，立即对后续 readSync 可见） */
    fun writeSync(key: String, value: String) {
        memoryCache[key] = value
    }

    suspend fun write(key: String, value: String) {
        memoryCache[key] = value
        dataStore.edit { it[stringPreferencesKey(key)] = value }
    }

    suspend fun listKeys(): List<String> =
        dataStore.data.map { it.asMap().keys.map { k -> k.name } }.first()

    /** M4 新增：预加载所有 KV 到内存（启动时调用） */
    suspend fun preload() {
        dataStore.data.first().asMap().forEach { (k, v) ->
            memoryCache[k.name] = v.toString()
        }
    }
}
```

> v3 修复 L1：GM_setValue/GM_getValue 在 M4 阶段简化——值强制转 String，数字/布尔/对象类型丢失。用户脚本需自行 `JSON.stringify` 存储对象，`JSON.parse` 取回。后续 M5+ 可扩展 `KvStorage` 支持类型化存储。

### 2.10 ScriptInjector 类设计

> v3 修复 S3：增加 `lastInjectedUrl` 跟踪，避免重定向/多次 onPageFinished 触发同一 URL 的脚本重复注入。
> v3 修复 M8：增加 `onUserScriptUrlDetected(url)` 方法用于 `.user.js` 拦截导入。
> v3 修复 L5：assets 路径明确为 `scripts/gm_api_init.js`（对应 `src/main/assets/scripts/gm_api_init.js`）。

```kotlin
class ScriptInjector(
    private val repository: UserScriptRepository,
    private val context: Context,
    private val okHttpClient: OkHttpClient,  // v3 修复 M8：用于 .user.js 下载
    private val coroutineScope: CoroutineScope,  // v3 修复 M8：用于异步下载
) {
    private var gmApiInitJs: String? = null
    // v3 修复 S3：跟踪上次注入的 URL，避免同一 URL 重复注入脚本（重定向/pushState 场景）
    private var lastInjectedUrl: String? = null

    private fun getGmApiInitJs(): String {
        gmApiInitJs?.let { return it }
        val js = context.assets.open("scripts/gm_api_init.js").bufferedReader().use { it.readText() }
        gmApiInitJs = js
        return js
    }

    fun injectForUrl(view: WebView, url: String, runAt: RunAt) {
        // v3 修复 S3：URL 未变化时跳过注入（防止重定向/多次 onPageFinished 重复注入）
        // 注意：document-start 阶段必须重新检查（新页面需要重新注入），用 runAt 区分
        // v3 修复 B1：原 v3 的 if 块为空体（仅注释无 return），脚本仍被重复注入。
        //   修订为：URL 未变化且非 document-start 时直接 return，并统一在分支末尾更新 lastInjectedUrl。
        if (url == lastInjectedUrl && runAt != RunAt.DOCUMENT_START) {
            // URL 未变化且非 document-start，避免重定向/多次 onPageFinished 重复注入
            return
        }
        lastInjectedUrl = url  // 仅 document-start 或 URL 变化时更新
        val scripts = repository.snapshot().filter { script ->
            script.runAt == runAt.value && matchesUrl(script, url)
        }
        if (scripts.isEmpty()) return
        // 1. 注入 GM_* API init（v3 修复 S2：JS 侧有 __gmApiInitialized 守卫，重复注入也安全）
        view.evaluateJavascript("(function(){${getGmApiInitJs()}})();", null)
        // 2. 注入每个脚本（IIFE 包裹）
        scripts.forEach { script ->
            val wrapped = "(function(){try{${script.code}}catch(e){console.error('[userscript ${script.name}]',e)}})();"
            view.evaluateJavascript(wrapped, null)
        }
    }

    /** v3 修复 M8：拦截 .user.js URL 时调用（导入方式 C） */
    fun onUserScriptUrlDetected(url: String) {
        coroutineScope.launch {
            try {
                val resp = okHttpClient.newCall(Request.Builder().url(url).build()).execute()
                val body = resp.body?.string() ?: return@launch
                val parsed = ScriptMetadataParser.parse(body)
                // 通过 Event Bus / SharedFlow 通知 UI 弹出 ScriptImportDialog
                // （实现细节：ScriptImportViewModel 监听 ScriptInjector.importEvents SharedFlow）
                importEvents.tryEmit(parsed)
            } catch (e: Exception) {
                // 静默失败，可扩展为 Toast 提示
            }
        }
    }
    val importEvents = MutableSharedFlow<ParsedScript>(extraBufferCapacity = 4)

    private fun matchesUrl(script: UserScriptEntity, url: String): Boolean {
        if (script.excludes.any { UrlMatcher.matches(it, url) }) return false
        if (script.matches.isNotEmpty()) {
            return script.matches.any { UrlMatcher.matches(it, url) }
        }
        if (script.includes.isNotEmpty()) {
            return script.includes.any { UrlMatcher.includes(it, url) }
        }
        return false  // 无 matches/includes 默认不注入
    }
}
```

## 三、实施任务清单

| ID | 任务 | 文件 | 依赖 |
|----|------|------|------|
| T1 | 数据层 | UserScriptEntity / UserScriptDao / UserScriptRepository / Converters（扩展）/ LivingDatabase（v4 + MIGRATION_3_4）/ DatabaseModule（扩展） | - |
| T2 | 元数据解析 | ScriptMetadataParser / ParsedScript | - |
| T3 | GM_* API 桥接 | GmApiBridge / GmCall / assets/scripts/gm_api_init.js / KvStorage（扩展）/ ActiveWebViewHolder（已有） | T1 |
| T4 | 脚本注入器 + 集成 | ScriptInjector / UrlMatcher / RunAt / LivingWebViewClient（扩展）/ LivingWebView（扩展）/ LivingWebChromeClient（扩展） | T1, T2, T3 |
| T5 | AI 工具 | 4 个 UserscriptTool / AppModule（扩展 provideToolRegistry + provideGmApiBridge + provideScriptInjector + provideUserScriptRepository）/ LivingDashboardApp（扩展 preload） | T1, T3, T4 |
| T6 | UI | ScriptListScreen/VM / ScriptEditScreen/VM / ScriptImportDialog/VM / Routes（扩展）/ AppNavGraph（扩展）/ SettingsScreen（扩展入口）/ BrowserScreen（传 scriptInjector）/ WebviewWidget（用 EntryPoint） | T1, T2, T5 |
| T7 | 单元测试 | ScriptMetadataParserTest / UrlMatcherTest / GmApiBridgeTest / ScriptInjectorTest / UserScriptDaoTest / UserscriptToolsTest | T1-T6 |
| T8 | 构建 + 验证 | build.gradle.kts（versionCode 10, versionName 0.1.0-m4）/ Robolectric 测试 / Release APK / 真机若可用 | T1-T7 |

## 四、验收标准

| 验收项 | 验证方式 | 通过标准 |
|--------|---------|---------|
| 油猴脚本能导入并运行 | ScriptMetadataParserTest + ScriptInjectorTest（Robolectric + MockK 模拟 WebView） | 解析器覆盖典型/边界 case；注入器验证 evaluateJavascript 被调用且参数含 GM API init + 脚本正文 |
| GM_* API 正常 | GmApiBridgeTest（Robolectric + MockK） | v3 修复 F2：7 个 API handlePrompt 路径全覆盖（含 GM_xhrAbort）；GM_xmlhttpRequest 用 MockWebServer；GM_getValue 同步读内存缓存；GM_addStyle 不调 evaluateJavascript；handlePrompt try-catch 在 JSON 解析失败时 result.cancel() |
| AI 能生成脚本并保存 | UserscriptToolsTest（Robolectric） | create/update/list/delete 4 工具 CRUD 全覆盖，写入 Room 可读回 |
| 常驻 UI 脚本正常 | ScriptInjectorTest（Robolectric） | document-end 脚本在 onPageFinished 时被注入；GM_addStyle 调用链路通（v3 修复 F3：Kotlin 侧只 confirm("{}") 不调 evaluateJavascript，<style> 注入由 JS 侧 gm_api_init.js 完成，验证 mock 的 evaluateJavascript 调用次数为 0） |
| 脚本多端同步 | 跳过（依赖 M5） | versionCode 字段已预留，文档明确说明跳过 |
| 生成签名 apk 并通过干净 Android 安装测试 | Release APK 构建 + 真机若可用 | `./gradlew assembleRelease` 成功；apk < 20MB；真机若连接则 `adb install -r` + 启动 + 设置→脚本管理 + 创建脚本 + 浏览器打开匹配 URL + 验证脚本生效 |

**运行时验证策略**（响应 S8）：
- **Robolectric 纯逻辑验证**（必做，运行时执行 Android 框架代码）：ScriptMetadataParserTest / UrlMatcherTest / UserScriptDaoTest（Robolectric 用真实 SQLite）/ GmApiBridgeTest（MockK WebView）/ ScriptInjectorTest（MockK WebView）/ UserscriptToolsTest（Robolectric 真实 Room）
- **Release APK 编译验证**（必做，运行时打包签名）：`./gradlew assembleRelease` 成功生成签名 APK + 体积 < 20MB
- **真机/模拟器端到端验证**（若可用）：`adb install -r` + 启动 + UI 操作 + logcat 验证脚本注入与 GM_* API 调用
- **若真机不可用**：标记为"已知遗留项"（与 M3/M8 一致），不假装通过

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| 脚本同步依赖 M5 | 本地 Room + versionCode 预留 |
| 真机不可用 | Robolectric 验证纯逻辑 + Release APK 编译验证；端到端验证标记为遗留 |
| onJsPrompt 桥接被网页伪造 | M4 做前缀匹配 + 参数 schema 校验（v3 修复 M7：try-catch + 必填字段 `api`/`args` 类型校验，解析失败 `result.cancel()` 返回 false）；记录残留风险（网页 JS 调 `prompt('__GM_CALL__\|...')` 可触发 GM_* API），M7 阶段补 sourceId 校验 |
| GM_getValue 同步阻塞 | 内存缓存 + 启动 preload（IO 协程，不阻塞 onCreate） |
| GM_xmlhttpRequest 滥用 | 超时 30s + 响应 ≤ 1MB + 仅 http/https；SSRF 风险记录，M7 补白名单 |
| Migration 3→4 破坏现有数据 | v3 修复 F1：Migration SQL **无 DEFAULT 子句**（与 MIGRATION_2_3 风格一致），避免 Room schema 校验失败触发 fallbackToDestructiveMigration 销毁整库；Migration 仅 CREATE TABLE IF NOT EXISTS，不动现有表 |
| 包体增长 | 无新依赖；assets/gm_api_init.js ≈ 1.7KB |

## 六、对抗审查检查点

编码完成后 adversarial-review skill 必须验证：

1. **数据层**：v3 修复 F1：Migration 3→4 SQL 与 Entity DDL 字段一致且**无 DEFAULT 子句**；Converters 双向转换；DB 名 `"living.db"`；MIGRATION_2_3 + MIGRATION_3_4 都注册；MIGRATION_3_4 风格与 MIGRATION_2_3 一致
2. **解析器**：边界 case（无元数据块、重复 key、@run-at 非法值、value 含 //、==UserScript== 行尾锚定）
3. **GM_* API**：v3 修复 F2：7 个 API handlePrompt 路径全覆盖（含 GM_xhrAbort）；onJsPrompt 拦截 `__GM_CALL__|` 前缀；GM_xmlhttpRequest 错误路径；GM_getValue 内存缓存一致性；GM_notification onclick 回调链路；v3 修复 F3：GM_addStyle 不调 evaluateJavascript；v3 修复 M7：handlePrompt try-catch + schema 校验
4. **注入器**：URL 匹配 host/path 分段；runAt 三档时机；脚本顺序（gm_api_init → 脚本正文 IIFE）；v3 修复 S2：gm_api_init.js `__gmApiInitialized` 守卫生效（多次注入不重置 callbacks）；v3 修复 S3：ScriptInjector `lastInjectedUrl` 跟踪（重定向不重复注入）；v3 修复 S4：host 段 `*` → `[^/.]*`（不跨 / 也不跨 .）；v3 修复 S5：path 段先 `Regex.escape` 再恢复 `\*`
5. **AI 工具**：4 个工具参数 schema；错误返回 ToolResult.error；CRUD 链路通
6. **UI**：路由跳转（SCRIPT_LIST / SCRIPT_NEW / SCRIPT_EDIT）；空状态；开关切换；编辑保存（v3 修复 M4：表单字段重写代码 ==UserScript== 块）；导入流程；SettingsScreen 新参数 onNavigateToScripts
7. **集成**：
   - ToolRegistry 注册 4 个新工具
   - SettingsScreen 入口可见且点击跳转
   - BrowserScreen 通过 BrowserViewModel 注入 scriptInjector + gmApiBridge + activeWebViewHolder（v3 修复 S8）
   - WebviewWidget 通过 EntryPoint 获取 scriptInjector + gmApiBridge + activeWebViewHolder（v3 修复 S8/M3：用 `EntryPointAccessors.fromApplication`）
   - LivingDashboardApp.onCreate 在 `appScope.launch` 中调用 kvStorage.preload() + userScriptRepository.preload()（v3 修复 S1：异步不阻塞）
   - LivingWebChromeClient.onJsPrompt 拦截并分发
   - LivingWebViewClient.shouldOverrideUrlLoading 拦截 .user.js 后缀（v3 修复 M8）
   - GmApiBridge init 块创建 NotificationChannel（v3 修复 S7）
   - AndroidManifest.xml 声明 POST_NOTIFICATIONS 权限（v3 修复 S6）
8. **运行时验证**：
   - Robolectric 跑全部测试全绿
   - Release APK 编译成功 + 签名 + 体积 < 20MB
   - 真机若连接：`adb install -r` + 启动 + 设置→脚本管理 + 创建脚本 + 浏览器打开匹配 URL + logcat 看脚本注入 + GM_* API 调用

## 七、并行策略

- T1 + T2 + T3 可并行（无相互依赖）
- T4 依赖 T1+T2+T3
- T5 依赖 T1+T3+T4
- T6 依赖 T1+T2+T5
- T7 依赖各任务完成
- T8 最后

预计 3-5 个 sub-agent 并行：
- Agent A：T1 数据层 + T2 解析器
- Agent B：T3 GM_* API 桥接 + assets/gm_api_init.js
- Agent C：T4 注入器 + 集成 LivingWebViewClient/ChromeClient/WebView（依赖 T1-T3，可与 A/B 后段并行）
- Agent D：T5 AI 工具 + DI 集成（依赖 T1，可与 C 并行）
- Agent E：T6 UI（依赖 T1+T2+T5，最后启动）
- Agent F：T7 测试 + T8 构建（最后）

## 八、变更清单

> v3 修复 M6：修正文件计数——27 个源文件 + 6 个测试文件 = 33 个新增；修改文件 16 个（新增 AndroidManifest.xml）。

### 新增文件（27 源文件 + 6 测试文件 = 33 总数）
- `data/entity/UserScriptEntity.kt`
- `data/dao/UserScriptDao.kt`
- `data/repository/UserScriptRepository.kt`
- `script/ScriptMetadataParser.kt`
- `script/ParsedScript.kt`
- `script/GmApiBridge.kt`
- `script/GmCall.kt`（v3 修复 M1：明确数据类定义见 2.3.7）
- `script/ScriptInjector.kt`
- `script/UrlMatcher.kt`
- `script/RunAt.kt`
- `ai/tools/CreateUserscriptTool.kt`
- `ai/tools/UpdateUserscriptTool.kt`
- `ai/tools/ListUserscriptsTool.kt`
- `ai/tools/DeleteUserscriptTool.kt`
- `ui/script/ScriptListScreen.kt`
- `ui/script/ScriptListViewModel.kt`
- `ui/script/ScriptEditScreen.kt`
- `ui/script/ScriptEditViewModel.kt`
- `ui/script/ScriptImportDialog.kt`
- `ui/script/ScriptImportViewModel.kt`
- `ui/script/ScriptInjectorEntryPoint.kt`（WebviewWidget 用）
- `ui/script/GmNotificationReceiver.kt`（v3 修复 S6：BroadcastReceiver 监听通知点击）
- `src/main/assets/scripts/gm_api_init.js`（v3 修复 L5：明确完整路径）
- 6 个测试文件：
  - `script/ScriptMetadataParserTest.kt`
  - `script/UrlMatcherTest.kt`
  - `script/GmApiBridgeTest.kt`
  - `script/ScriptInjectorTest.kt`
  - `data/dao/UserScriptDaoTest.kt`
  - `ai/tools/UserscriptToolsTest.kt`

### 修改文件（16 个）
- `data/db/Converters.kt`（+stringListConverter）
- `data/db/LivingDatabase.kt`（v4 + UserScriptEntity + MIGRATION_3_4 + userScriptDao()）
- `di/DatabaseModule.kt`（+MIGRATION_3_4 + provideUserScriptDao + provideUserScriptRepository）
- `di/AppModule.kt`（+provideGmApiBridge + provideScriptInjector + 4 工具注册）
- `ai/KvStorage.kt`（+readSync + writeSync + memoryCache + preload）
- `browser/LivingWebViewClient.kt`（+scriptInjector 参数 + 注入调用 + shouldOverrideUrlLoading 拦截 .user.js，v3 修复 M8）
- `browser/LivingWebView.kt`（+scriptInjector + gmApiBridge 参数透传）
- `browser/LivingWebChromeClient.kt`（+gmApiBridge 参数 + onJsPrompt 重写）
- `ui/nav/Routes.kt`（+SCRIPT_LIST/SCRIPT_NEW/SCRIPT_EDIT）
- `ui/nav/AppNavGraph.kt`（+3 个 composable + SettingsScreen 传 onNavigateToScripts）
- `ui/settings/SettingsScreen.kt`（+onNavigateToScripts 参数 + 脚本管理入口）
- `ui/browser/BrowserScreen.kt`（+传 scriptInjector/gmApiBridge/activeWebViewHolder，v3 修复 S8）
- `ui/browser/BrowserViewModel.kt`（+注入 ScriptInjector/GmApiBridge 为 val 属性，v3 修复 M2）
- `ui/widget/WebviewWidget.kt`（+EntryPoint 获取 ScriptInjector/GmApiBridge/ActiveWebViewHolder + 用 EntryPointAccessors.fromApplication，v3 修复 M3/S8）
- `LivingDashboardApp.kt`（+kvStorage/userScriptRepository 注入 + preload）
- `app/build.gradle.kts`（versionCode 10, versionName 0.1.0-m4）
- `src/main/AndroidManifest.xml`（v3 修复 S6：+`<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` + 注册 GmNotificationReceiver）

---

**Spec v3 编写完毕，等待对抗审查。**
