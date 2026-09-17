package ru.autoservice.spike.data

import ru.autoservice.spike.network.WorkshopRemote
import ru.autoservice.spike.network.ApprovalLink
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID

class FindingRepository(
    private val findingDao: FindingDao,
    private val mediaDao: MediaDao,
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

    suspend fun createApprovalLink(finding: FindingEntity, replaceActive: Boolean = false): ApprovalLink {
        if (!replaceActive && finding.status == FindingStatus.SENT_TO_CUSTOMER && finding.approvalPublicUrl != null) {
            return ApprovalLink(
                publicUrl = finding.approvalPublicUrl,
                expiresAtEpochMs = finding.approvalExpiresAtEpochMs ?: 0L,
            )
        }
        require(
            finding.status == FindingStatus.READY_FOR_APPROVAL ||
                (replaceActive && finding.status == FindingStatus.SENT_TO_CUSTOMER),
        ) { "Находка не готова к отправке" }
        require(finding.priceRub != null) { "Укажите цену перед согласованием" }
        val mediaIds = mediaDao.forFinding(finding.id)
            .filter { it.syncState == SyncState.SYNCED }
            .map { it.id }

        val pending = finding.copy(
            approvalOperationId = if (replaceActive) UUID.randomUUID().toString()
                else finding.approvalOperationId ?: UUID.randomUUID().toString(),
            approvalToken = if (replaceActive) newApprovalToken() else finding.approvalToken ?: newApprovalToken(),
        )
        if (pending != finding) findingDao.update(pending)
        val link = api.createApprovalLink(
            findingId = pending.id,
            operationId = requireNotNull(pending.approvalOperationId),
            token = requireNotNull(pending.approvalToken),
            mediaIds = mediaIds,
            replaceActive = replaceActive,
        )
        findingDao.update(
            pending.copy(
                status = FindingStatus.SENT_TO_CUSTOMER,
                approvalPublicUrl = link.publicUrl,
                approvalExpiresAtEpochMs = link.expiresAtEpochMs,
                updatedAtEpochMs = clock(),
            ),
        )
        return link
    }

    suspend fun renewApprovalLink(finding: FindingEntity): ApprovalLink {
        require(finding.status == FindingStatus.SENT_TO_CUSTOMER) {
            "Обновить можно только отправленное согласование"
        }
        // The server revokes the old token and creates the new immutable
        // snapshot in one transaction, so a transport failure keeps the old link usable.
        return createApprovalLink(finding, replaceActive = true)
    }

    suspend fun synchronizeLocal(serverFindings: List<FindingEntity>) {
        findingDao.all()
            .filter { it.serverVersion == 0 }
            .forEach { findingDao.update(api.saveFinding(it)) }
        serverFindings.forEach { remote ->
            val local = findingDao.all().firstOrNull { it.id == remote.id }
            if (local == null) {
                findingDao.insert(remote)
            } else {
                findingDao.update(remote.copy(
                    approvalOperationId = local.approvalOperationId,
                    approvalToken = local.approvalToken,
                    approvalPublicUrl = local.approvalPublicUrl,
                    approvalExpiresAtEpochMs = local.approvalExpiresAtEpochMs,
                ))
            }
        }
    }

    private fun newApprovalToken(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}

data class FindingDraft(
    val visitId: String,
    val title: String,
    val description: String,
    val priceRub: Int?,
    val priority: FindingPriority,
)
