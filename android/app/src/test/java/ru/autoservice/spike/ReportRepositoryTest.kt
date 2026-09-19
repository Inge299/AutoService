package ru.autoservice.spike

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.autoservice.spike.data.ReportDraft
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
        val repository = ReportRepository(dao, remote)

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
        val repository = ReportRepository(dao, remote)
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
        val firstProcess = ReportRepository(dao, RecordingRemote())
        val pending = firstProcess.queuePublication(
            sampleVisit(),
            ReportDraft("Заменили тормозные колодки", "Пройти осмотр через месяц", null),
        )

        val remoteAfterRestart = RecordingRemote()
        val restoredProcess = ReportRepository(dao, remoteAfterRestart)
        restoredProcess.publishPending(pending.id)

        val restored = requireNotNull(dao.find(pending.id))
        assertEquals(VisitStatus.COMPLETED, restored.status)
        assertEquals("READY", restored.reportPreparationState)
        assertEquals(pending.reportOperationId, remoteAfterRestart.publishedOperationId)
        assertEquals(pending.reportToken, remoteAfterRestart.publishedToken)
        assertEquals("Заменили тормозные колодки", remoteAfterRestart.savedCompletedWork)
    }

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
        var revokedReports = 0

        override suspend fun saveReport(visitId: String, completedWork: String, recommendations: String, nextVisitAtEpochMs: Long?) {
            savedReports += 1
            savedCompletedWork = completedWork
            savedNextVisitAtEpochMs = nextVisitAtEpochMs
        }

        override suspend fun publishReport(visitId: String, operationId: String, token: String): ReportLink {
            publishedOperationId = operationId
            publishedToken = token
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
