package ru.autoservice.spike.data

import ru.autoservice.spike.network.WorkshopSnapshot
import ru.autoservice.spike.network.WorkshopRemote
import java.util.UUID

class VisitRepository(
    private val visitDao: VisitDao,
    private val api: WorkshopRemote,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val activeVisits = visitDao.observeActive()

    suspend fun createVisit(draft: VisitDraft): VisitEntity {
        require(draft.customerPhone.count(Char::isDigit) >= 10) {
            "Укажите корректный телефон клиента"
        }
        require(draft.vehicleLabel.isNotBlank() || draft.licensePlate.isNotBlank()) {
            "Укажите автомобиль или госномер"
        }

        val now = clock()
        val visit = VisitEntity(
            id = UUID.randomUUID().toString(),
            customerName = draft.customerName.trim(),
            customerPhone = normalizePhone(draft.customerPhone),
            vehicleLabel = draft.vehicleLabel.trim(),
            licensePlate = draft.licensePlate.trim().uppercase(),
            mileageKm = draft.mileageKm,
            complaint = draft.complaint.trim(),
            status = VisitStatus.DRAFT,
            createdAtEpochMs = now,
            updatedAtEpochMs = now,
            syncState = SyncState.LOCAL,
        )
        val saved = api.saveVisit(visit)
        visitDao.upsert(saved)
        return saved
    }

    suspend fun startRepair(visit: VisitEntity) {
        require(visit.status == VisitStatus.DRAFT) { "Ремонт уже начат" }
        val saved = api.saveVisit(
            visit.copy(status = VisitStatus.IN_REPAIR, updatedAtEpochMs = clock()),
        )
        visitDao.upsert(saved)
    }

    suspend fun synchronizeLocal(): WorkshopSnapshot {
        visitDao.all()
            .filter { it.syncState != SyncState.SYNCED || it.serverVersion == 0 }
            .forEach { visitDao.upsert(api.saveVisit(it)) }
        return api.loadWorkshop().also { snapshot -> snapshot.visits.forEach { visitDao.upsert(it) } }
    }

    private fun normalizePhone(value: String): String {
        val digits = value.filter(Char::isDigit)
        return when {
            digits.length == 11 && digits.startsWith("8") -> "+7${digits.drop(1)}"
            digits.length == 11 && digits.startsWith("7") -> "+$digits"
            else -> "+$digits"
        }
    }
}

data class VisitDraft(
    val customerName: String,
    val customerPhone: String,
    val vehicleLabel: String,
    val licensePlate: String,
    val mileageKm: Int?,
    val complaint: String,
)
