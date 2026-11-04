package ru.autoservice.spike.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import ru.autoservice.spike.AutoServiceApplication
import ru.autoservice.spike.network.ApiException
import java.io.IOException

class IntakeSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val workshopId = inputData.getString("workshop-id") ?: return Result.failure()
        val root = (applicationContext as AutoServiceApplication).container
        if (root.authStore.session.value?.workshopId != workshopId) return Result.failure()
        val workshop = root.forWorkshop(workshopId)
        return try {
            val snapshot = workshop.visitRepository.synchronizeLocal()
            workshop.findingRepository.synchronizeLocal(snapshot.findings)
            workshop.mediaRepository.reschedulePending()
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiException) {
            if (error.statusCode >= 500 || error.statusCode in setOf(408, 429)) Result.retry() else Result.failure()
        } catch (error: IOException) {
            Result.retry()
        }
    }
}
