package ru.autoservice.spike

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.autoservice.spike.data.*
import ru.autoservice.spike.network.*

@RunWith(AndroidJUnit4::class)
class OfflineIntakeDeviceTest {
    @Test fun localIntakeAndFindingSurviveDatabaseReopenAndSyncInOrder() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "synthetic-offline-intake-12.db"
        context.deleteDatabase(name)
        fun open() = Room.databaseBuilder(context, AppDatabase::class.java, name).build()
        val remote = SyntheticRemote()
        var database = open()
        try {
            val visit = VisitRepository(database.visitDao(), remote, clock = { 100L }).createVisit(
                VisitDraft("Synthetic", "9991234567", "QA car", "А123АА77", null, "Noise", "customer-qa", "vehicle-qa"))
            val finding = FindingRepository(database.findingDao(), database.mediaDao(), remote, clock = { 101L }).createFinding(
                FindingDraft(visit.id, "Synthetic finding", "Local data", null, FindingPriority.PLANNED))
            VisitRepository(database.visitDao(), remote, clock = { 102L }).startRepair(visit)
            database.mediaDao().insert(MediaAssetEntity("media-qa", "operation-qa", visit.id, finding.id, MediaKind.PHOTO,
                "image/jpeg", "/synthetic/offline.jpg", 5L, "a".repeat(64), SyncState.QUEUED, 0, null, null, 100L, 100L))
            assertEquals(0, remote.visits.size)
            database.close()
            database = open()
            val restored = requireNotNull(database.visitDao().find(visit.id))
            assertEquals("customer-qa", restored.pendingCustomerId)
            assertEquals("vehicle-qa", restored.pendingVehicleId)
            assertEquals(VisitStatus.IN_REPAIR, restored.status)
            assertEquals(finding.id, database.findingDao().all().single().id)
            assertEquals(finding.id, database.mediaDao().find("media-qa")?.findingId)
            val snapshot = VisitRepository(database.visitDao(), remote).synchronizeLocal()
            FindingRepository(database.findingDao(), database.mediaDao(), remote,
                parentReady = { database.visitDao().find(it)?.syncState == SyncState.SYNCED }).synchronizeLocal(snapshot.findings)
            assertEquals(listOf("visit", "finding"), remote.order)
            assertEquals("customer-qa" to "vehicle-qa", remote.selected)
            assertEquals(1, remote.visits.count { it.id == visit.id })
            assertEquals(1, remote.findings.count { it.id == finding.id })
            assertEquals(SyncState.QUEUED, database.mediaDao().find("media-qa")?.syncState)
        } finally {
            database.close()
            context.deleteDatabase(name)
        }
    }

    private class SyntheticRemote : WorkshopRemote {
        val visits = mutableListOf<VisitEntity>()
        val findings = mutableListOf<FindingEntity>()
        val order = mutableListOf<String>()
        var selected: Pair<String?, String?>? = null
        override suspend fun loadWorkshop() = WorkshopSnapshot(visits.toList(), findings.toList())
        override suspend fun saveVisit(visit: VisitEntity): VisitEntity {
            order += "visit"
            return visit.copy(serverVersion = 1, syncState = SyncState.SYNCED).also { visits += it }
        }
        override suspend fun saveIntake(visit: VisitEntity, customerId: String?, vehicleId: String?): VisitEntity {
            selected = customerId to vehicleId
            return saveVisit(visit)
        }
        override suspend fun saveFinding(finding: FindingEntity): FindingEntity {
            check(visits.any { it.id == finding.visitId })
            order += "finding"
            return finding.copy(serverVersion = 1).also { findings += it }
        }
        override suspend fun createApprovalLink(findingId: String, operationId: String, token: String, mediaIds: List<String>, replaceActive: Boolean): ApprovalLink = error("not used")
        override suspend fun completeFinding(findingId: String): FindingEntity = error("not used")
        override suspend fun saveReport(visitId: String, completedWork: String, recommendations: String, nextVisitAtEpochMs: Long?) = Unit
        override suspend fun recoverReport(visitId: String, operationId: String, token: String): ReportLink? = null
        override suspend fun publishReport(visitId: String, operationId: String, token: String, acknowledgedPrivateFindingIds: List<String>, expectedMediaIds: List<String>, recommendedPrivateFindingIds: List<String>): ReportLink = error("not used")
        override suspend fun revokeReportLink(visitId: String) = Unit
        override suspend fun uploadMedia(asset: MediaAssetEntity) = Unit
        override suspend fun deleteMedia(assetId: String) = Unit
    }
}
