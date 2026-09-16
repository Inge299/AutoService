package ru.autoservice.spike.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

enum class MediaKind {
    PHOTO,
    VIDEO,
    VOICE,
}

enum class SyncState {
    LOCAL,
    QUEUED,
    UPLOADING,
    SYNCED,
    RETRY,
    BLOCKED,
}

enum class VisitStatus {
    DRAFT,
    IN_REPAIR,
    WAITING_APPROVAL,
    COMPLETED,
    CANCELLED,
}

enum class DictionaryKind {
    VEHICLE_BRAND,
    COMPLAINT,
}

enum class FindingPriority {
    CRITICAL,
    IMPORTANT,
    PLANNED,
}

enum class FindingStatus {
    DRAFT,
    READY_FOR_APPROVAL,
    SENT_TO_CUSTOMER,
    APPROVED,
    DECLINED,
    CALL_REQUESTED,
    DEFERRED,
}

@Entity(tableName = "visits")
data class VisitEntity(
    @PrimaryKey val id: String,
    val customerName: String,
    val customerPhone: String,
    val vehicleLabel: String,
    val licensePlate: String,
    val mileageKm: Int?,
    val complaint: String,
    val status: VisitStatus,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val syncState: SyncState,
    val serverVersion: Int = 0,
)

@Entity(
    tableName = "media_assets",
    indices = [
        Index("visitId"),
        Index("findingId"),
        Index("syncState"),
        Index(value = ["operationId"], unique = true),
    ],
)
data class MediaAssetEntity(
    @PrimaryKey val id: String,
    val operationId: String,
    val visitId: String,
    val findingId: String?,
    val kind: MediaKind,
    val mimeType: String,
    val localPath: String,
    val byteCount: Long,
    val sha256: String,
    val syncState: SyncState,
    val uploadAttempts: Int,
    val remoteKey: String?,
    val lastError: String?,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
)

@Entity(
    tableName = "dictionary_values",
    indices = [Index(value = ["kind", "normalizedValue"], unique = true)],
)
data class DictionaryValueEntity(
    @PrimaryKey val id: String,
    val kind: DictionaryKind,
    val label: String,
    val normalizedValue: String,
    val usageCount: Int,
    val lastUsedAtEpochMs: Long,
)

@Entity(
    tableName = "findings",
    indices = [Index("visitId"), Index("status")],
)
data class FindingEntity(
    @PrimaryKey val id: String,
    val visitId: String,
    val title: String,
    val description: String,
    val priceRub: Int?,
    val priority: FindingPriority,
    val status: FindingStatus,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val serverVersion: Int = 0,
    val approvalOperationId: String? = null,
    val approvalToken: String? = null,
    val approvalPublicUrl: String? = null,
    val approvalExpiresAtEpochMs: Long? = null,
)
