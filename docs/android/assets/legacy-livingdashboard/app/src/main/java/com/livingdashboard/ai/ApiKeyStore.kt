package com.livingdashboard.ai

import android.content.SharedPreferences

/** LLM Provider 配置 */
data class LlmProviderConfig(
    val provider: String,    // "stepfun" | "openai" | "deepseek" | "anthropic" | "qwen" | "custom"
    val apiKey: String,
    val endpoint: String,
    val model: String,
)

/**
 * API Key 加密存储。
 *
 * 设计：本类只依赖 [SharedPreferences] 接口，不直接创建
 * [androidx.security.crypto.EncryptedSharedPreferences]。生产环境由
 * [com.livingdashboard.di.AppModule] 创建 EncryptedSharedPreferences 后注入（密钥落盘加密）；
 * 单元测试注入普通 SharedPreferences（由 Robolectric 提供）以隔离
 * security-crypto 对 AndroidKeyStore JCE Provider 的依赖（Robolectric 不支持）。
 */
class ApiKeyStore(private val prefs: SharedPreferences) {

    fun saveConfig(provider: String, config: LlmProviderConfig) {
        prefs.edit()
            .putString("provider_${provider}_api_key", config.apiKey)
            .putString("provider_${provider}_endpoint", config.endpoint)
            .putString("provider_${provider}_model", config.model)
            .apply()
    }

    fun getConfig(provider: String): LlmProviderConfig? {
        val key = prefs.getString("provider_${provider}_api_key", null) ?: return null
        val endpoint = prefs.getString("provider_${provider}_endpoint", "") ?: ""
        val model = prefs.getString("provider_${provider}_model", "") ?: ""
        return LlmProviderConfig(provider, key, endpoint, model)
    }

    fun getActiveProvider(): String? = prefs.getString("active_provider", null)
    fun setActiveProvider(provider: String) { prefs.edit().putString("active_provider", provider).apply() }
    fun listConfiguredProviders(): List<String> = listOf("stepfun","openai","deepseek","anthropic","qwen","custom")
        .filter { getConfig(it) != null }
    fun clearProvider(provider: String) {
        prefs.edit()
            .remove("provider_${provider}_api_key")
            .remove("provider_${provider}_endpoint")
            .remove("provider_${provider}_model")
            .apply()
    }
    fun hasConfig(provider: String): Boolean = getConfig(provider) != null
    fun clear() { prefs.edit().clear().apply() }
}
