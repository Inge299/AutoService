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
    fun `repeat intake passes selected IDs and normalizes a ten digit phone`() = runTest {
        val delegate = FakeWorkshopRemote()
        var selected: Pair<String?, String?>? = null
        val remote = object : ru.autoservice.spike.network.WorkshopRemote by delegate {
            override suspend fun saveIntake(visit: VisitEntity, customerId: String?, vehicleId: String?): VisitEntity {
                selected = customerId to vehicleId
                return delegate.saveVisit(visit)
            }
        }
        val repository = VisitRepository(FakeVisitDao(), remote)
        val visit = repository.createVisit(VisitDraft("Test", "9991234567", "Toyota renamed", "А123АА77", 123456, "Test",
            customerId = "selected-client", vehicleId = "selected-car"))
        assertEquals("+79991234567", visit.customerPhone)
        assertEquals(null, selected)
        repository.synchronizeLocal()
        assertEquals("selected-client" to "selected-car", selected)
    }
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
        assertEquals(0, visit.serverVersion)
        assertEquals(ru.autoservice.spike.data.SyncState.LOCAL, visit.syncState)
        assertEquals(123L, visit.createdAtEpochMs)
    }

    @Test
    fun `offline visit survives restart and selected identities reach server once`() = runTest {
        val dao = FakeVisitDao()
        val remote = FakeWorkshopRemote()
        var scheduled = 0
        val first = VisitRepository(dao, remote, clock = { 100L }, scheduleSync = { scheduled++ })
        val visit = first.createVisit(VisitDraft("Test", "9991234567", "Car", "А123АА77", null, "Complaint", "client-id", "car-id"))
        first.startRepair(visit)
        assertEquals(2, scheduled)
        assertEquals(ru.autoservice.spike.data.VisitStatus.IN_REPAIR, dao.find(visit.id)?.status)
        var selected: Pair<String?, String?>? = null
        val tracking = object : ru.autoservice.spike.network.WorkshopRemote by remote {
            override suspend fun saveIntake(visit: VisitEntity, customerId: String?, vehicleId: String?): VisitEntity {
                selected = customerId to vehicleId
                return remote.saveVisit(visit)
            }
        }
        VisitRepository(dao, tracking).synchronizeLocal()
        assertEquals("client-id" to "car-id", selected)
        assertEquals(ru.autoservice.spike.data.SyncState.SYNCED, dao.find(visit.id)?.syncState)
        assertEquals(1, remote.visits.count { it.id == visit.id })
    }

    @Test
    fun `network error leaves local visit intact for retry`() = runTest {
        val dao = FakeVisitDao()
        val delegate = FakeWorkshopRemote()
        val offline = object : ru.autoservice.spike.network.WorkshopRemote by delegate {
            override suspend fun saveIntake(visit: VisitEntity, customerId: String?, vehicleId: String?): VisitEntity = throw java.io.IOException("offline")
        }
        val visit = VisitRepository(dao, offline).createVisit(VisitDraft("Test", "9991234567", "Car", "", null, ""))
        try { VisitRepository(dao, offline).synchronizeLocal(); throw AssertionError("expected network error") } catch (_: java.io.IOException) { }
        assertEquals(visit, dao.find(visit.id))
        VisitRepository(dao, delegate).synchronizeLocal()
        assertEquals(1, delegate.visits.count { it.id == visit.id })
    }

    @Test
    fun `conflict preserves local intake and selected customer instead of overwriting it`() = runTest {
        val dao = FakeVisitDao()
        val delegate = FakeWorkshopRemote()
        val conflicting = object : ru.autoservice.spike.network.WorkshopRemote by delegate {
            override suspend fun saveIntake(visit: VisitEntity, customerId: String?, vehicleId: String?): VisitEntity =
                throw ru.autoservice.spike.network.ApiException(409, "customer_identity_ambiguous")
        }
        val local = VisitRepository(dao, conflicting).createVisit(VisitDraft("Test", "9991234567", "Car", "", null, "Local", "chosen", null))
        delegate.visits += local.copy(complaint = "Server", serverVersion = 1, syncState = ru.autoservice.spike.data.SyncState.SYNCED)
        VisitRepository(dao, conflicting).synchronizeLocal()
        val saved = requireNotNull(dao.find(local.id))
        assertEquals("Local", saved.complaint)
        assertEquals("chosen", saved.pendingCustomerId)
        assertEquals(ru.autoservice.spike.data.SyncState.BLOCKED, saved.syncState)
        assertTrue(!saved.syncError.isNullOrBlank())
    }

    @Test
    fun `correcting blocked offline visit preserves id and report while sending chosen identities`() = runTest {
        val dao = FakeVisitDao()
        val remote = FakeWorkshopRemote()
        val initial = VisitRepository(dao, remote).createVisit(VisitDraft("Original", "9991234567", "Car", "А123АА77", 100, "Complaint"))
        dao.upsert(initial.copy(syncState = ru.autoservice.spike.data.SyncState.BLOCKED, syncError = "Conflict", reportCompletedWork = "Draft"))
        var selection: Pair<String?, String?>? = null
        val tracking = object : ru.autoservice.spike.network.WorkshopRemote by remote {
            override suspend fun saveIntake(visit: VisitEntity, customerId: String?, vehicleId: String?): VisitEntity {
                selection = customerId to vehicleId
                return remote.saveVisit(visit)
            }
        }
        var scheduled = 0
        val repository = VisitRepository(dao, tracking, scheduleSync = { scheduled++ })
        val corrected = repository.correctUnsyncedVisit(initial.id, VisitDraft("Selected", "9991234567", "Car", "А123АА77", 100, "Complaint", "selected-customer", "selected-vehicle"))
        assertEquals(initial.id, corrected.id)
        assertEquals("Draft", corrected.reportCompletedWork)
        assertEquals(1, scheduled)
        repository.synchronizeLocal()
        assertEquals("selected-customer" to "selected-vehicle", selection)
        assertEquals(1, remote.visits.count { it.id == initial.id })
        assertEquals("Draft", dao.find(initial.id)?.reportCompletedWork)
    }

    @Test
    fun `cannot overwrite already synchronized visit via offline correction`() = runTest {
        val dao = FakeVisitDao()
        val remote = FakeWorkshopRemote()
        val repository = VisitRepository(dao, remote)
        val initial = repository.createVisit(VisitDraft("Test", "9991234567", "Car", "", null, ""))
        dao.upsert(initial.copy(serverVersion = 3, syncState = ru.autoservice.spike.data.SyncState.BLOCKED))
        assertTrue(runCatching { repository.correctUnsyncedVisit(initial.id, VisitDraft("Changed", "9991234567", "Car", "", null, "")) }.isFailure)
        assertEquals("Test", dao.find(initial.id)?.customerName)
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

    @Test
    fun `synchronization imports replaces and clears the inherited server date`() = runTest {
        val dao = FakeVisitDao()
        val remote = FakeWorkshopRemote()
        val server = VisitEntity("web-visit", "Test", "+79991234567", "Toyota", "", null, "",
            ru.autoservice.spike.data.VisitStatus.COMPLETED, 1, 2,
            ru.autoservice.spike.data.SyncState.SYNCED, serverVersion = 1, reportNextVisitAtEpochMs = 1234L)
        remote.visits += server
        val repository = VisitRepository(dao, remote)
        repository.synchronizeLocal()
        assertEquals(1234L, dao.find(server.id)?.reportNextVisitAtEpochMs)
        remote.visits[0] = server.copy(reportNextVisitAtEpochMs = 5678L)
        repository.synchronizeLocal()
        assertEquals(5678L, dao.find(server.id)?.reportNextVisitAtEpochMs)
        remote.visits[0] = server.copy(reportNextVisitAtEpochMs = null)
        repository.synchronizeLocal()
        assertEquals(null, dao.find(server.id)?.reportNextVisitAtEpochMs)
    }

    @Test
    fun `synchronization preserves pending and failed publication dates including no date`() = runTest {
        for (state in listOf("PENDING", "FAILED")) for (draftDate in listOf(1234L, null)) {
            val dao = FakeVisitDao()
            val remote = FakeWorkshopRemote()
            val server = VisitEntity("web-visit", "Test", "+79991234567", "Toyota", "", null, "",
                ru.autoservice.spike.data.VisitStatus.IN_REPAIR, 1, 2,
                ru.autoservice.spike.data.SyncState.SYNCED, serverVersion = 1, reportNextVisitAtEpochMs = 5678L)
            dao.upsert(server.copy(reportPreparationState = state, reportNextVisitAtEpochMs = draftDate,
                reportOperationId = "operation", reportCompletedWork = "Local draft"))
            remote.visits += server
            VisitRepository(dao, remote).synchronizeLocal()
            assertEquals(draftDate, dao.find(server.id)?.reportNextVisitAtEpochMs)
            assertEquals("operation", dao.find(server.id)?.reportOperationId)
            assertEquals("Local draft", dao.find(server.id)?.reportCompletedWork)
        }
    }

    private class FakeVisitDao : VisitDao {
        private val visits = MutableStateFlow<List<VisitEntity>>(emptyList())
        var saved: VisitEntity? = null

        override suspend fun upsert(visit: VisitEntity) {
            saved = visit
            visits.value = visits.value.filterNot { it.id == visit.id } + visit
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
