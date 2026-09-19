package ru.autoservice.spike.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import ru.autoservice.spike.AutoServiceApplication
import ru.autoservice.spike.network.ApiException
import java.io.IOException

class ApprovalPreparationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("finding-id") ?: return Result.failure()
        val workshopId = inputData.getString("workshop-id") ?: return Result.failure()
        val root = (applicationContext as AutoServiceApplication).container
        if (root.authStore.session.value?.workshopId != workshopId) return Result.failure()
        val repository = root.forWorkshop(workshopId).findingRepository
        return try {
            repository.processPending(id)
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val transient = error is IOException && (error !is ApiException || error.statusCode >= 500 || error.statusCode in setOf(408, 429))
            if (transient && runAttemptCount < 9) Result.retry() else {
                repository.preparationFailed(id, "Не удалось подготовить ссылку. Проверьте загрузку материалов и повторите")
                Result.failure()
            }
        }
    }
}
