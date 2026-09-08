package ru.autoservice.spike.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.Locale
import java.util.UUID

object SeededQuickValues {
    val vehicleBrands = listOf(
        "Lada", "Kia", "Hyundai", "Toyota", "Renault", "Volkswagen", "Skoda", "Chery", "Haval", "Geely",
    )
    val complaints = listOf(
        "Стук", "Тормоза", "Подвеска", "Течь масла", "Двигатель", "Электрика", "Кондиционер", "ТО",
    )

    fun forKind(kind: DictionaryKind): List<String> = when (kind) {
        DictionaryKind.VEHICLE_BRAND -> vehicleBrands
        DictionaryKind.COMPLAINT -> complaints
    }
}

class LocalDictionaryRepository(
    private val dictionaryDao: DictionaryDao,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    fun suggestions(kind: DictionaryKind): Flow<List<String>> =
        dictionaryDao.observeByKind(kind).map { localValues ->
            (localValues.map(DictionaryValueEntity::label) + SeededQuickValues.forKind(kind))
                .distinctBy(::normalize)
        }

    suspend fun record(kind: DictionaryKind, rawValue: String) {
        val label = rawValue.trim().replace(Regex("\\s+"), " ")
        if (label.isBlank()) return

        val normalized = normalize(label)
        val now = clock()
        val existing = dictionaryDao.find(kind, normalized)
        if (existing == null) {
            dictionaryDao.insert(
                DictionaryValueEntity(
                    id = UUID.randomUUID().toString(),
                    kind = kind,
                    label = label,
                    normalizedValue = normalized,
                    usageCount = 1,
                    lastUsedAtEpochMs = now,
                ),
            )
        } else {
            dictionaryDao.update(
                existing.copy(
                    label = label,
                    usageCount = existing.usageCount + 1,
                    lastUsedAtEpochMs = now,
                ),
            )
        }
    }

    suspend fun recordVisitValues(draft: VisitDraft) {
        extractVehicleBrand(draft.vehicleLabel)?.let { record(DictionaryKind.VEHICLE_BRAND, it) }
        draft.complaint
            .split(',')
            .map(String::trim)
            .filter(String::isNotBlank)
            .forEach { record(DictionaryKind.COMPLAINT, it) }
    }

    private fun extractVehicleBrand(vehicle: String): String? {
        val value = vehicle.trim()
        if (value.isBlank()) return null
        return SeededQuickValues.vehicleBrands.firstOrNull {
            value.startsWith(it, ignoreCase = true)
        } ?: value.substringBefore(' ')
    }
}

private fun normalize(value: String): String =
    value.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")
