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
        val root = (applicationContext as AutoServiceApplication).container
        val workshopId = inputData.getString("workshop-id") ?: return Result.failure()
        if (root.authStore.session.value?.workshopId != workshopId) return Result.failure()
        val container = root.forWorkshop(workshopId)
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
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: ru.autoservice.spike.network.ApiException) {
            if (error.statusCode in 400..499 && error.statusCode !in setOf(408, 429)) {
                block(dao, asset, if (error.statusCode == 401) "Войдите в мастерскую и повторите загрузку" else "Не удалось загрузить материал. Проверьте файл и повторите")
                Result.failure()
            } else if (runAttemptCount >= 4) {
                block(dao, asset, "Загрузка не завершена. Нажмите «Повторить»")
                Result.failure()
            } else {
                retry(dao, asset, "Сервер временно недоступен. Повторим автоматически")
                Result.retry()
            }
        } catch (error: IOException) {
            if (runAttemptCount >= 4) {
                block(dao, asset, "Загрузка не завершена. Нажмите «Повторить»")
                return Result.failure()
            }
            retry(dao = dao, asset = asset, message = "Нет связи с сервером. Повторим автоматически")
            Result.retry()
        } catch (error: Exception) {
            block(dao = dao, asset = asset, message = "Не удалось обработать файл. Нажмите «Повторить»")
            Result.failure()
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

