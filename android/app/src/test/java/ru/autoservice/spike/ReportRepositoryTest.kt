package ru.autoservice.spike

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.autoservice.spike.data.ReportDraft
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.data.ReportMediaReadinessException
import ru.autoservice.spike.data.ReportRepository
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitDao
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitStatus
import ru.autoservice.spike.network.ReportLink

class ReportRepositoryTest {
    @Test
    fun `publication keeps an idempotency key and completes the local visit`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote()
        val repository = ReportRepository(dao, remote) { emptyList() }

        val pending = repository.queuePublication(
            sampleVisit(),
            ReportDraft("Заменили масло и фильтр", "Проверить уровень масла через неделю", 1_800_000L),
        )
        val link = repository.publishPending(pending.id)

        val saved = requireNotNull(dao.find(pending.id))
        assertEquals(VisitStatus.COMPLETED, saved.status)
        assertEquals("READY", saved.reportPreparationState)
        assertEquals(link.publicUrl, saved.reportPublicUrl)
        assertNotNull(saved.reportOperationId)
        assertTrue(saved.reportToken!!.length >= 32)
        assertEquals(1, remote.savedReports)
        assertEquals(1_800_000L, remote.savedNextVisitAtEpochMs)
        assertEquals(saved.reportOperationId, remote.publishedOperationId)
    }

    @Test
    fun `revoking a published report keeps its draft but clears the old publication key`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote()
        val repository = ReportRepository(dao, remote) { emptyList() }
        val pending = repository.queuePublication(sampleVisit(), ReportDraft("Заменили масло", "", null))
        repository.publishPending(pending.id)
        val published = requireNotNull(dao.find(pending.id))

        repository.revokePublished(published)

        val revised = requireNotNull(dao.find(pending.id))
        assertEquals(VisitStatus.IN_REPAIR, revised.status)
        assertEquals("Заменили масло", revised.reportCompletedWork)
        assertEquals(null, revised.reportOperationId)
        assertEquals(null, revised.reportPublicUrl)
        assertEquals(1, remote.revokedReports)
    }

    @Test
    fun `pending report survives a process restart and keeps its operation key`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val firstProcess = ReportRepository(dao, RecordingRemote()) { emptyList() }
        val pending = firstProcess.queuePublication(
            sampleVisit(),
            ReportDraft("Заменили тормозные колодки", "Пройти осмотр через месяц", null, listOf("11111111-1111-4111-8111-111111111111")),
        )

        val remoteAfterRestart = RecordingRemote()
        val restoredProcess = ReportRepository(dao, remoteAfterRestart) { emptyList() }
        restoredProcess.publishPending(pending.id)

        val restored = requireNotNull(dao.find(pending.id))
        assertEquals(VisitStatus.COMPLETED, restored.status)
        assertEquals("READY", restored.reportPreparationState)
        assertEquals(pending.reportOperationId, remoteAfterRestart.publishedOperationId)
        assertEquals(pending.reportToken, remoteAfterRestart.publishedToken)
        assertEquals(listOf("11111111-1111-4111-8111-111111111111"), remoteAfterRestart.acknowledgedPrivateIds)
        assertEquals("Заменили тормозные колодки", remoteAfterRestart.savedCompletedWork)
    }

    @Test
    fun `pending media blocks publication without losing report text`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote()
        val file = sampleMedia(SyncState.RETRY)
        val repository = ReportRepository(dao, remote) { listOf(file) }
        val failure = runCatching { repository.queuePublication(sampleVisit(), ReportDraft("Сохранённая работа", "", null, expectedMediaIds = listOf(file.id))) }.exceptionOrNull()
        assertTrue(failure is ReportMediaReadinessException)
        assertEquals("Сохранённая работа", dao.find("visit-1")?.reportCompletedWork)
        assertEquals(0, remote.savedReports)
    }

    @Test
    fun `report waits for unsynchronized finding and preserves its draft`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote()
        val repository = ReportRepository(dao, remote, hasUnsyncedFindings = { true }) { emptyList() }
        val failure = runCatching { repository.queuePublication(sampleVisit(), ReportDraft("Сохранённая работа", "", null)) }.exceptionOrNull()
        assertTrue(failure is ReportMediaReadinessException)
        assertEquals("Сохранённая работа", dao.find("visit-1")?.reportCompletedWork)
        assertEquals(0, remote.savedReports)
    }

    @Test
    fun `selected recommendation survives restart and older server cannot silently omit it`() = runTest {
        val id = "11111111-1111-4111-8111-111111111111"
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote().apply { supportsRecommendations = false }
        val repo = ReportRepository(dao, remote) { emptyList() }
        val pending = repo.queuePublication(sampleVisit(), ReportDraft("Работа", "", null,
            acknowledgedPrivateFindingIds = listOf(id), recommendedPrivateFindingIds = listOf(id)))
        val restored = ReportRepository(dao, remote) { emptyList() }
        assertTrue(runCatching { restored.publishPending(pending.id) }.isFailure)
        assertEquals(0, remote.savedReports)
        assertEquals(id, dao.find(pending.id)?.reportRecommendedPrivateFindingIds)
        remote.supportsRecommendations = true
        restored.publishPending(pending.id)
        assertEquals(listOf(id), remote.recommendedPrivateIds)
    }

    @Test
    fun `old server cannot publish a report even without selected recommendations`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote().apply { supportsRecommendations = false }
        val repo = ReportRepository(dao, remote) { emptyList() }
        val pending = repo.queuePublication(sampleVisit(), ReportDraft("Работа", "", null))
        val failure = runCatching { repo.publishPending(pending.id) }.exceptionOrNull()
        assertTrue(failure is ReportMediaReadinessException)
        assertEquals(0, remote.savedReports)
        assertEquals("Работа", dao.find(pending.id)?.reportCompletedWork)
    }

    @Test
    fun `lost publication response can be recovered even when local media changed`() = runTest {
        val dao = FakeVisitDao(sampleVisit())
        val remote = RecordingRemote()
        var files = listOf(sampleMedia(SyncState.SYNCED))
        val repository = ReportRepository(dao, remote) { files }
        val pending = repository.queuePublication(sampleVisit(), ReportDraft("Работа", "", null, expectedMediaIds = listOf(files.single().id)))
        files = emptyList()
        remote.recovered = ReportLink("https://example.test/r/existing", 1_800_000L)
        assertEquals(remote.recovered, repository.publishPending(pending.id))
        assertEquals(0, remote.savedReports)
        assertEquals(VisitStatus.COMPLETED, dao.find(pending.id)?.status)
    }

    private fun sampleMedia(state: SyncState) = MediaAssetEntity(
        id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", operationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        visitId = "visit-1", findingId = null, kind = MediaKind.PHOTO, mimeType = "image/jpeg",
        localPath = "/tmp/qa.jpg", byteCount = 1, sha256 = "0".repeat(64), syncState = state,
        uploadAttempts = 1, remoteKey = null, lastError = null, createdAtEpochMs = 1, updatedAtEpochMs = 1,
    )

    private fun sampleVisit() = VisitEntity(
        id = "visit-1",
        customerName = "Иван",
        customerPhone = "+79991234567",
        vehicleLabel = "Lada Vesta",
        licensePlate = "А123АА77",
        mileageKm = 10_000,
        complaint = "ТО",
        status = VisitStatus.IN_REPAIR,
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 1L,
        syncState = SyncState.SYNCED,
    )

    private class RecordingRemote : FakeWorkshopRemote() {
        var savedReports = 0
        var savedNextVisitAtEpochMs: Long? = null
        var savedCompletedWork: String? = null
        var publishedOperationId: String? = null
        var publishedToken: String? = null
        var acknowledgedPrivateIds: List<String> = emptyList()
        var recommendedPrivateIds: List<String> = emptyList()
        var supportsRecommendations = true
        override suspend fun supportsExplicitRecommendations() = supportsRecommendations
        var recovered: ReportLink? = null
        override suspend fun recoverReport(visitId: String, operationId: String, token: String): ReportLink? = recovered
        var revokedReports = 0

        override suspend fun saveReport(visitId: String, completedWork: String, recommendations: String, nextVisitAtEpochMs: Long?) {
            savedReports += 1
            savedCompletedWork = completedWork
            savedNextVisitAtEpochMs = nextVisitAtEpochMs
        }

        override suspend fun publishReport(visitId: String, operationId: String, token: String, acknowledgedPrivateFindingIds: List<String>, expectedMediaIds: List<String>, recommendedPrivateFindingIds: List<String>): ReportLink {
            publishedOperationId = operationId
            publishedToken = token
            acknowledgedPrivateIds = acknowledgedPrivateFindingIds
            recommendedPrivateIds = recommendedPrivateFindingIds
            return ReportLink("https://example.test/r/$token", 1_800_000L)
        }

        override suspend fun revokeReportLink(visitId: String) { revokedReports += 1 }
    }

    private class FakeVisitDao(initial: VisitEntity) : VisitDao {
        private val visits = MutableStateFlow(listOf(initial))
        override suspend fun upsert(visit: VisitEntity) { visits.value = visits.value.filterNot { it.id == visit.id } + visit }
        override fun observeAll(): Flow<List<VisitEntity>> = visits
        override fun observeActive(): Flow<List<VisitEntity>> = visits
        override suspend fun find(id: String): VisitEntity? = visits.value.firstOrNull { it.id == id }
        override suspend fun all(): List<VisitEntity> = visits.value
        override suspend fun updateStatus(visitId: String, status: VisitStatus, updatedAt: Long) {
            visits.value = visits.value.map { if (it.id == visitId) it.copy(status = status, updatedAtEpochMs = updatedAt) else it }
        }
    }
}
