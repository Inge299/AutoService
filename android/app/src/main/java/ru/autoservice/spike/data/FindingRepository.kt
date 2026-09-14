package ru.autoservice.spike.data

import ru.autoservice.spike.network.WorkshopRemote
import java.util.UUID

class FindingRepository(
    private val findingDao: FindingDao,
    private val api: WorkshopRemote,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    fun findingsForVisit(visitId: String) = findingDao.observeForVisit(visitId)

    suspend fun createFinding(draft: FindingDraft): FindingEntity {
        require(draft.title.isNotBlank()) { "Укажите, что обнаружено" }
        require(draft.priceRub == null || draft.priceRub >= 0) { "Укажите корректную цену" }

        val now = clock()
        val finding = FindingEntity(
            id = UUID.randomUUID().toString(),
            visitId = draft.visitId,
            title = draft.title.trim(),
            description = draft.description.trim(),
            priceRub = draft.priceRub,
            priority = draft.priority,
            status = FindingStatus.DRAFT,
            createdAtEpochMs = now,
            updatedAtEpochMs = now,
        )
        val saved = api.saveFinding(finding)
        findingDao.insert(saved)
        return saved
    }

    suspend fun prepareForApproval(finding: FindingEntity) {
        require(finding.status == FindingStatus.DRAFT) { "Находка уже подготовлена" }
        require(finding.priceRub != null) { "Укажите цену перед согласованием" }
        findingDao.update(api.saveFinding(
            finding.copy(status = FindingStatus.READY_FOR_APPROVAL, updatedAtEpochMs = clock()),
        ))
    }

    suspend fun updateDraft(finding: FindingEntity, draft: FindingDraft): FindingEntity {
        require(finding.status == FindingStatus.DRAFT) { "Изменять можно только черновик" }
        require(draft.title.isNotBlank()) { "Укажите, что обнаружено" }
        require(draft.priceRub == null || draft.priceRub >= 0) { "Укажите корректную цену" }
        val updated = finding.copy(
            title = draft.title.trim(),
            description = draft.description.trim(),
            priceRub = draft.priceRub,
            priority = draft.priority,
            updatedAtEpochMs = clock(),
        )
        val saved = api.saveFinding(updated)
        findingDao.update(saved)
        return saved
    }

    suspend fun recordCustomerDecision(finding: FindingEntity, decision: FindingStatus) {
        require(decision in customerDecisions) { "Некорректное решение клиента" }
        require(finding.status in setOf(FindingStatus.READY_FOR_APPROVAL, FindingStatus.SENT_TO_CUSTOMER)) {
            "Находка не готова к решению клиента"
        }
        findingDao.update(api.saveFinding(
            finding.copy(status = decision, updatedAtEpochMs = clock()),
        ))
    }

    suspend fun synchronizeLocal(serverFindings: List<FindingEntity>) {
        findingDao.all()
            .filter { it.serverVersion == 0 }
            .forEach { findingDao.update(api.saveFinding(it)) }
        serverFindings.forEach { remote ->
            val local = findingDao.all().firstOrNull { it.id == remote.id }
            if (local == null) findingDao.insert(remote) else findingDao.update(remote)
        }
    }

    private companion object {
        val customerDecisions = setOf(
            FindingStatus.APPROVED,
            FindingStatus.DECLINED,
            FindingStatus.CALL_REQUESTED,
            FindingStatus.DEFERRED,
        )
    }
}

data class FindingDraft(
    val visitId: String,
    val title: String,
    val description: String,
    val priceRub: Int?,
    val priority: FindingPriority,
)
