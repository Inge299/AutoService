package ru.autoservice.spike

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import ru.autoservice.spike.data.AppDatabase

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        AppDatabase::class.java,
        emptyList(),
        FrameworkSQLiteOpenHelperFactory(),
    )

    @Test
    fun migratesVisitAndFindingFromVersion5ToVersion8() {
        helper.createDatabase(DATABASE_NAME, 5).apply {
            execSQL(
                """INSERT INTO visits
                    (id, customerName, customerPhone, vehicleLabel, licensePlate, mileageKm, complaint,
                     status, createdAtEpochMs, updatedAtEpochMs, syncState, serverVersion)
                   VALUES ('visit-1', 'Иван', '+79991234567', 'Lada Vesta', 'А123АА77', 10000, 'ТО',
                           'IN_REPAIR', 100, 200, 'SYNCED', 2)""",
            )
            execSQL(
                """INSERT INTO findings
                    (id, visitId, title, description, priceRub, priority, status, createdAtEpochMs,
                     updatedAtEpochMs, serverVersion)
                   VALUES ('finding-1', 'visit-1', 'Колодки', '', 4000, 'IMPORTANT', 'APPROVED', 100, 200, 2)""",
            )
            execSQL("""INSERT INTO media_assets (id, operationId, visitId, findingId, kind, mimeType, localPath, byteCount, sha256,
                syncState, uploadAttempts, remoteKey, lastError, createdAtEpochMs, updatedAtEpochMs)
                VALUES ('media-1', 'operation-1', 'visit-1', 'finding-1', 'PHOTO', 'image/jpeg', '/synthetic/photo.jpg', 10, 'synthetic-sha',
                'RETRY', 2, NULL, 'synthetic offline error', 100, 200)""")
            execSQL("""INSERT INTO dictionary_values (id, kind, label, normalizedValue, usageCount, lastUsedAtEpochMs)
                VALUES ('dictionary-1', 'COMPLAINT', 'ТО', 'то', 3, 200)""")
            close()
        }

        helper.runMigrationsAndValidate(
            DATABASE_NAME,
            8,
            true,
            AppDatabase.MIGRATION_5_6,
            AppDatabase.MIGRATION_6_7,
            AppDatabase.MIGRATION_7_8,
        ).use { database ->
            database.query("SELECT vehicleLabel, reportOperationId, reportPreparationState FROM visits WHERE id = 'visit-1'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("Lada Vesta", cursor.getString(0))
                assertTrue(cursor.isNull(1))
                assertTrue(cursor.isNull(2))
            }
            database.query("SELECT status, approvalPreparationState FROM findings WHERE id = 'finding-1'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("APPROVED", cursor.getString(0))
                assertTrue(cursor.isNull(1))
            }
            database.query("SELECT syncState, uploadAttempts, localPath FROM media_assets WHERE id = 'media-1'").use { cursor ->
                assertTrue(cursor.moveToFirst()); assertEquals("RETRY", cursor.getString(0)); assertEquals(2, cursor.getInt(1))
                assertEquals("/synthetic/photo.jpg", cursor.getString(2))
            }
            database.query("SELECT label, usageCount FROM dictionary_values WHERE id = 'dictionary-1'").use { cursor ->
                assertTrue(cursor.moveToFirst()); assertEquals("ТО", cursor.getString(0)); assertEquals(3, cursor.getInt(1))
            }
        }
    }

    private companion object {
        const val DATABASE_NAME = "migration-test"
    }
}
