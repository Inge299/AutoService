package ru.autoservice.spike.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface FindingDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(finding: FindingEntity)

    @Update
    suspend fun update(finding: FindingEntity)

    @Query("SELECT * FROM findings WHERE visitId = :visitId ORDER BY createdAtEpochMs DESC")
    fun observeForVisit(visitId: String): Flow<List<FindingEntity>>

    @Query("SELECT * FROM findings ORDER BY createdAtEpochMs")
    suspend fun all(): List<FindingEntity>

    @Query(
        "UPDATE findings SET status = :status, updatedAtEpochMs = :updatedAt WHERE id = :findingId",
    )
    suspend fun updateStatus(findingId: String, status: FindingStatus, updatedAt: Long)
}
