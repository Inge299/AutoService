package ru.autoservice.spike.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import ru.autoservice.spike.AutoServiceApplication
import ru.autoservice.spike.network.ApiException
import java.io.IOException

class ReportPublicationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val visitId = inputData.getString("visit-id") ?: return Result.failure()
        val workshopId = inputData.getString("workshop-id") ?: return Result.failure()
        val root = (applicationContext as AutoServiceApplication).container
        if (root.authStore.session.value?.workshopId != workshopId) return Result.failure()

        val repository = root.forWorkshop(workshopId).reportRepository
        return try {
            repository.publishPending(visitId)
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val transient = error is IOException &&
                (error !is ApiException || error.statusCode >= 500 || error.statusCode in setOf(408, 429))
            if (transient && runAttemptCount < 9) {
                Result.retry()
            } else {
                repository.markFailed(visitId, "Не удалось опубликовать отчёт. Проверьте сеть и повторите")
                Result.failure()
            }
        }
    }
}
