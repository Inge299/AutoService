package ru.autoservice.spike.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface VisitDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(visit: VisitEntity)

    @Query("SELECT * FROM visits ORDER BY updatedAtEpochMs DESC")
    fun observeAll(): Flow<List<VisitEntity>>

    @Query("SELECT * FROM visits WHERE status NOT IN ('COMPLETED', 'CANCELLED') ORDER BY updatedAtEpochMs DESC")
    fun observeActive(): Flow<List<VisitEntity>>

    @Query("SELECT * FROM visits WHERE id = :id LIMIT 1")
    suspend fun find(id: String): VisitEntity?

    @Query("UPDATE visits SET status = :status, updatedAtEpochMs = :updatedAt WHERE id = :visitId")
    suspend fun updateStatus(visitId: String, status: VisitStatus, updatedAt: Long)
}
