package ru.autoservice.spike

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.ui.FollowUpPlanDialog
import ru.autoservice.spike.ui.theme.AutoServiceTheme
import java.time.Instant

/** Explicitly opt-in: only reads the existing QA account on Mia and refreshes its local cache. */
class InheritedReportSyncTest {
    @get:Rule val compose = createComposeRule()
    @Test fun existingWebReportDateReachesRoomAndPlanDialog() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaReadServerDate") == "true")
        val context = instrumentation.targetContext
        assertFalse("Unlock the QA device before this test", context.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
        val root = (context.applicationContext as AutoServiceApplication).container
        val session = requireNotNull(root.authStore.session.value)
        assertEquals("Refuse business-workshop access", "9999051c-171c-43a2-a9c1-9ccb80270ab8", session.workshopId)
        val workshop = root.forWorkshop(session.workshopId)
        val expected = Instant.parse("2035-12-20T09:00:00Z").toEpochMilli()
        val pair = runBlocking(Dispatchers.IO) {
            assertTrue("Refuse to push unsynchronized local visits", workshop.database.visitDao().all().all {
                it.syncState == SyncState.SYNCED && it.serverVersion > 0
            })
            val snapshot = workshop.visitRepository.synchronizeLocal()
            val visit = requireNotNull(workshop.database.visitDao().find("05f73f73-2b0b-4d34-8141-8ff7c5888430"))
            assertEquals(expected, visit.reportNextVisitAtEpochMs)
            val finding = snapshot.findings.first { it.visitId == visit.id && !it.followUpConfigured }
            finding to visit.reportNextVisitAtEpochMs
        }
        var saved: Long? = null
        compose.setContent { AutoServiceTheme { FollowUpPlanDialog(pair.first, pair.second, {}, { date, _, done -> saved = date; done(null) }) } }
        compose.onNodeWithText("20.12.2035").assertExists()
        compose.onNodeWithText("Сохранить срок").performScrollTo().performClick()
        assertEquals(expected, saved)
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "WEB_REPORT_DATE_API_ROOM_DIALOG_OK\n") })
    }
}
