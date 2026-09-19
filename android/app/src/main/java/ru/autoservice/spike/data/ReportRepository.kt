package ru.autoservice.spike.data

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
)

class ReportRepository(
    private val visitDao: VisitDao,
    private val api: WorkshopRemote,
) {
    suspend fun queuePublication(visit: VisitEntity, draft: ReportDraft): VisitEntity {
        require(visit.status == VisitStatus.IN_REPAIR || visit.status == VisitStatus.WAITING_APPROVAL) {
            "Завершить можно только ремонт в работе"
        }
        require(draft.completedWork.trim().isNotEmpty()) { "Опишите выполненные работы" }

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
        )
        visitDao.upsert(pending)
        return pending
    }

    suspend fun publishPending(visitId: String): ReportLink {
        val pending = visitDao.find(visitId) ?: throw IllegalArgumentException("Визит не найден")
        require(pending.reportPreparationState == "PENDING") { "Нет отчёта для публикации" }
        val operationId = requireNotNull(pending.reportOperationId)
        val token = requireNotNull(pending.reportToken)

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
            api.publishReport(pending.id, operationId, token)
        } catch (error: ApiException) {
            if (error.statusCode != 409 || error.message != "report_already_published") throw error
            api.publishReport(pending.id, operationId, token)
        }
        visitDao.upsert(pending.copy(
            status = VisitStatus.COMPLETED,
            reportPublicUrl = link.publicUrl,
            reportExpiresAtEpochMs = link.expiresAtEpochMs,
            reportPreparationState = "READY",
            reportPreparationError = null,
        ))
        return link
    }

    suspend fun markFailed(visitId: String, message: String) {
        val visit = visitDao.find(visitId) ?: return
        visitDao.upsert(visit.copy(reportPreparationState = "FAILED", reportPreparationError = message))
    }

    suspend fun revokePublished(visit: VisitEntity) {
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
        ))
    }

    private fun newReportToken(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}
