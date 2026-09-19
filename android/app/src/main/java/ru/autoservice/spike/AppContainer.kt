package ru.autoservice.spike

import android.content.Context
import androidx.room.Room
import kotlinx.coroutines.flow.first
import ru.autoservice.spike.data.*
import ru.autoservice.spike.media.MediaFileStore
import ru.autoservice.spike.network.AuthStore
import ru.autoservice.spike.network.AutoServiceApi
import ru.autoservice.spike.sync.ServerUploadTransport
import ru.autoservice.spike.sync.UploadScheduler

class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    val authStore = AuthStore(appContext)
    val api = AutoServiceApi(BuildConfig.API_BASE_URL, authStore)
    private val workshops = mutableMapOf<String, WorkshopContainer>()

    @Synchronized
    fun forWorkshop(id: String): WorkshopContainer {
        require(id.matches(Regex("[A-Za-z0-9-]+")))
        return workshops.getOrPut(id) { WorkshopContainer(appContext, id, authStore) }
    }
    private val current get() = forWorkshop(requireNotNull(authStore.session.value) { "Войдите в систему" }.workshopId)
    val database get() = current.database
    val fileStore get() = current.fileStore
    val uploadScheduler get() = current.uploadScheduler
    val mediaRepository get() = current.mediaRepository
    val visitRepository get() = current.visitRepository
    val findingRepository get() = current.findingRepository
    val localDictionaryRepository get() = current.localDictionaryRepository
}

class WorkshopContainer(context: Context, val workshopId: String, authStore: AuthStore) {
    val database = database(context, "autoservice-$workshopId.db")
    val fileStore = MediaFileStore(context, workshopId)
    val uploadScheduler = UploadScheduler(context, workshopId)
    val api = AutoServiceApi(BuildConfig.API_BASE_URL, authStore, workshopId)
    val uploadTransport = ServerUploadTransport(api)
    val mediaRepository = MediaRepository(database.mediaDao(), fileStore, uploadScheduler, api)
    val visitRepository = VisitRepository(database.visitDao(), api)
    val reportRepository = ReportRepository(database.visitDao(), api)
    val findingRepository = FindingRepository(database.findingDao(), database.mediaDao(), api)
    val localDictionaryRepository = LocalDictionaryRepository(database.dictionaryDao())

    // Import only records whose ownership the authenticated server has confirmed.
    // Unknown/offline legacy records stay intact in the old database and directory.
    suspend fun recoverLegacy(context: Context, findingIds: Set<String>, visitIds: Set<String>) {
        if (!context.getDatabasePath("autoservice-spike.db").exists()) return
        val old = database(context, "autoservice-spike.db")
        try {
            val oldFindings = old.findingDao().all().associateBy { it.id }
            database.findingDao().all().filter { it.id in findingIds && it.approvalOperationId == null }.forEach { current ->
                oldFindings[current.id]?.let { legacy ->
                    database.findingDao().update(current.copy(approvalOperationId = legacy.approvalOperationId,
                        approvalToken = legacy.approvalToken, approvalPublicUrl = legacy.approvalPublicUrl,
                        approvalExpiresAtEpochMs = legacy.approvalExpiresAtEpochMs))
                }
            }
            val assets = old.mediaDao().observeAll().first()
            assets.filter { it.visitId in visitIds && (it.findingId == null || it.findingId in findingIds) }.forEach { asset ->
                if (database.mediaDao().find(asset.id) == null) {
                    val source = java.io.File(asset.localPath)
                    if (source.isFile) {
                        val imported = fileStore.importLegacy(source)
                        database.mediaDao().insert(asset.copy(localPath = imported.absolutePath))
                    }
                }
            }
        } finally { old.close() }
    }

    private fun database(context: Context, name: String): AppDatabase = Room.databaseBuilder(context, AppDatabase::class.java, name)
        .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4,
            AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6, AppDatabase.MIGRATION_6_7,
            AppDatabase.MIGRATION_7_8).build()
}
