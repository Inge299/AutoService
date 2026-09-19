package ru.autoservice.spike

import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.network.WorkshopRemote
import ru.autoservice.spike.network.WorkshopSnapshot
import ru.autoservice.spike.network.ApprovalLink
import ru.autoservice.spike.network.ReportLink

open class FakeWorkshopRemote : WorkshopRemote {
    val visits = mutableListOf<VisitEntity>()
    val findings = mutableListOf<FindingEntity>()

    override suspend fun loadWorkshop(): WorkshopSnapshot = WorkshopSnapshot(visits, findings)

    override suspend fun saveVisit(visit: VisitEntity): VisitEntity =
        visit.copy(syncState = SyncState.SYNCED, serverVersion = visit.serverVersion + 1).also {
            visits.removeAll { current -> current.id == it.id }
            visits += it
        }

    override suspend fun saveFinding(finding: FindingEntity): FindingEntity =
        finding.copy(serverVersion = finding.serverVersion + 1).also {
            findings.removeAll { current -> current.id == it.id }
            findings += it
        }

    override suspend fun createApprovalLink(
        findingId: String,
        operationId: String,
        token: String,
        mediaIds: List<String>,
        replaceActive: Boolean,
    ) = ApprovalLink("https://example.test/a/$token", 1_800_000L)

    override suspend fun completeFinding(findingId: String): FindingEntity =
        findings.first { it.id == findingId }.copy(status = ru.autoservice.spike.data.FindingStatus.COMPLETED).also { completed ->
            findings.removeAll { it.id == findingId }
            findings += completed
        }

    override suspend fun saveReport(
        visitId: String,
        completedWork: String,
        recommendations: String,
        nextVisitAtEpochMs: Long?,
    ) = Unit

    override suspend fun publishReport(visitId: String, operationId: String, token: String) =
        ReportLink("https://example.test/r/$token", 1_800_000L)

    override suspend fun revokeReportLink(visitId: String) = Unit

    override suspend fun uploadMedia(asset: MediaAssetEntity) = Unit

    override suspend fun deleteMedia(assetId: String) = Unit
}
