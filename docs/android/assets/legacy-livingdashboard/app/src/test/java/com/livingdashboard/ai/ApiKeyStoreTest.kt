package com.livingdashboard.ai

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ApiKeyStoreTest {

    private lateinit var apiKeyStore: ApiKeyStore

    @Before
    fun setup() {
        // 用纯 JVM 内存版 SharedPreferences fake 替代 Robolectric：
        // ApiKeyStore 只依赖 SharedPreferences 接口，生产仍用 EncryptedSharedPreferences（见 AppModule）。
        // 测试用 InMemorySharedPreferences 避免加载 Robolectric android-all.jar，
        // 同时隔离 security-crypto 对 AndroidKeyStore JCE Provider 的依赖。
        val prefs = InMemorySharedPreferences()
        prefs.edit().clear().apply()  // 确保干净状态
        apiKeyStore = ApiKeyStore(prefs)
        // 每个测试前清空，避免跨用例污染
        apiKeyStore.clear()
    }

    @After
    fun tearDown() {
        apiKeyStore.clear()
    }

    @Test
    fun `6 providers write independently without overwriting each other`() {
        // 写入 6 个 provider 各自的配置
        apiKeyStore.saveConfig("stepfun", LlmProviderConfig("stepfun", "sk-step-1", "https://api.stepfun.com", "step-1-8k"))
        apiKeyStore.saveConfig("openai", LlmProviderConfig("openai", "sk-openai-1", "https://api.openai.com", "gpt-4o"))
        apiKeyStore.saveConfig("deepseek", LlmProviderConfig("deepseek", "sk-deepseek-1", "https://api.deepseek.com", "deepseek-chat"))
        apiKeyStore.saveConfig("anthropic", LlmProviderConfig("anthropic", "sk-ant-1", "https://api.anthropic.com", "claude-3-5-sonnet"))
        apiKeyStore.saveConfig("qwen", LlmProviderConfig("qwen", "sk-qwen-1", "https://dashscope.aliyuncs.com", "qwen-max"))
        apiKeyStore.saveConfig("gemini", LlmProviderConfig("gemini", "sk-gemini-1", "https://generativelanguage.googleapis.com", "gemini-1.5-pro"))

        // 验证互不覆盖：每个 provider 读回的应该是自己的配置
        val stepfun = apiKeyStore.getConfig("stepfun")!!
        assertEquals("sk-step-1", stepfun.apiKey)
        assertEquals("step-1-8k", stepfun.model)

        val openai = apiKeyStore.getConfig("openai")!!
        assertEquals("sk-openai-1", openai.apiKey)
        assertEquals("gpt-4o", openai.model)

        val deepseek = apiKeyStore.getConfig("deepseek")!!
        assertEquals("sk-deepseek-1", deepseek.apiKey)
        assertEquals("deepseek-chat", deepseek.model)

        val anthropic = apiKeyStore.getConfig("anthropic")!!
        assertEquals("sk-ant-1", anthropic.apiKey)
        assertEquals("claude-3-5-sonnet", anthropic.model)

        val qwen = apiKeyStore.getConfig("qwen")!!
        assertEquals("sk-qwen-1", qwen.apiKey)
        assertEquals("qwen-max", qwen.model)

        val gemini = apiKeyStore.getConfig("gemini")!!
        assertEquals("sk-gemini-1", gemini.apiKey)
        assertEquals("gemini-1.5-pro", gemini.model)

        // listConfiguredProviders 应返回全部 6 个
        val configured = apiKeyStore.listConfiguredProviders()
        assertEquals(6, configured.size)
        assertTrue(configured.containsAll(listOf("stepfun","openai","deepseek","anthropic","qwen","gemini")))
    }

    @Test
    fun `encrypted read back returns same config`() {
        val config = LlmProviderConfig(
            provider = "deepseek",
            apiKey = "sk-test-very-secret-key-12345",
            endpoint = "https://api.deepseek.com/v1",
            model = "deepseek-reasoner"
        )
        apiKeyStore.saveConfig("deepseek", config)

        val readBack = apiKeyStore.getConfig("deepseek")
        assertNotNull(readBack)
        assertEquals("deepseek", readBack!!.provider)
        assertEquals("sk-test-very-secret-key-12345", readBack.apiKey)
        assertEquals("https://api.deepseek.com/v1", readBack.endpoint)
        assertEquals("deepseek-reasoner", readBack.model)
    }

    @Test
    fun `switch active provider`() {
        apiKeyStore.saveConfig("stepfun", LlmProviderConfig("stepfun", "sk-1", "ep1", "m1"))
        apiKeyStore.saveConfig("openai", LlmProviderConfig("openai", "sk-2", "ep2", "m2"))

        // 初始无 active
        assertNull(apiKeyStore.getActiveProvider())

        // 设置 active 为 stepfun
        apiKeyStore.setActiveProvider("stepfun")
        assertEquals("stepfun", apiKeyStore.getActiveProvider())

        // 切换为 openai
        apiKeyStore.setActiveProvider("openai")
        assertEquals("openai", apiKeyStore.getActiveProvider())
    }

    @Test
    fun `clear removes all configs`() {
        apiKeyStore.saveConfig("stepfun", LlmProviderConfig("stepfun", "sk-1", "ep1", "m1"))
        apiKeyStore.saveConfig("openai", LlmProviderConfig("openai", "sk-2", "ep2", "m2"))
        apiKeyStore.setActiveProvider("stepfun")

        assertTrue(apiKeyStore.hasConfig("stepfun"))
        assertTrue(apiKeyStore.hasConfig("openai"))

        apiKeyStore.clear()

        assertFalse(apiKeyStore.hasConfig("stepfun"))
        assertFalse(apiKeyStore.hasConfig("openai"))
        assertNull(apiKeyStore.getActiveProvider())
        assertTrue(apiKeyStore.listConfiguredProviders().isEmpty())
    }

    @Test
    fun `hasConfig returns true for configured and false for unconfigured`() {
        assertFalse(apiKeyStore.hasConfig("stepfun"))
        assertFalse(apiKeyStore.hasConfig("openai"))

        apiKeyStore.saveConfig("stepfun", LlmProviderConfig("stepfun", "sk-1", "ep1", "m1"))

        assertTrue(apiKeyStore.hasConfig("stepfun"))
        assertFalse(apiKeyStore.hasConfig("openai"))
    }

    @Test
    fun `clearProvider removes only specified provider`() {
        apiKeyStore.saveConfig("stepfun", LlmProviderConfig("stepfun", "sk-1", "ep1", "m1"))
        apiKeyStore.saveConfig("openai", LlmProviderConfig("openai", "sk-2", "ep2", "m2"))

        apiKeyStore.clearProvider("stepfun")

        assertFalse(apiKeyStore.hasConfig("stepfun"))
        assertTrue(apiKeyStore.hasConfig("openai"))

        // openai 配置应未被破坏
        val openai = apiKeyStore.getConfig("openai")!!
        assertEquals("sk-2", openai.apiKey)
        assertEquals("m2", openai.model)
    }

    @Test
    fun `getConfig returns null when no config exists`() {
        assertNull(apiKeyStore.getConfig("stepfun"))
        assertNull(apiKeyStore.getConfig("openai"))
        assertNull(apiKeyStore.getConfig("deepseek"))
        assertNull(apiKeyStore.getConfig("anthropic"))
        assertNull(apiKeyStore.getConfig("qwen"))
        assertNull(apiKeyStore.getConfig("gemini"))
    }
}
