package xyz.shadowshub.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class MarketItem(
    val id: String,
    val type: String,
    val name: String,
    val description: String = "",
    val icon: String? = null,
    val author: String = "",
    val installed: Boolean = false,
    val capabilities: List<String> = emptyList(),
)

@Serializable
data class MarketListing(
    val items: List<MarketItem> = emptyList(),
    val total: Int = 0,
)