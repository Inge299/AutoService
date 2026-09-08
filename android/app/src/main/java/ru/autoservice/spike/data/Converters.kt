package ru.autoservice.spike.data

import androidx.room.TypeConverter

class Converters {
    @TypeConverter
    fun mediaKindToString(value: MediaKind): String = value.name

    @TypeConverter
    fun stringToMediaKind(value: String): MediaKind = MediaKind.valueOf(value)

    @TypeConverter
    fun syncStateToString(value: SyncState): String = value.name

    @TypeConverter
    fun stringToSyncState(value: String): SyncState = SyncState.valueOf(value)

    @TypeConverter
    fun visitStatusToString(value: VisitStatus): String = value.name

    @TypeConverter
    fun stringToVisitStatus(value: String): VisitStatus = VisitStatus.valueOf(value)

    @TypeConverter
    fun dictionaryKindToString(value: DictionaryKind): String = value.name

    @TypeConverter
    fun stringToDictionaryKind(value: String): DictionaryKind = DictionaryKind.valueOf(value)

    @TypeConverter
    fun findingPriorityToString(value: FindingPriority): String = value.name

    @TypeConverter
    fun stringToFindingPriority(value: String): FindingPriority = FindingPriority.valueOf(value)

    @TypeConverter
    fun findingStatusToString(value: FindingStatus): String = value.name

    @TypeConverter
    fun stringToFindingStatus(value: String): FindingStatus = FindingStatus.valueOf(value)
}
