package ru.autoservice.spike.data

import androidx.room.Database
import androidx.room.migration.Migration
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [VisitEntity::class, MediaAssetEntity::class, DictionaryValueEntity::class, FindingEntity::class],
    version = 6,
    exportSchema = true,
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun visitDao(): VisitDao
    abstract fun mediaDao(): MediaDao
    abstract fun dictionaryDao(): DictionaryDao
    abstract fun findingDao(): FindingDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `dictionary_values` (" +
                        "`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `label` TEXT NOT NULL, " +
                        "`normalizedValue` TEXT NOT NULL, `usageCount` INTEGER NOT NULL, " +
                        "`lastUsedAtEpochMs` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE UNIQUE INDEX IF NOT EXISTS `index_dictionary_values_kind_normalizedValue` " +
                        "ON `dictionary_values` (`kind`, `normalizedValue`)",
                )
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `findings` (" +
                        "`id` TEXT NOT NULL, `visitId` TEXT NOT NULL, `title` TEXT NOT NULL, " +
                        "`description` TEXT NOT NULL, `priceRub` INTEGER, `priority` TEXT NOT NULL, " +
                        "`status` TEXT NOT NULL, `createdAtEpochMs` INTEGER NOT NULL, " +
                        "`updatedAtEpochMs` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_findings_visitId` ON `findings` (`visitId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_findings_status` ON `findings` (`status`)")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `media_assets` ADD COLUMN `findingId` TEXT")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_media_assets_findingId` ON `media_assets` (`findingId`)")
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `visits` ADD COLUMN `serverVersion` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `findings` ADD COLUMN `serverVersion` INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `findings` ADD COLUMN `approvalOperationId` TEXT")
                db.execSQL("ALTER TABLE `findings` ADD COLUMN `approvalToken` TEXT")
                db.execSQL("ALTER TABLE `findings` ADD COLUMN `approvalPublicUrl` TEXT")
                db.execSQL("ALTER TABLE `findings` ADD COLUMN `approvalExpiresAtEpochMs` INTEGER")
            }
        }
    }
}
