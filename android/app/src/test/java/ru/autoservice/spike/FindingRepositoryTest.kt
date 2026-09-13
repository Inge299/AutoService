package ru.autoservice.spike

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.autoservice.spike.data.FindingDao
import ru.autoservice.spike.data.FindingDraft
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingRepository
import ru.autoservice.spike.data.FindingStatus

class FindingRepositoryTest {
    @Test
    fun `creates local finding with price and priority`() = runTest {
        val dao = FakeFindingDao()
        val repository = FindingRepository(dao, FakeWorkshopRemote(), clock = { 456L })

        val finding = repository.createFinding(
            FindingDraft(
                visitId = "visit-1",
                title = " Люфт шаровой опоры ",
                description = " Рекомендуем заменить ",
                priceRub = 3_490,
                priority = FindingPriority.IMPORTANT,
            ),
        )

        assertEquals("Люфт шаровой опоры", finding.title)
        assertEquals("Рекомендуем заменить", finding.description)
        assertEquals(3_490, finding.priceRub)
        assertEquals(FindingPriority.IMPORTANT, finding.priority)
        assertEquals(456L, finding.createdAtEpochMs)
        assertEquals(1, finding.serverVersion)
        assertEquals(finding, dao.saved)
    }

    @Test
    fun `rejects finding without title`() = runTest {
        val repository = FindingRepository(FakeFindingDao(), FakeWorkshopRemote())

        var rejected = false
        try {
            repository.createFinding(
                FindingDraft(
                    visitId = "visit-1",
                    title = " ",
                    description = "",
                    priceRub = null,
                    priority = FindingPriority.PLANNED,
                ),
            )
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue(rejected)
    }

    @Test
    fun `prepares priced finding for customer approval`() = runTest {
        val dao = FakeFindingDao()
        val repository = FindingRepository(dao, FakeWorkshopRemote(), clock = { 789L })
        val finding = repository.createFinding(
            FindingDraft(
                visitId = "visit-1",
                title = "Замена колодок",
                description = "",
                priceRub = 4_000,
                priority = FindingPriority.IMPORTANT,
            ),
        )

        repository.prepareForApproval(finding)

        assertEquals(FindingStatus.READY_FOR_APPROVAL, dao.saved?.status)
        assertEquals(789L, dao.saved?.updatedAtEpochMs)
    }

    private class FakeFindingDao : FindingDao {
        private val findings = MutableStateFlow<List<FindingEntity>>(emptyList())
        var saved: FindingEntity? = null

        override suspend fun insert(finding: FindingEntity) {
            saved = finding
            findings.value = findings.value + finding
        }

        override suspend fun update(finding: FindingEntity) {
            saved = finding
            findings.value = findings.value.map { if (it.id == finding.id) finding else it }
        }

        override fun observeForVisit(visitId: String): Flow<List<FindingEntity>> = findings

        override suspend fun all(): List<FindingEntity> = findings.value

        override suspend fun updateStatus(findingId: String, status: FindingStatus, updatedAt: Long) {
            findings.value = findings.value.map {
                if (it.id == findingId) it.copy(status = status, updatedAtEpochMs = updatedAt) else it
            }
            saved = findings.value.firstOrNull { it.id == findingId }
        }
    }
}
