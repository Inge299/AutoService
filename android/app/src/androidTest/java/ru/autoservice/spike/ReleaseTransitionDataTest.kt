package ru.autoservice.spike

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Explicit two-phase check, runnable with the old local helper then the production-signed helper. */
class ReleaseTransitionDataTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val checkpoint get() = File(context.cacheDir, "qa-release-transition-data.json")
    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun sessionIdentity(): JSONObject {
        val session = (context.applicationContext as AutoServiceApplication).container.authStore.session.value
        return JSONObject().put("present", session != null).apply {
            session?.let { put("userId", it.userId); put("workshopId", it.workshopId) }
        }
    }
    @Test fun captureLegacyMediaAndSession() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaReleasePhase") == "capture")
        assertEquals(105L, PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0)))
        check(Build.VERSION.SDK_INT >= 28)
        val originalInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        assertEquals("5cfc7eec9da4e638cad1ef9af89c7f6f4339ace63c64d8aafa6040acc146c288", digest(originalInfo.signingInfo!!.apkContentsSigners.single().toByteArray()))
        val directory = File(context.noBackupFilesDir, "workshops")
        val files = JSONObject()
        directory.walkTopDown().filter { it.isFile && !it.name.endsWith(".capture") }.forEach { file ->
            files.put(file.relativeTo(directory).path, JSONObject().put("size", file.length()).put("sha256", digest(file.readBytes())))
        }
        checkpoint.writeText(JSONObject().put("files", files).put("session", sessionIdentity()).toString())
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "LEGACY_MEDIA_CHECKPOINT_FILES=${files.length()}\n") })
    }
    @Test fun releaseRetainsMediaSessionAndUsesProductionSigner() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaReleasePhase") == "verify")
        check(Build.VERSION.SDK_INT >= 28)
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        assertEquals(InstrumentationRegistry.getArguments().getString("qaExpectedVersion")!!.toLong(), PackageInfoCompat.getLongVersionCode(info))
        assertEquals(0, context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE)
        assertEquals("2d3fba77411b2b68d0cae37ca4582c8720de142923a8381353e0a7cd11949c93", digest(info.signingInfo!!.apkContentsSigners.single().toByteArray()))
        val before = JSONObject(checkpoint.readText())
        val expectedFiles = before.getJSONObject("files")
        val directory = File(context.noBackupFilesDir, "workshops")
        for (path in expectedFiles.keys()) {
            val expected = expectedFiles.getJSONObject(path)
            val file = File(directory, path)
            assertTrue("Local media disappeared", file.isFile)
            assertEquals(expected.getLong("size"), file.length())
            assertEquals(expected.getString("sha256"), digest(file.readBytes()))
        }
        val oldSession = before.getJSONObject("session")
        val current = sessionIdentity()
        assertEquals(oldSession.getBoolean("present"), current.getBoolean("present"))
        if (oldSession.getBoolean("present")) {
            assertEquals(oldSession.getString("userId"), current.getString("userId"))
            assertEquals(oldSession.getString("workshopId"), current.getString("workshopId"))
        }
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "RELEASE_PRODUCTION_SIGNER_MEDIA_SESSION_PRESERVED files=${expectedFiles.length()}\n") })
    }
}
