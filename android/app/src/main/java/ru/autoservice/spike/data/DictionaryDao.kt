package ru.autoservice.spike.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface DictionaryDao {
    @Query(
        "SELECT * FROM dictionary_values WHERE kind = :kind " +
            "ORDER BY usageCount DESC, lastUsedAtEpochMs DESC",
    )
    fun observeByKind(kind: DictionaryKind): Flow<List<DictionaryValueEntity>>

    @Query(
        "SELECT * FROM dictionary_values WHERE kind = :kind AND normalizedValue = :normalizedValue LIMIT 1",
    )
    suspend fun find(kind: DictionaryKind, normalizedValue: String): DictionaryValueEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(value: DictionaryValueEntity)

    @Update
    suspend fun update(value: DictionaryValueEntity)
}
