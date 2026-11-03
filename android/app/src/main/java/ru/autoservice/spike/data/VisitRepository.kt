package ru.autoservice.spike.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.autoservice.spike.network.ApiException
import ru.autoservice.spike.network.WorkshopSnapshot
import ru.autoservice.spike.network.WorkshopRemote
import java.util.UUID

class VisitRepository(
    private val visitDao: VisitDao,
    private val api: WorkshopRemote,
    private val clock: () -> Long = System::currentTimeMillis,
    private val syncMutex: Mutex = Mutex(),
    private val scheduleSync: () -> Unit = {},
) {
    val activeVisits = visitDao.observeActive()

    suspend fun createVisit(draft: VisitDraft): VisitEntity = syncMutex.withLock {
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
            pendingCustomerId = draft.customerId,
            pendingVehicleId = draft.vehicleId,
        )
        visitDao.upsert(visit)
        scheduleSync()
        visit
    }

    suspend fun startRepair(visit: VisitEntity) = syncMutex.withLock {
        val current = visitDao.find(visit.id) ?: visit
        require(current.status == VisitStatus.DRAFT) { "Ремонт уже начат" }
        require(current.syncState != SyncState.BLOCKED) { "Сначала устраните проблему синхронизации визита" }
        visitDao.upsert(current.copy(status = VisitStatus.IN_REPAIR, updatedAtEpochMs = clock(), syncState = SyncState.LOCAL))
        scheduleSync()
    }

    suspend fun correctUnsyncedVisit(id: String, draft: VisitDraft): VisitEntity = syncMutex.withLock {
        val current = requireNotNull(visitDao.find(id)) { "Визит не найден" }
        require(current.serverVersion == 0 && current.syncState == SyncState.BLOCKED) { "Исправить можно только несинхронизированный визит с ошибкой" }
        require(draft.customerPhone.count(Char::isDigit) >= 10) { "Укажите корректный телефон клиента" }
        require(draft.vehicleLabel.isNotBlank() || draft.licensePlate.isNotBlank()) { "Укажите автомобиль или госномер" }
        val corrected = current.copy(customerName = draft.customerName.trim(), customerPhone = normalizePhone(draft.customerPhone),
            vehicleLabel = draft.vehicleLabel.trim(), licensePlate = draft.licensePlate.trim().uppercase(), mileageKm = draft.mileageKm,
            complaint = draft.complaint.trim(), pendingCustomerId = draft.customerId, pendingVehicleId = draft.vehicleId,
            syncState = SyncState.LOCAL, syncError = null, updatedAtEpochMs = clock())
        visitDao.upsert(corrected)
        scheduleSync()
        corrected
    }

    suspend fun synchronizeLocal(): WorkshopSnapshot = syncMutex.withLock {
        visitDao.all().filter { it.syncState != SyncState.SYNCED && it.syncState != SyncState.BLOCKED || it.serverVersion == 0 && it.syncState != SyncState.BLOCKED }
            .forEach { local ->
                try {
                    val server = if (local.serverVersion == 0) api.saveIntake(local, local.pendingCustomerId, local.pendingVehicleId) else api.saveVisit(local)
                    visitDao.upsert(preserveDraft(server, local).copy(syncState = SyncState.SYNCED, syncError = null))
                } catch (error: ApiException) {
                    if (error.statusCode !in 400..499 || error.statusCode in setOf(401, 408, 429)) throw error
                    val message = when (error.message) {
                        "customer_identity_ambiguous" -> "Найдено несколько клиентов с этим телефоном. Выберите клиента."
                        "vehicle_identity_ambiguous" -> "Найдено несколько автомобилей. Выберите автомобиль или исправьте номер."
                        "customer_identity_mismatch" -> "Клиент и телефон не совпадают. Выберите клиента заново."
                        "vehicle_identity_mismatch" -> "Автомобиль не принадлежит выбранному клиенту. Выберите его заново."
                        "version_conflict" -> "Визит изменён на сервере. Обратитесь к администратору для сверки."
                        else -> "Визит не синхронизирован: проверьте данные или конфликт на сервере"
                    }
                    visitDao.upsert(local.copy(syncState = SyncState.BLOCKED, syncError = message))
                }
            }
        api.loadWorkshop().also { snapshot ->
            snapshot.visits.forEach { server ->
                val local = visitDao.find(server.id)
                if (local == null) visitDao.upsert(server)
                else if (local.syncState == SyncState.SYNCED) visitDao.upsert(preserveDraft(server, local))
            }
        }
    }

    private fun preserveDraft(server: VisitEntity, local: VisitEntity): VisitEntity = server.copy(
        reportOperationId = local.reportOperationId,
        reportToken = local.reportToken,
        reportPublicUrl = local.reportPublicUrl,
        reportExpiresAtEpochMs = local.reportExpiresAtEpochMs,
        reportPreparationState = local.reportPreparationState,
        reportCompletedWork = local.reportCompletedWork,
        reportRecommendations = local.reportRecommendations,
        reportNextVisitAtEpochMs = if (local.reportPreparationState in setOf("PENDING", "FAILED")) local.reportNextVisitAtEpochMs else server.reportNextVisitAtEpochMs,
        reportPreparationError = local.reportPreparationError,
        reportAcknowledgedPrivateFindingIds = local.reportAcknowledgedPrivateFindingIds,
        reportExpectedMediaIds = local.reportExpectedMediaIds,
        pendingCustomerId = local.pendingCustomerId,
        pendingVehicleId = local.pendingVehicleId,
        syncError = local.syncError,
    )

    private fun normalizePhone(value: String): String {
        val digits = value.filter(Char::isDigit)
        return when {
            digits.length == 11 && digits.startsWith("8") -> "+7${digits.drop(1)}"
            digits.length == 11 && digits.startsWith("7") -> "+$digits"
            digits.length == 10 -> "+7$digits"
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
    val customerId: String? = null,
    val vehicleId: String? = null,
)
