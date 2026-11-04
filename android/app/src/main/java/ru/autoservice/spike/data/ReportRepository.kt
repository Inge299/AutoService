package ru.autoservice.spike.data

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ru.autoservice.spike.network.ApiException
import ru.autoservice.spike.network.ReportLink
import ru.autoservice.spike.network.WorkshopRemote
import java.util.Base64
import java.security.SecureRandom
import java.util.UUID

data class ReportDraft(
    val completedWork: String,
    val recommendations: String,
    val nextVisitAtEpochMs: Long?,
    val acknowledgedPrivateFindingIds: List<String> = emptyList(),
    val expectedMediaIds: List<String> = emptyList(),
    val recommendedPrivateFindingIds: List<String> = emptyList(),
)

class ReportMediaReadinessException(message: String) : IllegalStateException(message)

class ReportRepository(
    private val visitDao: VisitDao,
    private val api: WorkshopRemote,
    private val hasUnsyncedFindings: suspend (String) -> Boolean = { false },
    private val syncMutex: Mutex = Mutex(),
    private val loadMedia: suspend (String) -> List<MediaAssetEntity>,
) {
    suspend fun queuePublication(visit: VisitEntity, draft: ReportDraft): VisitEntity = syncMutex.withLock {
        require(visit.status == VisitStatus.IN_REPAIR || visit.status == VisitStatus.WAITING_APPROVAL) {
            "Завершить можно только ремонт в работе"
        }
        require(draft.completedWork.trim().isNotEmpty()) { "Опишите выполненные работы" }
        require(draft.recommendedPrivateFindingIds.all { it in draft.acknowledgedPrivateFindingIds }) {
            "Список рекомендаций изменился. Проверьте отчёт заново"
        }

        val current = visitDao.find(visit.id) ?: visit
        val retry = current.reportPreparationState in setOf("PENDING", "FAILED")
        val pending = current.copy(
            reportOperationId = if (retry) current.reportOperationId else UUID.randomUUID().toString(),
            reportToken = if (retry) current.reportToken else newReportToken(),
            reportPreparationState = "PENDING",
            reportCompletedWork = draft.completedWork.trim(),
            reportRecommendations = draft.recommendations.trim(),
            reportNextVisitAtEpochMs = draft.nextVisitAtEpochMs,
            reportPreparationError = null,
            reportAcknowledgedPrivateFindingIds = encodeIds(draft.acknowledgedPrivateFindingIds),
            reportExpectedMediaIds = encodeIds(draft.expectedMediaIds),
            reportRecommendedPrivateFindingIds = encodeIds(draft.recommendedPrivateFindingIds),
        )
        visitDao.upsert(pending)
        if (!retry) checkMedia(pending)
        pending
    }

    suspend fun publishPending(visitId: String): ReportLink = syncMutex.withLock {
        val pending = visitDao.find(visitId) ?: throw IllegalArgumentException("Визит не найден")
        require(pending.reportPreparationState == "PENDING") { "Нет отчёта для публикации" }
        val operationId = requireNotNull(pending.reportOperationId)
        val token = requireNotNull(pending.reportToken)
        if (!api.supportsExplicitRecommendations()) {
            throw ReportMediaReadinessException("Сервер нужно обновить перед публикацией отчёта. Черновик сохранён")
        }
        val existing = api.recoverReport(pending.id, operationId, token)
        if (existing != null) return@withLock completePublication(pending, existing)
        val acknowledged = decodeIds(pending.reportAcknowledgedPrivateFindingIds)
        val expectedMedia = pending.reportExpectedMediaIds?.let(::decodeIds)
            ?: throw ReportMediaReadinessException("Откройте отчёт заново и проверьте материалы")
        checkMedia(pending)
        val recommended = decodeIds(pending.reportRecommendedPrivateFindingIds)

        // Saving comes first so a previously edited draft is never published by accident.
        // If the publish response was lost, saving returns report_already_published; the
        // same operation then retrieves the immutable version without creating another one.
        val link = try {
            api.saveReport(
                visitId = pending.id,
                completedWork = pending.reportCompletedWork.orEmpty(),
                recommendations = pending.reportRecommendations.orEmpty(),
                nextVisitAtEpochMs = pending.reportNextVisitAtEpochMs,
            )
            api.publishReport(pending.id, operationId, token, acknowledged, expectedMedia, recommended)
        } catch (error: ApiException) {
            if (error.statusCode != 409 || error.message != "report_already_published") throw error
            api.publishReport(pending.id, operationId, token, acknowledged, expectedMedia, recommended)
        }
        completePublication(pending, link)
    }

    private suspend fun completePublication(pending: VisitEntity, link: ReportLink): ReportLink {
        visitDao.upsert(pending.copy(
            status = VisitStatus.COMPLETED,
            reportPublicUrl = link.publicUrl,
            reportExpiresAtEpochMs = link.expiresAtEpochMs,
            reportPreparationState = "READY",
            reportPreparationError = null,
        ))
        return link
    }

    suspend fun markFailed(visitId: String, message: String) = syncMutex.withLock {
        val visit = visitDao.find(visitId) ?: return@withLock
        visitDao.upsert(visit.copy(reportPreparationState = "FAILED", reportPreparationError = message))
    }

    suspend fun revokePublished(visit: VisitEntity) = syncMutex.withLock {
        require(visit.status == VisitStatus.COMPLETED && visit.reportPublicUrl != null) { "Нет опубликованного отчёта" }
        api.revokeReportLink(visit.id)
        visitDao.upsert(visit.copy(
            status = VisitStatus.IN_REPAIR,
            reportOperationId = null,
            reportToken = null,
            reportPublicUrl = null,
            reportExpiresAtEpochMs = null,
            reportPreparationState = null,
            reportPreparationError = null,
            reportAcknowledgedPrivateFindingIds = null,
            reportExpectedMediaIds = null,
            reportRecommendedPrivateFindingIds = null,
        ))
    }

    private suspend fun checkMedia(visit: VisitEntity) {
        if (visit.syncState != SyncState.SYNCED || hasUnsyncedFindings(visit.id)) {
            throw ReportMediaReadinessException("Дождитесь синхронизации визита и всех находок перед публикацией")
        }
        val privateIds = decodeIds(visit.reportAcknowledgedPrivateFindingIds).toSet()
        val expected = visit.reportExpectedMediaIds?.let(::decodeIds)?.toSet()
            ?: throw ReportMediaReadinessException("Откройте отчёт заново и проверьте материалы")
        val relevant = loadMedia(visit.id).filter { it.findingId == null || it.findingId !in privateIds }
        if (relevant.any { it.syncState != SyncState.SYNCED }) {
            throw ReportMediaReadinessException("Дождитесь загрузки всех материалов для отчёта")
        }
        if (relevant.map { it.id }.toSet() != expected) {
            throw ReportMediaReadinessException("Список материалов изменился. Откройте отчёт заново")
        }
    }

    private fun encodeIds(ids: List<String>): String {
        ids.forEach { require(UUID.fromString(it).toString().equals(it, ignoreCase = true)) { "Некорректный идентификатор находки" } }
        return ids.joinToString(",")
    }

    private fun decodeIds(value: String?): List<String> =
        if (value.isNullOrEmpty()) emptyList() else value.split(",").also { encodeIds(it) }

    private fun newReportToken(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}
