package ru.autoservice.spike

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.Rule
import androidx.test.ext.junit.rules.ActivityScenarioRule
import ru.autoservice.spike.data.*
import ru.autoservice.spike.network.AuthStore
import ru.autoservice.spike.network.AutoServiceApi
import java.io.File
import java.io.IOException
import java.util.UUID

/** Manual device test: pass qaLogin/qaPassword. Uses a separate DB and session. */
class NetworkRecoveryTest {
    // A visible empty test Activity prevents TECNO from freezing this test as a
    // cached background process while its TLS/Room work is in flight.
    @get:Rule val foreground = ActivityScenarioRule(androidx.activity.ComponentActivity::class.java)
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val checkpoint get() = File(context.cacheDir, "qa-network-checkpoint.json")
    private fun progress(value: String) = instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "$value\n") })
    private fun store() = AuthStore(object : ContextWrapper(context) {
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences("qa-recovery-$name", mode)
    })
    private fun database() = Room.databaseBuilder(context, AppDatabase::class.java, "qa-network-recovery-v8.db").build()
    private suspend fun login(store: AuthStore): AutoServiceApi {
        val args = InstrumentationRegistry.getArguments()
        assumeNotNull(args.getString("qaLogin"), args.getString("qaPassword"))
        return AutoServiceApi(BuildConfig.API_BASE_URL, store).also {
            assertEquals("9999051c-171c-43a2-a9c1-9ccb80270ab8", it.login(args.getString("qaLogin")!!, args.getString("qaPassword")!!).workshopId)
        }
    }

    @Test fun prepareCacheAndDisconnect() = runBlocking(kotlinx.coroutines.Dispatchers.IO) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaRecoveryPhase") == "prepare")
        progress("QA_PREPARE_BEGIN")
        val store = store(); val db = database()
        try {
            val api = login(store)
            progress("QA_LOGIN_OK")
            val snapshot = VisitRepository(db.visitDao(), api).synchronizeLocal()
            progress("QA_CACHE_SAVED=${snapshot.visits.size}")
            assertTrue(snapshot.visits.size > 200)
            val visit = snapshot.visits.first { it.status in setOf(VisitStatus.DRAFT, VisitStatus.IN_REPAIR) }; val operation = UUID.randomUUID().toString()
            db.visitDao().upsert(visit.copy(reportPreparationState = "PENDING", reportOperationId = operation, reportCompletedWork = "QA recovery only"))
            val file = File(context.cacheDir, "qa-pending-media.jpg")
            android.graphics.Bitmap.createBitmap(32, 32, android.graphics.Bitmap.Config.ARGB_8888).let { bitmap ->
                bitmap.eraseColor(android.graphics.Color.CYAN)
                file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it) }; bitmap.recycle()
            }
            val sha = java.security.MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            val mediaId = UUID.randomUUID().toString()
            db.mediaDao().insert(MediaAssetEntity(mediaId, UUID.randomUUID().toString(), visit.id, null, MediaKind.PHOTO, "image/jpeg", file.absolutePath,
                file.length(), sha, SyncState.RETRY, 2, null, "synthetic offline error", 1, 1))
            val before = db.visitDao().all().map { it.id }.toSet()
            // Refused TCP connection through the real HTTP transport, without
            // changing Wi-Fi/mobile data or weakening TLS on the user's phone.
            val closedPort = java.net.ServerSocket(0).use { it.localPort }
            val offline = AutoServiceApi("https://127.0.0.1:$closedPort", store, connectionTimeoutMs = 500, requestTimeoutMs = 1_000)
            progress("OFFLINE_REQUEST_BEGIN")
            val error = runCatching { VisitRepository(db.visitDao(), offline).synchronizeLocal() }.exceptionOrNull()
            progress("OFFLINE_REQUEST_FINISHED")
            assertTrue("Connection failure must be explicit", error is IOException)
            assertEquals(before, db.visitDao().all().map { it.id }.toSet())
            assertEquals(operation, db.visitDao().find(visit.id)!!.reportOperationId)
            assertEquals(SyncState.RETRY, db.mediaDao().find(mediaId)!!.syncState)
            assertTrue(runCatching { offline.uploadMedia(db.mediaDao().find(mediaId)!!) }.exceptionOrNull() is IOException)
            assertNotNull(store.session.value)
            checkpoint.writeText(JSONObject().put("count", before.size).put("visitId", visit.id).put("operation", operation)
                .put("mediaId", mediaId).put("pid", android.os.Process.myPid()).toString())
            instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "NETWORK_FAILURE_PRESERVED_CACHE=${before.size}\n") })
        } finally { db.close(); store.clear() }
    }

    @Test fun recoverAfterProcessRestart() = runBlocking(kotlinx.coroutines.Dispatchers.IO) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaRecoveryPhase") == "recover")
        assertTrue("Run prepareCacheAndDisconnect first, then force-stop the app", checkpoint.exists())
        val saved = JSONObject(checkpoint.readText()); val db = database(); val store = store()
        try {
            assertNotEquals(saved.getInt("pid"), android.os.Process.myPid())
            assertEquals(saved.getInt("count"), db.visitDao().all().size)
            val id = saved.getString("visitId")
            assertEquals("PENDING", db.visitDao().find(id)!!.reportPreparationState)
            val media = db.mediaDao().find(saved.getString("mediaId"))!!
            assertEquals(SyncState.RETRY, media.syncState); assertEquals(2, media.uploadAttempts)
            assertEquals(media.sha256, java.security.MessageDigest.getInstance("SHA-256").digest(File(media.localPath).readBytes()).joinToString("") { "%02x".format(it) })
            val api = login(store)
            val snapshot = VisitRepository(db.visitDao(), api).synchronizeLocal()
            assertTrue(snapshot.visits.size >= saved.getInt("count"))
            assertEquals(saved.getString("operation"), db.visitDao().find(id)!!.reportOperationId)
            assertEquals("PENDING", db.visitDao().find(id)!!.reportPreparationState)
            api.uploadMedia(media)
            api.uploadMedia(media) // retry reuses the same id/operation, no second asset
            val connection = java.net.URL(BuildConfig.API_BASE_URL + "/v1/media/" + media.id).openConnection() as java.net.HttpURLConnection
            connection.setRequestProperty("Authorization", "Bearer " + store.session.value!!.accessToken)
            try {
                val state = JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).getString("state")
                assertTrue(state in setOf("VERIFIED", "READY"))
            } finally { connection.disconnect() }
            instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "PROCESS_RESTART_AND_NETWORK_RECOVERY_VERIFIED\n") })
        } finally { db.close(); store.clear() }
    }
}
