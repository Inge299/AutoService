package ru.autoservice.spike.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

class UploadScheduler(context: Context) {
    private val workManager = WorkManager.getInstance(context)

    fun enqueue(mediaId: String) {
        val request = OneTimeWorkRequestBuilder<MediaUploadWorker>()
            .setInputData(workDataOf(MediaUploadWorker.MEDIA_ID to mediaId))
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .setRequiresStorageNotLow(true)
                    .build(),
            )
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                15,
                TimeUnit.SECONDS,
            )
            .addTag(UPLOAD_TAG)
            .build()

        workManager.enqueueUniqueWork(
            uniqueName(mediaId),
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun cancel(mediaId: String) {
        workManager.cancelUniqueWork(uniqueName(mediaId))
    }

    companion object {
        const val UPLOAD_TAG = "media-upload"
        fun uniqueName(mediaId: String): String = "media-upload-$mediaId"
    }
}
