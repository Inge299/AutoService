package ru.autoservice.spike.data

import ru.autoservice.spike.network.WorkshopRemote
import ru.autoservice.spike.network.ApprovalLink
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.io.IOException

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
        require(finding.status == FindingStatus.DRAFT && finding.approvalPreparationState != "PENDING") { "Дождитесь подготовки согласования" }
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

    suspend fun queueApproval(finding: FindingEntity) {
        require(finding.priceRub != null) { "Укажите цену перед согласованием" }
        require(finding.status in setOf(FindingStatus.DRAFT, FindingStatus.READY_FOR_APPROVAL, FindingStatus.SENT_TO_CUSTOMER)) { "Решение клиента уже получено" }
        val current = findingDao.all().firstOrNull { it.id == finding.id } ?: finding
        if (current.approvalPreparationState == "PENDING") return
        val media = mediaDao.forFinding(finding.id)
        require(media.isNotEmpty()) { "Добавьте материалы перед подготовкой ссылки" }
        require(media.size <= 20) { "В одном согласовании может быть до 20 материалов" }
        val retry = current.approvalPreparationState == "FAILED"
        findingDao.update(current.copy(
            approvalOperationId = if (retry) current.approvalOperationId else UUID.randomUUID().toString(),
            approvalToken = if (retry) current.approvalToken else newApprovalToken(),
            approvalPreparationState = "PENDING",
            approvalPendingMediaIds = if (retry) current.approvalPendingMediaIds else media.joinToString(",") { it.id },
            approvalPreparationError = null,
            approvalReplaceActive = if (retry) current.approvalReplaceActive else current.status == FindingStatus.SENT_TO_CUSTOMER,
        ))
    }

    suspend fun processPending(findingId: String) {
        var finding = findingDao.all().firstOrNull { it.id == findingId } ?: return
        if (finding.approvalPreparationState != "PENDING") return
        val ids = finding.approvalPendingMediaIds.orEmpty().split(",").filter { it.isNotBlank() }
        require(ids.isNotEmpty()) { "Набор материалов пуст" }
        val assets = mediaDao.forFinding(findingId).associateBy { it.id }
        require(ids.all { it in assets }) { "Материал удалён. Подготовьте новое согласование" }
        require(ids.none { assets[it]?.syncState == SyncState.BLOCKED }) { "Повторите загрузку материалов" }
        if (ids.any { assets[it]?.syncState != SyncState.SYNCED }) throw IOException("Материалы загружаются")
        if (finding.status == FindingStatus.DRAFT) {
            finding = api.saveFinding(finding.copy(status = FindingStatus.READY_FOR_APPROVAL)).copy(
                approvalOperationId = finding.approvalOperationId, approvalToken = finding.approvalToken,
                approvalPreparationState = finding.approvalPreparationState, approvalPendingMediaIds = finding.approvalPendingMediaIds,
                approvalReplaceActive = finding.approvalReplaceActive,
            )
            findingDao.update(finding)
        }
        createApprovalLink(finding, finding.approvalReplaceActive)
    }

    suspend fun preparationFailed(id: String, message: String) {
        val finding = findingDao.all().firstOrNull { it.id == id } ?: return
        findingDao.update(finding.copy(approvalPreparationState = "FAILED", approvalPreparationError = message))
    }

    suspend fun markCompleted(finding: FindingEntity): FindingEntity {
        require(finding.status == FindingStatus.APPROVED) { "Выполнить можно только согласованную работу" }
        return api.completeFinding(finding.id).also { findingDao.update(it) }
    }

    suspend fun createApprovalLink(finding: FindingEntity, replaceActive: Boolean = false): ApprovalLink {
        if (!replaceActive && finding.approvalPreparationState != "PENDING" && finding.status == FindingStatus.SENT_TO_CUSTOMER && finding.approvalPublicUrl != null) {
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
        val assets = mediaDao.forFinding(finding.id)
        val mediaIds = finding.approvalPendingMediaIds?.split(",")?.filter { it.isNotBlank() } ?: assets.map { it.id }
        require(mediaIds.isNotEmpty()) { "Добавьте материалы перед согласованием" }
        require(mediaIds.all { id -> assets.any { it.id == id && it.syncState == SyncState.SYNCED } }) { "Дождитесь загрузки всех выбранных материалов" }

        val pending = finding.copy(
            approvalOperationId = if (replaceActive && finding.approvalPreparationState != "PENDING") UUID.randomUUID().toString()
                else finding.approvalOperationId ?: UUID.randomUUID().toString(),
            approvalToken = if (replaceActive && finding.approvalPreparationState != "PENDING") newApprovalToken() else finding.approvalToken ?: newApprovalToken(),
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
                approvalPreparationState = "READY",
                approvalPreparationError = null,
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
                    approvalPreparationState = local.approvalPreparationState,
                    approvalPendingMediaIds = local.approvalPendingMediaIds,
                    approvalPreparationError = local.approvalPreparationError,
                    approvalReplaceActive = local.approvalReplaceActive,
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
