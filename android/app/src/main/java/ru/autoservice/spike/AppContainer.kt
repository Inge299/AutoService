package ru.autoservice.spike

import android.content.Context
import androidx.room.Room
import ru.autoservice.spike.data.AppDatabase
import ru.autoservice.spike.data.FindingRepository
import ru.autoservice.spike.data.LocalDictionaryRepository
import ru.autoservice.spike.data.MediaRepository
import ru.autoservice.spike.data.VisitRepository
import ru.autoservice.spike.media.MediaFileStore
import ru.autoservice.spike.sync.LocalMirrorUploadTransport
import ru.autoservice.spike.sync.UploadScheduler
import ru.autoservice.spike.sync.UploadTransport

class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val database: AppDatabase = Room.databaseBuilder(
        appContext,
        AppDatabase::class.java,
        "autoservice-spike.db",
    ).addMigrations(
        AppDatabase.MIGRATION_1_2,
        AppDatabase.MIGRATION_2_3,
        AppDatabase.MIGRATION_3_4,
    ).build()

    val fileStore = MediaFileStore(appContext)
    val uploadScheduler = UploadScheduler(appContext)

    // This is deliberately swappable. The first spike validates Android
    // persistence and scheduling before the real resumable HTTP API exists.
    val uploadTransport: UploadTransport = LocalMirrorUploadTransport(appContext)

    val mediaRepository = MediaRepository(
        mediaDao = database.mediaDao(),
        fileStore = fileStore,
        scheduler = uploadScheduler,
    )

    val visitRepository = VisitRepository(database.visitDao())
    val localDictionaryRepository = LocalDictionaryRepository(database.dictionaryDao())
    val findingRepository = FindingRepository(database.findingDao())
}
