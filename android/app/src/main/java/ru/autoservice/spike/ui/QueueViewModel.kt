package ru.autoservice.spike.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import ru.autoservice.spike.AutoServiceApplication
import ru.autoservice.spike.data.DictionaryKind
import ru.autoservice.spike.data.FindingDraft
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.data.SeededQuickValues
import ru.autoservice.spike.data.VisitDraft
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.network.AuthSession
import java.io.File

class QueueViewModel(application: Application) : AndroidViewModel(application) {
    private val container = (application as AutoServiceApplication).container

    val session: StateFlow<AuthSession?> = container.authStore.session

    val assets: StateFlow<List<MediaAssetEntity>> = container.mediaRepository.assets.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )

    val activeVisits: StateFlow<List<VisitEntity>> = container.visitRepository.activeVisits.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList(),
    )

    val vehicleBrandSuggestions: StateFlow<List<String>> = container.localDictionaryRepository
        .suggestions(DictionaryKind.VEHICLE_BRAND)
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = SeededQuickValues.vehicleBrands,
        )

    val complaintSuggestions: StateFlow<List<String>> = container.localDictionaryRepository
        .suggestions(DictionaryKind.COMPLAINT)
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = SeededQuickValues.complaints,
        )

    init {
        if (session.value != null) refresh()
    }

    fun login(
        login: String,
        password: String,
        onSuccess: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch {
            runCatching {
                require(login.isNotBlank()) { "Введите логин" }
                require(password.isNotBlank()) { "Введите пароль" }
                container.api.login(login, password)
                synchronize()
            }.onSuccess { onSuccess() }
                .onFailure(onFailure)
        }
    }

    fun logout() {
        container.authStore.clear()
    }

    fun refresh(onFailure: (Throwable) -> Unit = {}) {
        viewModelScope.launch {
            runCatching { synchronize() }.onFailure(onFailure)
        }
    }

    private suspend fun synchronize() {
        val snapshot = container.visitRepository.synchronizeLocal()
        container.findingRepository.synchronizeLocal(snapshot.findings)
        container.mediaRepository.recoverAndReschedule()
    }

    fun createVisit(
        draft: VisitDraft,
        onSuccess: (VisitEntity) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch {
            runCatching {
                container.visitRepository.createVisit(draft).also {
                    container.localDictionaryRepository.recordVisitValues(draft)
                }
            }
                .onSuccess(onSuccess)
                .onFailure(onFailure)
        }
    }

    fun startRepair(visit: VisitEntity, onSuccess: () -> Unit, onFailure: (Throwable) -> Unit) {
        viewModelScope.launch {
            runCatching { container.visitRepository.startRepair(visit) }
                .onSuccess { onSuccess() }
                .onFailure(onFailure)
        }
    }

    fun findingsForVisit(visitId: String): Flow<List<FindingEntity>> =
        container.findingRepository.findingsForVisit(visitId)

    fun createFinding(
        draft: FindingDraft,
        onSuccess: (FindingEntity) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch {
            runCatching { container.findingRepository.createFinding(draft) }
                .onSuccess(onSuccess)
                .onFailure(onFailure)
        }
    }

    fun updateFinding(
        finding: FindingEntity,
        draft: FindingDraft,
        onSuccess: (FindingEntity) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch {
            runCatching { container.findingRepository.updateDraft(finding, draft) }
                .onSuccess(onSuccess)
                .onFailure(onFailure)
        }
    }

    fun prepareFinding(
        finding: FindingEntity,
        onSuccess: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch {
            runCatching { container.findingRepository.prepareForApproval(finding) }
                .onSuccess { onSuccess() }
                .onFailure(onFailure)
        }
    }

    fun recordCustomerDecision(
        finding: FindingEntity,
        decision: ru.autoservice.spike.data.FindingStatus,
        onSuccess: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch {
            runCatching { container.findingRepository.recordCustomerDecision(finding, decision) }
                .onSuccess { onSuccess() }
                .onFailure(onFailure)
        }
    }

    fun newCaptureFile(visitId: String, kind: MediaKind, findingId: String? = null): File =
        container.fileStore.newCaptureFile(visitId, kind, findingId)

    fun registerCapture(
        visitId: String,
        findingId: String? = null,
        kind: MediaKind,
        mimeType: String,
        file: File,
        onSuccess: () -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        viewModelScope.launch(NonCancellable + Dispatchers.IO) {
            runCatching {
                container.mediaRepository.registerCaptured(
                    visitId = visitId,
                    findingId = findingId,
                    kind = kind,
                    mimeType = mimeType,
                    file = file,
                )
            }.onSuccess { onSuccess() }
                .onFailure(onFailure)
        }
    }

    fun retry(asset: MediaAssetEntity) {
        container.uploadScheduler.enqueue(asset.id)
    }
}
