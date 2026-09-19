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
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.MediaDao
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.data.SyncState

class FindingRepositoryTest {
    @Test
    fun `creates local finding with price and priority`() = runTest {
        val dao = FakeFindingDao()
        val repository = FindingRepository(dao, FakeMediaDao(), FakeWorkshopRemote(), clock = { 456L })

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
        val repository = FindingRepository(FakeFindingDao(), FakeMediaDao(), FakeWorkshopRemote())

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
        val repository = FindingRepository(dao, FakeMediaDao(), FakeWorkshopRemote(), clock = { 789L })
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

    @Test
    fun `creates a reusable client link only after finding media has synced`() = runTest {
        val dao = FakeFindingDao()
        val mediaDao = FakeMediaDao(listOf(mediaAsset("finding-1", SyncState.SYNCED)))
        val repository = FindingRepository(dao, mediaDao, FakeWorkshopRemote(), clock = { 1_000L })
        val finding = FindingEntity(
            id = "finding-1",
            visitId = "visit-1",
            title = "Колодки",
            description = "",
            priceRub = 4_000,
            priority = FindingPriority.IMPORTANT,
            status = FindingStatus.READY_FOR_APPROVAL,
            createdAtEpochMs = 1L,
            updatedAtEpochMs = 1L,
            serverVersion = 2,
        )

        val link = repository.createApprovalLink(finding)

        assertTrue(link.publicUrl.startsWith("https://example.test/a/"))
        assertEquals(FindingStatus.SENT_TO_CUSTOMER, dao.saved?.status)
        assertTrue(dao.saved?.approvalOperationId?.isNotBlank() == true)
        assertTrue(dao.saved?.approvalToken?.length ?: 0 >= 43)
    }

    @Test
    fun `does not publish a partial material snapshot`() = runTest {
        val dao = FakeFindingDao()
        val repository = FindingRepository(dao, FakeMediaDao(listOf(mediaAsset("finding-1", SyncState.QUEUED))), FakeWorkshopRemote())
        val finding = readyFinding()
        var rejected = false
        try { repository.createApprovalLink(finding) } catch (_: IllegalArgumentException) { rejected = true }
        assertTrue(rejected)
        assertEquals(null, dao.saved)
    }

    @Test
    fun `queue survives repository recreation and excludes later captures`() = runTest {
        val dao = FakeFindingDao()
        dao.insert(readyFinding())
        val assets = mutableListOf(mediaAsset("finding-1", SyncState.SYNCED))
        val media = FakeMediaDao(assets)
        val calls = mutableListOf<Pair<String, List<String>>>()
        val remote = object : ru.autoservice.spike.network.WorkshopRemote by FakeWorkshopRemote() {
            override suspend fun createApprovalLink(findingId: String, operationId: String, token: String, mediaIds: List<String>, replaceActive: Boolean): ru.autoservice.spike.network.ApprovalLink {
                calls += operationId to mediaIds
                if (calls.size == 1) throw java.io.IOException("Response lost")
                return ru.autoservice.spike.network.ApprovalLink("https://example.test/a/$token", 1800000L)
            }
        }
        val repository = FindingRepository(dao, media, remote)
        repository.queueApproval(readyFinding())
        val operationId = dao.saved!!.approvalOperationId
        assets += mediaAsset("finding-1", SyncState.QUEUED).copy(id = "later-capture")
        try { repository.processPending("finding-1") } catch (_: java.io.IOException) { }
        repository.preparationFailed("finding-1", "Repeat")
        val restored = FindingRepository(dao, media, remote)
        restored.queueApproval(dao.saved!!)
        restored.processPending("finding-1")
        assertEquals(listOf(operationId, operationId), calls.map { it.first })
        assertTrue(calls.all { it.second == listOf("media-1") })
        assertEquals("READY", dao.saved!!.approvalPreparationState)
        assertEquals(FindingStatus.SENT_TO_CUSTOMER, dao.saved!!.status)
    }

    @Test
    fun `marks only an approved finding as completed`() = runTest {
        val dao = FakeFindingDao()
        val approved = readyFinding().copy(status = FindingStatus.APPROVED)
        dao.insert(approved)
        val remote = object : ru.autoservice.spike.network.WorkshopRemote by FakeWorkshopRemote() {
            override suspend fun completeFinding(findingId: String): FindingEntity = approved.copy(status = FindingStatus.COMPLETED)
        }
        val repository = FindingRepository(dao, FakeMediaDao(), remote)

        repository.markCompleted(approved)

        assertEquals(FindingStatus.COMPLETED, dao.saved?.status)
    }

    private fun readyFinding() = FindingEntity(
        id = "finding-1", visitId = "visit-1", title = "Колодки", description = "", priceRub = 4000,
        priority = FindingPriority.IMPORTANT, status = FindingStatus.READY_FOR_APPROVAL,
        createdAtEpochMs = 1, updatedAtEpochMs = 1, serverVersion = 2,
    )

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

    private class FakeMediaDao(private val assets: List<MediaAssetEntity> = emptyList()) : MediaDao {
        override suspend fun insert(asset: MediaAssetEntity) = Unit
        override fun observeAll(): Flow<List<MediaAssetEntity>> = MutableStateFlow(assets)
        override suspend fun find(id: String): MediaAssetEntity? = assets.firstOrNull { it.id == id }
        override suspend fun delete(id: String) = Unit
        override suspend fun forFinding(findingId: String): List<MediaAssetEntity> = assets.filter { it.findingId == findingId }
        override suspend fun allLocalPaths(): List<String> = emptyList()
        override suspend fun pending(): List<MediaAssetEntity> = emptyList()
        override suspend fun updateProgress(id: String, state: SyncState, attempts: Int, error: String?, updatedAt: Long) = Unit
        override suspend fun markSynced(id: String, remoteKey: String, updatedAt: Long) = Unit
    }

    private fun mediaAsset(findingId: String, state: SyncState) = MediaAssetEntity(
        id = "media-1",
        operationId = "operation-1",
        visitId = "visit-1",
        findingId = findingId,
        kind = MediaKind.PHOTO,
        mimeType = "image/jpeg",
        localPath = "/tmp/media-1.jpg",
        byteCount = 1L,
        sha256 = "0".repeat(64),
        syncState = state,
        uploadAttempts = 0,
        remoteKey = "remote/media-1",
        lastError = null,
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 1L,
    )
}
