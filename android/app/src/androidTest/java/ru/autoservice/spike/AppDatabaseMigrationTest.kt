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
    fun migratesVisitAndFindingFromVersion5ToVersion13() {
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
            13,
            true,
            AppDatabase.MIGRATION_5_6,
            AppDatabase.MIGRATION_6_7,
            AppDatabase.MIGRATION_7_8,
            AppDatabase.MIGRATION_8_9,
            AppDatabase.MIGRATION_9_10,
            AppDatabase.MIGRATION_10_11,
            AppDatabase.MIGRATION_11_12,
            AppDatabase.MIGRATION_12_13,
        ).use { database ->
            database.query("SELECT vehicleLabel, reportOperationId, reportPreparationState, reportAcknowledgedPrivateFindingIds, reportExpectedMediaIds FROM visits WHERE id = 'visit-1'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("Lada Vesta", cursor.getString(0))
                assertTrue(cursor.isNull(1))
                assertTrue(cursor.isNull(2))
                assertTrue(cursor.isNull(3))
                assertTrue(cursor.isNull(4))
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


    @Test
    fun migratesVersion9PendingReportWithoutLosingItsDataToVersion13() {
        val name = "qa-migration-v9-v10"
        helper.createDatabase(name, 9).apply {
            execSQL("""INSERT INTO visits
                (id, customerName, customerPhone, vehicleLabel, licensePlate, mileageKm, complaint,
                 status, createdAtEpochMs, updatedAtEpochMs, syncState, serverVersion,
                 reportOperationId, reportToken, reportPreparationState, reportCompletedWork)
                VALUES ('visit-9', 'QA', '+79990000000', 'QA car', '', NULL, '',
                        'IN_REPAIR', 100, 200, 'SYNCED', 2,
                        'operation-9', 'token-9', 'PENDING', 'Работа сохранена')""")
            close()
        }
        helper.runMigrationsAndValidate(name, 13, true, AppDatabase.MIGRATION_9_10, AppDatabase.MIGRATION_10_11, AppDatabase.MIGRATION_11_12, AppDatabase.MIGRATION_12_13).use { database ->
            database.query("SELECT reportOperationId, reportToken, reportPreparationState, reportCompletedWork, reportAcknowledgedPrivateFindingIds, reportExpectedMediaIds FROM visits WHERE id = 'visit-9'").use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("operation-9", cursor.getString(0))
                assertEquals("token-9", cursor.getString(1))
                assertEquals("PENDING", cursor.getString(2))
                assertEquals("Работа сохранена", cursor.getString(3))
                assertTrue(cursor.isNull(4))
                assertTrue(cursor.isNull(5))
            }
        }
    }

    private companion object {
        const val DATABASE_NAME = "migration-test"
    }
}
