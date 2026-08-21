package xyz.shadowshub.core.network

import kotlinx.serialization.Serializable

@Serializable
enum class ThinkingLevel(val value: String, val label: String) {
    LOW("low", "浅"),
    MEDIUM("medium", "中"),
    HIGH("high", "深"),
    MAX("max", "极深"),
}

@Serializable
data class DesignTokens(
    val color: Map<String, String> = emptyMap(),
    val shape: Map<String, Int> = emptyMap(),
    val blur: Map<String, Int> = emptyMap(),
    val motion: Map<String, String> = emptyMap(),
)

@Serializable
data class TimeInfo(
    val iso: String,
    val timestamp: Long,
    val beijing: String,
    val weekday: String,
    val timezone: String = "Asia/Shanghai",
)
