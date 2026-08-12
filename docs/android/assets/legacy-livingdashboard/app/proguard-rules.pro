# ============================================================================
# Living Dashboard Android - ProGuard / R8 规则
# ============================================================================
#
# 引用：
# - Spec 8.2 节 行 1836-1842（M8 新增 com.livingdashboard.ai.** 保留）
# - kotlinx.serialization 官方推荐规则（防 @Serializable 类被混淆）
# - Hilt / Dagger 默认规则由 `dagger.hilt.android.plugin` 自动注入，无需重复
# - Room 默认规则由 `androidx.room:room-compiler` 自动注入
# ============================================================================

# ----------------------------------------------------------------------------
# 1. M8 Spec 8.2 行 1836-1842：保留 com.livingdashboard.ai.** 包
# ----------------------------------------------------------------------------
# 原因：
# - LlmClient / AgentLoop / ToolRegistry / SkillLoader 等用 kotlinx.serialization
#   反射加载（@Serializable），混淆后字段名会变，导致 JSON 解析失败。
# - ToolDefinition / ToolResult 是 data class，被 AgentLoop 通过 JSON 序列化传给 LLM。
# - ApiKeyStore 持有 EncryptedSharedPreferences，反射读写。
# - LocalAgentService 注入字段名与 Hilt 生成代码绑定，混淆后注入失败。
# - 保险起见整个 ai.** 包全保留（class + members）。
-keep class com.livingdashboard.ai.** { *; }
-keepclassmembers class com.livingdashboard.ai.** { *; }

# ----------------------------------------------------------------------------
# 2. M8 Spec 8.2 行 1840-1841：保留 kotlinx.serialization.** 包
# ----------------------------------------------------------------------------
# 原因：
# - kotlinx.serialization 用 KSerializer 反射读写 @Serializable 类，
#   混淆后 serializer 生成的字段名与 JSON 字段不匹配，反序列化失败。
# - 包含 JsonElement / JsonObject / JsonArray 等 schema 类被 LLM 协议层直接使用。
# - 官方文档：https://github.com/Kotlin/kotlinx.serialization#privacy-policy
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class kotlinx.serialization.** { *; }

# ----------------------------------------------------------------------------
# 3. kotlinx.serialization @Serializable 派生类保留
# ----------------------------------------------------------------------------
# 防止 @Serializable 注解的子类（如 LlmMessage / ToolCall / StreamChunk）
# 字段名被混淆。kotlinx-serialization 编译器插件生成的 $serializer 类
# 必须保留原字段名以匹配 JSON。
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    *** serializer;
}
-keepclasseswithmembers class ** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ----------------------------------------------------------------------------
# 4. OkHttp / MockWebServer（M8 新增测试依赖）
# ----------------------------------------------------------------------------
# OkHttp 默认规则由 `okhttp3` 提供（consumer-rules.pro），但保险起见显式保留。
# MockWebServer 是测试依赖，发布版用不到，但写在此处方便 release 单元测试。
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ----------------------------------------------------------------------------
# 5. Hilt / Dagger（保险，应由插件自动注入）
# ----------------------------------------------------------------------------
# Hilt 生成的代码引用 @Inject 注解字段，混淆后注入失败。
# Hilt 插件会自动注入规则，但显式写一行作为兜底。
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.android.Hilt_HiltAndroidApp { *; }

# ----------------------------------------------------------------------------
# 6. Room（保险，应由 room-compiler 自动注入）
# ----------------------------------------------------------------------------
# Room 生成的 Dao_Impl 类引用 entity 字段名，混淆后查询失败。
-keep class * extends androidx.room.RoomDatabase { *; }
-keep @androidx.room.Entity class * { *; }

# ----------------------------------------------------------------------------
# 7. R8 缺失类抑制（M8 release 构建修复）
# ----------------------------------------------------------------------------
# 原因：
# - security-crypto 间接依赖 com.google.crypto.tink，tink 引用了
#   com.google.errorprone.annotations.* 的注解（运行时不需要）。
# - EvalEx 间接引用了 lombok.Generated（仅编译期注解）。
# - 这些类只在编译期使用，运行时缺失不影响功能。
# - 规则来源：AGP 自动生成的 app/build/outputs/mapping/release/missing_rules.txt
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
-dontwarn lombok.Generated
