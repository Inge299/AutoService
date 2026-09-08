package ru.autoservice.spike.data

import ru.autoservice.spike.media.MediaFileStore
import ru.autoservice.spike.sync.UploadScheduler
import java.io.File
import java.util.UUID

class MediaRepository(
    private val mediaDao: MediaDao,
    private val fileStore: MediaFileStore,
    private val scheduler: UploadScheduler,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val assets = mediaDao.observeAll()

    suspend fun registerCaptured(
        visitId: String,
        findingId: String? = null,
        kind: MediaKind,
        mimeType: String,
        file: File,
    ): MediaAssetEntity {
        val committedFile = if (file.name.endsWith(".capture")) {
            fileStore.commitCapture(file)
        } else {
            file
        }
        val stored = fileStore.requireComplete(committedFile)
        val now = clock()
        val asset = MediaAssetEntity(
            id = UUID.randomUUID().toString(),
            operationId = UUID.randomUUID().toString(),
            visitId = visitId,
            findingId = findingId,
            kind = kind,
            mimeType = mimeType,
            localPath = stored.path,
            byteCount = stored.byteCount,
            sha256 = stored.sha256,
            syncState = SyncState.QUEUED,
            uploadAttempts = 0,
            remoteKey = null,
            lastError = null,
            createdAtEpochMs = now,
            updatedAtEpochMs = now,
        )
        mediaDao.insert(asset)
        scheduler.enqueue(asset.id)
        return asset
    }

    suspend fun reschedulePending() {
        mediaDao.pending().forEach { scheduler.enqueue(it.id) }
    }

    suspend fun recoverAndReschedule() {
        val knownPaths = mediaDao.allLocalPaths().toHashSet()
        fileStore.committedFiles()
            .filterNot { it.absolutePath in knownPaths }
            .forEach { file ->
                val kind = fileStore.mediaKind(file) ?: return@forEach
                val mimeType = fileStore.mimeType(file) ?: return@forEach
                val visitId = fileStore.visitId(file) ?: return@forEach
                val findingId = fileStore.findingId(file)
                registerCaptured(
                    visitId = visitId,
                    findingId = findingId,
                    kind = kind,
                    mimeType = mimeType,
                    file = file,
                )
            }
        reschedulePending()
    }

}
