package ru.autoservice.spike

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import ru.autoservice.spike.data.VisitStatus

class AutoServiceApplication : Application() {
    lateinit var container: AppContainer
        private set

    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        applicationScope.launch {
            if (container.authStore.session.value != null) {
                val workshop = container.forWorkshop(requireNotNull(container.authStore.session.value).workshopId)
                workshop.mediaRepository.recoverAndReschedule()
                workshop.database.findingDao().all().filter { it.approvalPreparationState == "PENDING" }.forEach { workshop.uploadScheduler.enqueueApproval(it.id) }
                workshop.database.visitDao().all().filter {
                    it.reportPreparationState == "PENDING" && it.status in setOf(VisitStatus.IN_REPAIR, VisitStatus.WAITING_APPROVAL)
                }.forEach { workshop.uploadScheduler.enqueueReport(it.id) }
            }
        }
    }
}
