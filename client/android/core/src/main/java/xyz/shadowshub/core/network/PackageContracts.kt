package xyz.shadowshub.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class PackageSummary(
    val id: String,
    val type: String,
    val name: String,
    val icon: String? = null,
    val activeVersionId: String? = null,
    val installed: Boolean = true,
)

@Serializable
data class PackageVersionDetail(
    val id: String,
    val packageId: String,
    val version: String,
    val status: String,
    val manifest: JsonObject? = null,
    val createdAt: Long = 0L,
    val createdBy: String? = null,
)

@Serializable
data class PackageDetail(
    val id: String,
    val type: String,
    val name: String,
    val icon: String? = null,
    val activeVersionId: String? = null,
    val versions: List<PackageVersionDetail> = emptyList(),
)