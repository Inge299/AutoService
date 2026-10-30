package ru.autoservice.spike

import android.database.sqlite.SQLiteDatabase
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Run capture on APK 102, update with adb install -r, then verify on APK 103. */
class InstalledDataUpdateTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val checkpoint get() = File(context.cacheDir, "qa-installed-data-baseline.json")
    private fun rows(database: String, table: String): Set<String> = SQLiteDatabase.openDatabase(context.getDatabasePath(database).absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { db ->
        db.rawQuery("SELECT id FROM $table", null).use { cursor -> buildSet {
            while (cursor.moveToNext()) add(MessageDigest.getInstance("SHA-256").digest(cursor.getString(0).toByteArray()).joinToString("") { "%02x".format(it) })
        } }
    }
    @Test fun captureBeforeApkUpdate() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaUpdatePhase") == "capture")
        assertEquals(103L, androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0)))
        val result = JSONObject()
        context.databaseList().filter { it.startsWith("autoservice-") && it.endsWith(".db") }.forEach { name ->
            val tables = JSONObject()
            for (table in listOf("visits", "findings", "media_assets", "dictionary_values")) tables.put(table, JSONArray(rows(name, table).toList()))
            result.put(name, tables)
        }
        assertTrue("Expected installed workshop databases", result.length() > 0)
        checkpoint.writeText(result.toString())
    }
    @Test fun verifyAfterApkUpdate() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaUpdatePhase") == "verify")
        assertEquals(104L, androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(context.packageManager.getPackageInfo(context.packageName, 0)))
        val before = JSONObject(checkpoint.readText())
        for (name in before.keys()) for (table in before.getJSONObject(name).keys()) {
            val hashes = before.getJSONObject(name).getJSONArray(table)
            val after = rows(name, table)
            for (index in 0 until hashes.length()) assertTrue("A record disappeared from $table during APK update", hashes.getString(index) in after)
        }
        InstrumentationRegistry.getInstrumentation().sendStatus(0, android.os.Bundle().apply { putString("stream", "INSTALLED_DATABASE_RECORDS_PRESERVED_103_TO_104\n") })
    }
}
