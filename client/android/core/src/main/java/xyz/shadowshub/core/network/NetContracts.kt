package xyz.shadowshub.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class NetSpace(
    val id: String,
    val name: String,
    val ownerHandle: String,
    val mode: String = "private",
    val members: List<String> = emptyList(),
    val createdAt: Long = 0L,
)

@Serializable
data class NetEvent(
    val seq: Long,
    val spaceId: String,
    val fromHandle: String,
    val toHandle: String? = null,
    val type: String,
    val payload: JsonObject,
    val timestamp: Long,
)