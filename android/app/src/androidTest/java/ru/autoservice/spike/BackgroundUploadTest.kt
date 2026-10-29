package ru.autoservice.spike

import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitStatus
import java.io.File

/** Manual two-phase test. Prepare while offline, verify only after server observes automatic upload. */
class BackgroundUploadTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val checkpoint get() = File(context.cacheDir, "qa-background-upload.json")
    private val root get() = (context.applicationContext as AutoServiceApplication).container
    private fun qaWorkshop(): WorkshopContainer {
        val session = requireNotNull(root.authStore.session.value) { "Sign in to QA workshop first" }
        assertEquals("Refuse to test against a business workshop", "9999051c-171c-43a2-a9c1-9ccb80270ab8", session.workshopId)
        return root.forWorkshop(session.workshopId)
    }
    @Test fun enqueueWhileOffline() = runBlocking(Dispatchers.IO) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaBackgroundPhase") == "prepare")
        val workshop = qaWorkshop()
        val visit = workshop.database.visitDao().all().first { it.status in setOf(VisitStatus.DRAFT, VisitStatus.IN_REPAIR) }
        val capture = workshop.fileStore.newCaptureFile(visit.id, MediaKind.PHOTO)
        android.graphics.Bitmap.createBitmap(64, 64, android.graphics.Bitmap.Config.ARGB_8888).let { bitmap ->
            bitmap.eraseColor(android.graphics.Color.MAGENTA)
            capture.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it) }
            bitmap.recycle()
        }
        val asset = workshop.mediaRepository.registerCaptured(visit.id, kind = MediaKind.PHOTO, mimeType = "image/jpeg", file = capture)
        checkpoint.writeText(JSONObject().put("mediaId", asset.id).put("visitId", visit.id).put("operationId", asset.operationId)
            .put("sha256", asset.sha256).put("createdAt", System.currentTimeMillis()).toString())
        val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork("${workshop.workshopId}-media-upload-${asset.id}").get()
        assertEquals(1, work.size)
        assertEquals(androidx.work.WorkInfo.State.ENQUEUED, work.single().state)
        assertEquals(SyncState.QUEUED, workshop.database.mediaDao().find(asset.id)!!.syncState)
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "BACKGROUND_QUEUED_MEDIA=${asset.id}\n") })
    }
    @Test fun verifyAutomaticUpload() = runBlocking(Dispatchers.IO) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaBackgroundPhase") == "verify")
        val workshop = qaWorkshop()
        val saved = JSONObject(checkpoint.readText())
        val asset = workshop.database.mediaDao().find(saved.getString("mediaId"))!!
        assertEquals(SyncState.SYNCED, asset.syncState)
        assertEquals(saved.getString("sha256"), asset.sha256)
        val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork("${workshop.workshopId}-media-upload-${asset.id}").get()
        assertEquals(androidx.work.WorkInfo.State.SUCCEEDED, work.single().state)
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "BACKGROUND_WORKMANAGER_SUCCEEDED\n") })
    }
}
