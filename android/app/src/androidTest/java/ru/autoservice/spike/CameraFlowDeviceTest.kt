package ru.autoservice.spike

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.content.ContextCompat
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.*
import ru.autoservice.spike.network.AuthSession
import ru.autoservice.spike.ui.CameraCaptureScreen
import ru.autoservice.spike.ui.QueueViewModel
import ru.autoservice.spike.ui.theme.AutoServiceTheme
import java.io.File
import java.util.UUID

class CameraFlowDeviceTest {
    @get:Rule val compose = createComposeRule()
    @Test fun photoButtonSavesImageForOfflineVisitWithoutMicrophone() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Manual test requires the disposable isolated QA package", context.packageName.endsWith(".migrationqa20261103"))
        assumeTrue("Manual isolated camera test requires CAMERA grant", ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
        assertTrue("microphone must remain denied for this scenario", ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
        val application = context.applicationContext as AutoServiceApplication
        val root = application.container
        val workshopId = "81111111-1111-4111-8111-111111111111"
        val visitId = UUID.randomUUID().toString()
        root.authStore.save(AuthSession("synthetic", Long.MAX_VALUE, "synthetic", Long.MAX_VALUE, "synthetic", workshopId, "Synthetic", "ADMIN", true))
        val workshop = root.forWorkshop(workshopId)
        runBlocking { workshop.database.visitDao().upsert(VisitEntity(visitId, "QA", "+79990000000", "QA", "", null, "", VisitStatus.IN_REPAIR, 1, 1, SyncState.LOCAL)) }
        val viewModel = QueueViewModel(application as Application)
        try {
            compose.setContent { AutoServiceTheme { CameraCaptureScreen(visitId, null, viewModel, onClose = {}, onMessage = {}) } }
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithText("Фото").assertIsEnabled(); true }.getOrDefault(false) }
            compose.onNodeWithText("Фото").performClick()
            compose.waitUntil(20_000) { runBlocking { workshop.database.mediaDao().forVisit(visitId).isNotEmpty() } }
            val asset = runBlocking { workshop.database.mediaDao().forVisit(visitId).single() }
            assertEquals(MediaKind.PHOTO, asset.kind)
            assertEquals(visitId, asset.visitId)
            assertTrue(File(asset.localPath).isFile)
            assertTrue(File(asset.localPath).length() > 100)
        } finally { root.authStore.clear() }
    }
}
