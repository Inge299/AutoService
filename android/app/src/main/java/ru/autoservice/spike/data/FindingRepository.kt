package ru.autoservice.spike.data

import java.util.UUID

class FindingRepository(
    private val findingDao: FindingDao,
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
        findingDao.insert(finding)
        return finding
    }

    suspend fun prepareForApproval(finding: FindingEntity) {
        require(finding.status == FindingStatus.DRAFT) { "Находка уже подготовлена" }
        require(finding.priceRub != null) { "Укажите цену перед согласованием" }
        findingDao.updateStatus(
            findingId = finding.id,
            status = FindingStatus.READY_FOR_APPROVAL,
            updatedAt = clock(),
        )
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
        findingDao.update(updated)
        return updated
    }

    suspend fun recordCustomerDecision(finding: FindingEntity, decision: FindingStatus) {
        require(decision in customerDecisions) { "Некорректное решение клиента" }
        require(finding.status in setOf(FindingStatus.READY_FOR_APPROVAL, FindingStatus.SENT_TO_CUSTOMER)) {
            "Находка не готова к решению клиента"
        }
        findingDao.updateStatus(finding.id, decision, clock())
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
