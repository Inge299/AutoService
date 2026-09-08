package ru.autoservice.spike.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import ru.autoservice.spike.AutoServiceApplication
import ru.autoservice.spike.data.SyncState
import java.io.FileNotFoundException
import java.io.IOException

class MediaUploadWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val mediaId = inputData.getString(MEDIA_ID) ?: return Result.failure()
        val container = (applicationContext as AutoServiceApplication).container
        val dao = container.database.mediaDao()
        val asset = dao.find(mediaId) ?: return Result.success()

        if (asset.syncState == SyncState.SYNCED) return Result.success()

        if (!container.fileStore.verify(asset.localPath, asset.byteCount, asset.sha256)) {
            dao.updateProgress(
                id = asset.id,
                state = SyncState.BLOCKED,
                attempts = asset.uploadAttempts,
                error = "Локальный файл отсутствует или повреждён",
                updatedAt = System.currentTimeMillis(),
            )
            return Result.failure()
        }

        dao.markUploading(asset, System.currentTimeMillis())

        return try {
            val receipt = container.uploadTransport.upload(asset)
            check(receipt.byteCount == asset.byteCount) { "Server byte count mismatch" }
            check(receipt.sha256 == asset.sha256) { "Server checksum mismatch" }
            dao.markSynced(asset.id, receipt.remoteKey, System.currentTimeMillis())
            Result.success()
        } catch (error: FileNotFoundException) {
            block(dao = dao, asset = asset, message = error.message ?: "Файл не найден")
            Result.failure()
        } catch (error: IllegalArgumentException) {
            block(dao = dao, asset = asset, message = error.message ?: "Некорректный файл")
            Result.failure()
        } catch (error: IOException) {
            retry(dao = dao, asset = asset, message = error.message ?: "Ошибка сети")
            Result.retry()
        } catch (error: Exception) {
            retry(dao = dao, asset = asset, message = error.message ?: "Временная ошибка")
            Result.retry()
        }
    }

    private suspend fun retry(
        dao: ru.autoservice.spike.data.MediaDao,
        asset: ru.autoservice.spike.data.MediaAssetEntity,
        message: String,
    ) {
        dao.updateProgress(
            id = asset.id,
            state = SyncState.RETRY,
            attempts = asset.uploadAttempts + 1,
            error = message,
            updatedAt = System.currentTimeMillis(),
        )
    }

    private suspend fun block(
        dao: ru.autoservice.spike.data.MediaDao,
        asset: ru.autoservice.spike.data.MediaAssetEntity,
        message: String,
    ) {
        dao.updateProgress(
            id = asset.id,
            state = SyncState.BLOCKED,
            attempts = asset.uploadAttempts + 1,
            error = message,
            updatedAt = System.currentTimeMillis(),
        )
    }

    companion object {
        const val MEDIA_ID = "media-id"
    }
}

