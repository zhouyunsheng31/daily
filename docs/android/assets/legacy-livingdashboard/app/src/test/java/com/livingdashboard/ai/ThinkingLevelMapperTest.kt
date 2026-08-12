package com.livingdashboard.ai

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 26 用例：6 provider × 4 等级 = 24 + parseProvider 2 用例。
 * 纯 JVM 测试，不需要 Robolectric。
 */
class ThinkingLevelMapperTest {

    private fun apply(provider: String, level: ThinkingLevel): JsonObject =
        buildJsonObject {
            ThinkingLevelMapper.applyToRequest(this, provider, level)
        }

    // ==================== deepseek: reasoning_effort ====================

    @Test
    fun `deepseek AUTO injects reasoning_effort low`() {
        val json = apply("deepseek", ThinkingLevel.AUTO)
        assertEquals("low", json["reasoning_effort"]!!.jsonPrimitive.content)
    }

    @Test
    fun `deepseek STANDARD injects reasoning_effort medium`() {
        val json = apply("deepseek", ThinkingLevel.STANDARD)
        assertEquals("medium", json["reasoning_effort"]!!.jsonPrimitive.content)
    }

    @Test
    fun `deepseek DEEP injects reasoning_effort high`() {
        val json = apply("deepseek", ThinkingLevel.DEEP)
        assertEquals("high", json["reasoning_effort"]!!.jsonPrimitive.content)
    }

    @Test
    fun `deepseek MAX injects reasoning_effort high`() {
        val json = apply("deepseek", ThinkingLevel.MAX)
        assertEquals("high", json["reasoning_effort"]!!.jsonPrimitive.content)
    }

    // ==================== qwen: thinking_budget ====================

    @Test
    fun `qwen AUTO does not inject thinking_budget`() {
        val json = apply("qwen", ThinkingLevel.AUTO)
        assertFalse(json.containsKey("thinking_budget"))
    }

    @Test
    fun `qwen STANDARD injects thinking_budget 4096`() {
        val json = apply("qwen", ThinkingLevel.STANDARD)
        assertEquals(4096, json["thinking_budget"]!!.jsonPrimitive.int)
    }

    @Test
    fun `qwen DEEP injects thinking_budget 8192`() {
        val json = apply("qwen", ThinkingLevel.DEEP)
        assertEquals(8192, json["thinking_budget"]!!.jsonPrimitive.int)
    }

    @Test
    fun `qwen MAX injects thinking_budget 16384`() {
        val json = apply("qwen", ThinkingLevel.MAX)
        assertEquals(16384, json["thinking_budget"]!!.jsonPrimitive.int)
    }

    // ==================== openai: reasoning.effort ====================

    @Test
    fun `openai AUTO injects reasoning effort low`() {
        val json = apply("openai", ThinkingLevel.AUTO)
        assertEquals("low", json["reasoning"]!!.jsonObject["effort"]!!.jsonPrimitive.content)
    }

    @Test
    fun `openai STANDARD injects reasoning effort medium`() {
        val json = apply("openai", ThinkingLevel.STANDARD)
        assertEquals("medium", json["reasoning"]!!.jsonObject["effort"]!!.jsonPrimitive.content)
    }

    @Test
    fun `openai DEEP injects reasoning effort high`() {
        val json = apply("openai", ThinkingLevel.DEEP)
        assertEquals("high", json["reasoning"]!!.jsonObject["effort"]!!.jsonPrimitive.content)
    }

    @Test
    fun `openai MAX injects reasoning effort high`() {
        val json = apply("openai", ThinkingLevel.MAX)
        assertEquals("high", json["reasoning"]!!.jsonObject["effort"]!!.jsonPrimitive.content)
    }

    // ==================== anthropic: thinking ====================

    @Test
    fun `anthropic AUTO does not inject thinking`() {
        val json = apply("anthropic", ThinkingLevel.AUTO)
        assertFalse(json.containsKey("thinking"))
    }

    @Test
    fun `anthropic STANDARD does not inject thinking`() {
        val json = apply("anthropic", ThinkingLevel.STANDARD)
        assertFalse(json.containsKey("thinking"))
    }

    @Test
    fun `anthropic DEEP injects thinking type enabled budget 8000`() {
        val json = apply("anthropic", ThinkingLevel.DEEP)
        val thinking = json["thinking"]!!.jsonObject
        assertEquals("enabled", thinking["type"]!!.jsonPrimitive.content)
        assertEquals(8000, thinking["budget_tokens"]!!.jsonPrimitive.int)
    }

    @Test
    fun `anthropic MAX injects thinking type enabled budget 16000`() {
        val json = apply("anthropic", ThinkingLevel.MAX)
        val thinking = json["thinking"]!!.jsonObject
        assertEquals("enabled", thinking["type"]!!.jsonPrimitive.content)
        assertEquals(16000, thinking["budget_tokens"]!!.jsonPrimitive.int)
    }

    // ==================== stepfun: temperature ====================

    @Test
    fun `stepfun AUTO injects temperature 0_5`() {
        val json = apply("stepfun", ThinkingLevel.AUTO)
        assertEquals(0.5, json["temperature"]!!.jsonPrimitive.double, 0.0001)
    }

    @Test
    fun `stepfun STANDARD injects temperature 0_3`() {
        val json = apply("stepfun", ThinkingLevel.STANDARD)
        assertEquals(0.3, json["temperature"]!!.jsonPrimitive.double, 0.0001)
    }

    @Test
    fun `stepfun DEEP injects temperature 0_2`() {
        val json = apply("stepfun", ThinkingLevel.DEEP)
        assertEquals(0.2, json["temperature"]!!.jsonPrimitive.double, 0.0001)
    }

    @Test
    fun `stepfun MAX injects temperature 0_1`() {
        val json = apply("stepfun", ThinkingLevel.MAX)
        assertEquals(0.1, json["temperature"]!!.jsonPrimitive.double, 0.0001)
    }

    // ==================== gemini: thinkingConfig ====================

    @Test
    fun `gemini AUTO does not inject thinkingConfig`() {
        val json = apply("gemini", ThinkingLevel.AUTO)
        assertFalse(json.containsKey("thinkingConfig"))
    }

    @Test
    fun `gemini STANDARD does not inject thinkingConfig`() {
        val json = apply("gemini", ThinkingLevel.STANDARD)
        assertFalse(json.containsKey("thinkingConfig"))
    }

    @Test
    fun `gemini DEEP injects thinkingConfig includeThoughts true`() {
        val json = apply("gemini", ThinkingLevel.DEEP)
        val thinkingConfig = json["thinkingConfig"]!!.jsonObject
        assertTrue(thinkingConfig["includeThoughts"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `gemini MAX injects thinkingConfig includeThoughts true`() {
        val json = apply("gemini", ThinkingLevel.MAX)
        val thinkingConfig = json["thinkingConfig"]!!.jsonObject
        assertTrue(thinkingConfig["includeThoughts"]!!.jsonPrimitive.boolean)
    }

    // ==================== parseProvider 分支 ====================

    @Test
    fun `parseProvider extracts provider from full model with slash`() {
        // "stepfun/step-3.7-flash" -> "stepfun"
        assertEquals("stepfun", ThinkingLevelMapper.parseProvider("stepfun/step-3.7-flash"))
        assertEquals("deepseek", ThinkingLevelMapper.parseProvider("deepseek/deepseek-chat"))
        assertEquals("qwen", ThinkingLevelMapper.parseProvider("qwen/qwen-max"))
    }

    @Test
    fun `parseProvider returns default stepfun when no slash`() {
        // "step-3.7-flash" (无 /) -> 默认 "stepfun"
        assertEquals("stepfun", ThinkingLevelMapper.parseProvider("step-3.7-flash"))
        assertEquals("stepfun", ThinkingLevelMapper.parseProvider("gpt-4o"))
        assertEquals("stepfun", ThinkingLevelMapper.parseProvider("deepseek-chat"))
    }
}
