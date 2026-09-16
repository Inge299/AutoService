package ru.autoservice.spike.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface MediaDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(asset: MediaAssetEntity)

    @Query("SELECT * FROM media_assets ORDER BY createdAtEpochMs DESC")
    fun observeAll(): Flow<List<MediaAssetEntity>>

    @Query("SELECT * FROM media_assets WHERE id = :id LIMIT 1")
    suspend fun find(id: String): MediaAssetEntity?

    @Query("SELECT * FROM media_assets WHERE findingId = :findingId ORDER BY createdAtEpochMs")
    suspend fun forFinding(findingId: String): List<MediaAssetEntity>

    @Query("SELECT localPath FROM media_assets")
    suspend fun allLocalPaths(): List<String>

    @Query("SELECT * FROM media_assets WHERE syncState IN ('LOCAL', 'QUEUED', 'RETRY', 'UPLOADING') ORDER BY createdAtEpochMs")
    suspend fun pending(): List<MediaAssetEntity>

    @Query(
        """
        UPDATE media_assets
        SET syncState = :state,
            uploadAttempts = :attempts,
            lastError = :error,
            updatedAtEpochMs = :updatedAt
        WHERE id = :id
        """,
    )
    suspend fun updateProgress(
        id: String,
        state: SyncState,
        attempts: Int,
        error: String?,
        updatedAt: Long,
    )

    @Query(
        """
        UPDATE media_assets
        SET syncState = 'SYNCED',
            remoteKey = :remoteKey,
            lastError = NULL,
            updatedAtEpochMs = :updatedAt
        WHERE id = :id
        """,
    )
    suspend fun markSynced(id: String, remoteKey: String, updatedAt: Long)

    @Transaction
    suspend fun markUploading(asset: MediaAssetEntity, now: Long) {
        updateProgress(
            id = asset.id,
            state = SyncState.UPLOADING,
            attempts = asset.uploadAttempts + 1,
            error = null,
            updatedAt = now,
        )
    }
}
