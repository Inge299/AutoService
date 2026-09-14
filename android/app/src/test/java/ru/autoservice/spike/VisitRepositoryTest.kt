package ru.autoservice.spike

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.autoservice.spike.data.VisitDao
import ru.autoservice.spike.data.VisitDraft
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitRepository

class VisitRepositoryTest {
    @Test
    fun `creates offline visit and normalizes russian phone`() = runTest {
        val dao = FakeVisitDao()
        val repository = VisitRepository(visitDao = dao, api = FakeWorkshopRemote(), clock = { 123L })

        val visit = repository.createVisit(
            VisitDraft(
                customerName = " Иван ",
                customerPhone = "8 (999) 123-45-67",
                vehicleLabel = " Lada Vesta ",
                licensePlate = "а123аа77",
                mileageKm = 42_000,
                complaint = " Стук спереди ",
            ),
        )

        assertEquals("+79991234567", visit.customerPhone)
        assertEquals("Иван", visit.customerName)
        assertEquals("Lada Vesta", visit.vehicleLabel)
        assertEquals(visit, dao.saved)
        assertEquals(1, visit.serverVersion)
        assertEquals(ru.autoservice.spike.data.SyncState.SYNCED, visit.syncState)
        assertEquals(123L, visit.createdAtEpochMs)
    }

    @Test
    fun `rejects visit without vehicle identifier`() = runTest {
        val repository = VisitRepository(FakeVisitDao(), FakeWorkshopRemote())

        var rejected = false
        try {
            repository.createVisit(
                VisitDraft(
                    customerName = "",
                    customerPhone = "+7 999 123-45-67",
                    vehicleLabel = "",
                    licensePlate = "",
                    mileageKm = null,
                    complaint = "",
                ),
            )
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue(rejected)
    }

    private class FakeVisitDao : VisitDao {
        private val visits = MutableStateFlow<List<VisitEntity>>(emptyList())
        var saved: VisitEntity? = null

        override suspend fun upsert(visit: VisitEntity) {
            saved = visit
            visits.value = listOf(visit)
        }

        override fun observeAll(): Flow<List<VisitEntity>> = visits

        override fun observeActive(): Flow<List<VisitEntity>> = visits

        override suspend fun find(id: String): VisitEntity? =
            visits.value.firstOrNull { it.id == id }

        override suspend fun all(): List<VisitEntity> = visits.value

        override suspend fun updateStatus(visitId: String, status: ru.autoservice.spike.data.VisitStatus, updatedAt: Long) {
            visits.value = visits.value.map {
                if (it.id == visitId) it.copy(status = status, updatedAtEpochMs = updatedAt) else it
            }
            saved = visits.value.firstOrNull { it.id == visitId }
        }
    }
}
