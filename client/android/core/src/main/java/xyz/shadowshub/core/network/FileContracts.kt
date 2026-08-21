package xyz.shadowshub.core.network

import kotlinx.serialization.Serializable

@Serializable
data class FileManifestEntry(
    val path: String,
    val size: Long,
    val sha256: String,
    val updatedAt: Long,
)

@Serializable
data class FileManifestResponse(
    val ok: Boolean,
    val prefix: String = "",
    val files: List<FileManifestEntry> = emptyList(),
)

@Serializable
data class FileUploadInitResult(
    val ok: Boolean,
    val uploadId: String,
    val chunkSize: Int = 4194304,
)