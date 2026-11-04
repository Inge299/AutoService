package ru.autoservice.spike.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import ru.autoservice.spike.AutoServiceApplication
import ru.autoservice.spike.network.ApiException
import ru.autoservice.spike.data.ReportMediaReadinessException
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
            if (transient) {
                Result.retry()
            } else {
                val message = when {
                    error is ReportMediaReadinessException -> error.message ?: "Проверьте материалы отчёта"
                    error is ApiException && error.message == "report_media_failed" -> "Не удалось подготовить материалы на сервере. Обратитесь к администратору"
                    error is ApiException && error.message == "report_media_pending" -> "Дождитесь загрузки и проверки всех материалов отчёта"
                    error is ApiException && error.message == "report_media_changed" -> "Список материалов изменился. Обновите визит и заново проверьте отчёт"
                    error is ApiException && error.message == "private_findings_changed" -> "Список черновиков изменился. Обновите визит и заново проверьте отчёт"
                    error is ApiException && error.message == "report_client_update_required" -> "Обновите приложение перед публикацией отчёта"
                    else -> "Не удалось опубликовать отчёт. Проверьте визит и повторите"
                }
                repository.markFailed(visitId, message)
                Result.failure()
            }
        }
    }
}
