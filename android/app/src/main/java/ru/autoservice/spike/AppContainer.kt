package ru.autoservice.spike

import android.content.Context
import androidx.room.Room
import ru.autoservice.spike.data.AppDatabase
import ru.autoservice.spike.data.FindingRepository
import ru.autoservice.spike.data.LocalDictionaryRepository
import ru.autoservice.spike.data.MediaRepository
import ru.autoservice.spike.data.VisitRepository
import ru.autoservice.spike.media.MediaFileStore
import ru.autoservice.spike.network.AuthStore
import ru.autoservice.spike.network.AutoServiceApi
import ru.autoservice.spike.sync.ServerUploadTransport
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
        AppDatabase.MIGRATION_4_5,
        AppDatabase.MIGRATION_5_6,
    ).build()

    val fileStore = MediaFileStore(appContext)
    val uploadScheduler = UploadScheduler(appContext)
    val authStore = AuthStore(appContext)
    val api = AutoServiceApi(BuildConfig.API_BASE_URL, authStore)
    val uploadTransport: UploadTransport = ServerUploadTransport(api)

    val mediaRepository = MediaRepository(
        mediaDao = database.mediaDao(),
        fileStore = fileStore,
        scheduler = uploadScheduler,
    )

    val visitRepository = VisitRepository(database.visitDao(), api)
    val localDictionaryRepository = LocalDictionaryRepository(database.dictionaryDao())
    val findingRepository = FindingRepository(database.findingDao(), database.mediaDao(), api)
}
