package ru.autoservice.spike.data

import java.util.UUID

class VisitRepository(
    private val visitDao: VisitDao,
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
        visitDao.upsert(visit)
        return visit
    }

    suspend fun startRepair(visit: VisitEntity) {
        require(visit.status == VisitStatus.DRAFT) { "Ремонт уже начат" }
        visitDao.updateStatus(visit.id, VisitStatus.IN_REPAIR, clock())
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
