package ru.autoservice.spike

import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.network.WorkshopRemote
import ru.autoservice.spike.network.WorkshopSnapshot
import ru.autoservice.spike.network.ApprovalLink

class FakeWorkshopRemote : WorkshopRemote {
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

    override suspend fun uploadMedia(asset: MediaAssetEntity) = Unit
}
