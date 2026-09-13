package ru.autoservice.spike

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.graphics.BitmapFactory
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Surface
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.CircleShape
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.data.FindingDraft
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingStatus
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitDraft
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitStatus
import ru.autoservice.spike.media.VoiceRecorder
import ru.autoservice.spike.ui.CameraCaptureScreen
import ru.autoservice.spike.ui.QueueViewModel
import ru.autoservice.spike.ui.theme.AutoServiceTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AutoServiceTheme { AutoServiceApp() } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AutoServiceApp(viewModel: QueueViewModel = viewModel()) {
    val context = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val visits by viewModel.activeVisits.collectAsState()
    val vehicleBrandSuggestions by viewModel.vehicleBrandSuggestions.collectAsState()
    val complaintSuggestions by viewModel.complaintSuggestions.collectAsState()
    val session by viewModel.session.collectAsState()
    var selectedVisitId by remember { mutableStateOf<String?>(null) }
    var creatingVisit by remember { mutableStateOf(false) }
    var creatingFindingForVisitId by remember { mutableStateOf<String?>(null) }
    var showCamera by remember { mutableStateOf(false) }
    var captureFindingId by remember { mutableStateOf<String?>(null) }
    var customerPreviewFinding by remember { mutableStateOf<FindingEntity?>(null) }
    var editingFinding by remember { mutableStateOf<FindingEntity?>(null) }

    val capturePermissions = remember {
        arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    }
    var capturePermissionsGranted by remember {
        mutableStateOf(
            capturePermissions.all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            },
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        capturePermissionsGranted = capturePermissions.all { permission ->
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        }
    }
    val message: (String) -> Unit = { text ->
        scope.launch { snackbarHost.showSnackbar(text) }
    }

    if (session == null) {
        Scaffold(
            topBar = { TopAppBar(title = { Text("AutoService") }) },
            snackbarHost = { SnackbarHost(snackbarHost) },
        ) { padding ->
            LoginScreen(
                onLogin = { login, password, completed ->
                    viewModel.login(
                        login = login,
                        password = password,
                        onSuccess = completed,
                        onFailure = {
                            completed()
                            message(if (it.message == "invalid_credentials") "Неверный логин или пароль" else it.message ?: "Не удалось войти")
                        },
                    )
                },
                modifier = Modifier.padding(padding),
            )
        }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AutoService · ${session?.displayName}") },
                actions = { TextButton(onClick = viewModel::logout) { Text("Выйти") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        val selectedVisit = visits.firstOrNull { it.id == selectedVisitId }
        when {
            showCamera && selectedVisit != null && capturePermissionsGranted -> {
                CameraCaptureScreen(
                    visitId = selectedVisit.id,
                    findingId = captureFindingId,
                    viewModel = viewModel,
                    onClose = {
                        showCamera = false
                        captureFindingId = null
                    },
                    onMessage = message,
                    modifier = Modifier.padding(padding),
                )
            }

            creatingVisit -> IntakeScreen(
                vehicleBrands = vehicleBrandSuggestions,
                commonComplaints = complaintSuggestions,
                onCancel = { creatingVisit = false },
                onSave = { draft ->
                    viewModel.createVisit(
                        draft = draft,
                        onSuccess = { visit ->
                            creatingVisit = false
                            selectedVisitId = visit.id
                            message("Визит сохранён на сервере")
                        },
                        onFailure = { message(it.message ?: "Не удалось создать визит") },
                    )
                },
                modifier = Modifier.padding(padding),
            )

            creatingFindingForVisitId != null -> FindingScreen(
                existingFinding = null,
                visitId = creatingFindingForVisitId!!,
                onCancel = { creatingFindingForVisitId = null },
                onSave = { draft ->
                    viewModel.createFinding(
                        draft = draft,
                        onSuccess = {
                            creatingFindingForVisitId = null
                            message("Находка сохранена на сервере")
                        },
                        onFailure = { message(it.message ?: "Не удалось сохранить находку") },
                    )
                },
                modifier = Modifier.padding(padding),
            )

            editingFinding != null -> FindingScreen(
                existingFinding = editingFinding,
                visitId = editingFinding!!.visitId,
                onCancel = { editingFinding = null },
                onSave = { draft ->
                    viewModel.updateFinding(
                        finding = editingFinding!!,
                        draft = draft,
                        onSuccess = {
                            editingFinding = null
                            message("Черновик находки обновлён")
                        },
                        onFailure = { message(it.message ?: "Не удалось обновить находку") },
                    )
                },
                modifier = Modifier.padding(padding),
            )

            customerPreviewFinding != null -> CustomerPreviewScreen(
                finding = customerPreviewFinding!!,
                viewModel = viewModel,
                onBack = { customerPreviewFinding = null },
                onDecision = { decision ->
                    viewModel.recordCustomerDecision(
                        finding = customerPreviewFinding!!,
                        decision = decision,
                        onSuccess = {
                            customerPreviewFinding = null
                            message("Решение клиента сохранено")
                        },
                        onFailure = { message(it.message ?: "Не удалось сохранить решение") },
                    )
                },
                modifier = Modifier.padding(padding),
            )

            selectedVisit != null -> VisitScreen(
                visit = selectedVisit,
                viewModel = viewModel,
                capturePermissionsGranted = capturePermissionsGranted,
                onRequestPermissions = { permissionLauncher.launch(capturePermissions) },
                onOpenCamera = { showCamera = true },
                onOpenFindingCamera = { findingId ->
                    captureFindingId = findingId
                    showCamera = true
                },
                onPrepareFinding = { finding ->
                    viewModel.prepareFinding(
                        finding = finding,
                        onSuccess = { message("Находка готова к согласованию") },
                        onFailure = { message(it.message ?: "Не удалось подготовить находку") },
                    )
                },
                onOpenCustomerPreview = { finding -> customerPreviewFinding = finding },
                onEditFinding = { finding -> editingFinding = finding },
                onStartRepair = {
                    viewModel.startRepair(
                        visit = selectedVisit,
                        onSuccess = { message("Ремонт начат") },
                        onFailure = { message(it.message ?: "Не удалось начать ремонт") },
                    )
                },
                onCreateFinding = { creatingFindingForVisitId = selectedVisit.id },
                onBack = { selectedVisitId = null },
                onMessage = message,
                modifier = Modifier.padding(padding),
            )

            else -> VisitsScreen(
                visits = visits,
                onCreate = { creatingVisit = true },
                onOpen = { selectedVisitId = it.id },
                modifier = Modifier.padding(padding),
            )
        }
    }
}

@Composable
private fun LoginScreen(
    onLogin: (String, String, () -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = modifier.fillMaxSize().padding(24.dp),
    ) {
        Spacer(Modifier.height(36.dp))
        Text("Вход в мастерскую", style = MaterialTheme.typography.headlineMedium)
        Text("Используйте учётные данные, выданные администратором.")
        OutlinedTextField(
            value = login,
            onValueChange = { login = it },
            label = { Text("Логин") },
            enabled = !loading,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Пароль") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            enabled = !loading,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = {
                loading = true
                onLogin(login, password) { loading = false }
            },
            enabled = !loading && login.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (loading) "Подключение…" else "Войти") }
        Text(
            "Все визиты и находки сохраняются на сервере. Медиа остаются на устройстве только до подтверждённой загрузки.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun CustomerPreviewScreen(
    finding: FindingEntity,
    viewModel: QueueViewModel,
    onBack: () -> Unit,
    onDecision: (FindingStatus) -> Unit,
    modifier: Modifier = Modifier,
) {
    val assets by viewModel.assets.collectAsState()
    val photos = assets.filter { it.findingId == finding.id && it.kind == MediaKind.PHOTO }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(bottom = 24.dp),
        modifier = modifier.fillMaxSize().padding(16.dp),
    ) {
        item { Text("Согласование работ", style = MaterialTheme.typography.headlineSmall) }
        item { Text("Предпросмотр страницы клиента", style = MaterialTheme.typography.bodySmall) }
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(finding.title, style = MaterialTheme.typography.titleLarge)
                    finding.description.takeIf(String::isNotBlank)?.let { Text(it) }
                    Text(
                        finding.priceRub?.let { "Стоимость: $it ₽" } ?: "Стоимость уточняется",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text("Приоритет: ${finding.priority.label()}")
                }
            }
        }
        item {
            Text("Фото", style = MaterialTheme.typography.titleMedium)
            if (photos.isEmpty()) {
                Text("Фотографий пока нет", style = MaterialTheme.typography.bodySmall)
            } else {
                photos.take(3).forEach { asset -> LocalPhoto(asset.localPath) }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(onClick = { onDecision(FindingStatus.APPROVED) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Согласовать")
                }
                Button(onClick = { onDecision(FindingStatus.DECLINED) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Отклонить")
                }
                Button(onClick = { onDecision(FindingStatus.DEFERRED) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Отложить")
                }
                TextButton(onClick = { onDecision(FindingStatus.CALL_REQUESTED) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Нужен звонок")
                }
                TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Назад мастеру") }
            }
        }
    }
}

@Composable
private fun LocalPhoto(path: String) {
    val image = remember(path) { BitmapFactory.decodeFile(path)?.asImageBitmap() }
    if (image != null) {
        Image(
            bitmap = image,
            contentDescription = "Фото неисправности",
            modifier = Modifier.fillMaxWidth().height(220.dp),
        )
    } else {
        Text("Фото недоступно на этом устройстве", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun FindingScreen(
    existingFinding: FindingEntity?,
    visitId: String,
    onCancel: () -> Unit,
    onSave: (FindingDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    var title by remember(existingFinding?.id) { mutableStateOf(existingFinding?.title.orEmpty()) }
    var description by remember(existingFinding?.id) { mutableStateOf(existingFinding?.description.orEmpty()) }
    var price by remember(existingFinding?.id) { mutableStateOf(existingFinding?.priceRub?.toString().orEmpty()) }
    var priority by remember(existingFinding?.id) { mutableStateOf(existingFinding?.priority ?: FindingPriority.IMPORTANT) }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = PaddingValues(bottom = 24.dp),
        modifier = modifier.fillMaxSize().padding(16.dp),
    ) {
        item { Text(if (existingFinding == null) "Новая находка" else "Изменить находку", style = MaterialTheme.typography.headlineSmall) }
        item { FormField(title, { title = it }, "Что обнаружено *") }
        item {
            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text("Пояснение для клиента") },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            OutlinedTextField(
                value = price,
                onValueChange = { price = it.filter(Char::isDigit).take(7) },
                label = { Text("Цена работ, ₽") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            QuickChoiceRow(
                title = "Приоритет",
                values = FindingPriority.entries.map(FindingPriority::label),
                onChoose = { selected -> priority = FindingPriority.entries.first { it.label() == selected } },
            )
        }
        item {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Button(
                    onClick = {
                        onSave(
                            FindingDraft(
                                visitId = visitId,
                                title = title,
                                description = description,
                                priceRub = price.toIntOrNull(),
                                priority = priority,
                            ),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Сохранить") }
                TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
            }
        }
    }
}

@Composable
private fun VisitsScreen(
    visits: List<VisitEntity>,
    onCreate: () -> Unit,
    onOpen: (VisitEntity) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().padding(16.dp)) {
        Button(onClick = onCreate, modifier = Modifier.fillMaxWidth()) {
            Text("Принять автомобиль")
        }
        Spacer(Modifier.height(16.dp))
        Text("Активные визиты", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        if (visits.isEmpty()) {
            Text("Пока нет визитов. Первый можно создать без подключения к сети.")
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visits, key = { it.id }) { visit ->
                    Card(onClick = { onOpen(visit) }, modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Text(
                                visit.vehicleLabel.ifBlank { visit.licensePlate },
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text("${visit.customerName.ifBlank { "Клиент" }} · ${visit.customerPhone}")
                            StatusPill(visit.status.label(), visit.status.color())
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun IntakeScreen(
    vehicleBrands: List<String>,
    commonComplaints: List<String>,
    onCancel: () -> Unit,
    onSave: (VisitDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    var customerName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var vehicle by remember { mutableStateOf("") }
    var plate by remember { mutableStateOf("") }
    var mileage by remember { mutableStateOf("") }
    var complaint by remember { mutableStateOf("") }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = PaddingValues(bottom = 24.dp),
        modifier = modifier.fillMaxSize().padding(16.dp),
    ) {
        item { Text("Новый визит", style = MaterialTheme.typography.headlineSmall) }
        item {
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text("Телефон клиента *") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item { FormField(customerName, { customerName = it }, "Имя клиента") }
        item { FormField(vehicle, { vehicle = it }, "Автомобиль") }
        item {
            QuickChoiceRow(
                title = "Частые марки",
                values = vehicleBrands,
                onChoose = { brand -> vehicle = vehicle.withVehicleBrand(brand, vehicleBrands) },
            )
        }
        item { FormField(plate, { plate = it }, "Госномер") }
        item {
            OutlinedTextField(
                value = mileage,
                onValueChange = { mileage = it.filter(Char::isDigit).take(7) },
                label = { Text("Пробег, км") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            QuickChoiceRow(
                title = "Частые жалобы",
                values = commonComplaints,
                onChoose = { value -> complaint = complaint.addQuickValue(value) },
            )
        }
        item {
            OutlinedTextField(
                value = complaint,
                onValueChange = { complaint = it },
                label = { Text("Жалобы клиента") },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Button(
                    onClick = {
                        onSave(
                            VisitDraft(
                                customerName = customerName,
                                customerPhone = phone,
                                vehicleLabel = vehicle,
                                licensePlate = plate,
                                mileageKm = mileage.toIntOrNull(),
                                complaint = complaint,
                            ),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Сохранить") }
                TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
            }
        }
    }
}

@Composable
private fun QuickChoiceRow(
    title: String,
    values: List<String>,
    onChoose: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge)
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
        ) {
            values.forEach { value ->
                AssistChip(onClick = { onChoose(value) }, label = { Text(value) })
            }
        }
    }
}

@Composable
private fun FormField(value: String, onChange: (String) -> Unit, label: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun String.withVehicleBrand(brand: String, knownBrands: List<String>): String {
    val remainder = trim().removePrefixIgnoreCase(knownBrands)
    return listOf(brand, remainder).filter { it.isNotBlank() }.joinToString(" ")
}

private fun String.removePrefixIgnoreCase(prefixes: List<String>): String {
    val match = prefixes.firstOrNull { startsWith(it, ignoreCase = true) } ?: return this
    return drop(match.length).trimStart()
}

private fun String.addQuickValue(value: String): String = when {
    isBlank() -> value
    split(',').any { it.trim().equals(value, ignoreCase = true) } -> this
    else -> "$this, $value"
}

@Composable
private fun VisitScreen(
    visit: VisitEntity,
    viewModel: QueueViewModel,
    capturePermissionsGranted: Boolean,
    onRequestPermissions: () -> Unit,
    onOpenCamera: () -> Unit,
    onOpenFindingCamera: (String) -> Unit,
    onPrepareFinding: (FindingEntity) -> Unit,
    onOpenCustomerPreview: (FindingEntity) -> Unit,
    onEditFinding: (FindingEntity) -> Unit,
    onStartRepair: () -> Unit,
    onCreateFinding: () -> Unit,
    onBack: () -> Unit,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val allAssets by viewModel.assets.collectAsState()
    val assets = allAssets.filter { it.visitId == visit.id }
    val findings by viewModel.findingsForVisit(visit.id).collectAsState(initial = emptyList())
    val voiceRecorder = remember { VoiceRecorder(context) }
    var recordingVoice by remember { mutableStateOf(false) }
    var voiceFindingId by remember { mutableStateOf<String?>(null) }

    fun toggleVoice(findingId: String? = null) {
        if (!recordingVoice) {
            voiceFindingId = findingId
            val output = viewModel.newCaptureFile(visit.id, MediaKind.VOICE, findingId)
            runCatching { voiceRecorder.start(output) }
                .onSuccess { recordingVoice = true }
                .onFailure {
                    voiceFindingId = null
                    onMessage(it.message ?: "Не удалось начать запись")
                }
        } else {
            val completed = voiceRecorder.stop()
            val recordedFindingId = voiceFindingId
            recordingVoice = false
            voiceFindingId = null
            if (completed != null) {
                viewModel.registerCapture(
                    visitId = visit.id,
                    findingId = recordedFindingId,
                    kind = MediaKind.VOICE,
                    mimeType = "audio/mp4",
                    file = completed,
                    onSuccess = { onMessage("Голос отправлен в очередь сервера") },
                    onFailure = { onMessage(it.message ?: "Не удалось сохранить запись") },
                )
            } else {
                onMessage("Запись слишком короткая или повреждена")
            }
        }
    }

    DisposableEffect(Unit) { onDispose { voiceRecorder.release() } }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onBack) { Text("← Визиты") }
            StatusPill(visit.status.label(), visit.status.color())
        }
        Text(
            visit.vehicleLabel.ifBlank { visit.licensePlate },
            style = MaterialTheme.typography.headlineSmall,
        )
        Text("${visit.customerName.ifBlank { "Клиент" }} · ${visit.customerPhone}")
        visit.mileageKm?.let { Text("Пробег: $it км") }
        if (visit.complaint.isNotBlank()) Text("Жалоба: ${visit.complaint}")
        Spacer(Modifier.height(16.dp))

        if (visit.status == VisitStatus.DRAFT) {
            Button(onClick = onStartRepair, modifier = Modifier.fillMaxWidth()) {
                Text("Начать ремонт")
            }
            Spacer(Modifier.height(12.dp))
        }

        VisitTimeline(
            findingCount = findings.size,
            readyForApprovalCount = findings.count { it.status == FindingStatus.READY_FOR_APPROVAL },
            materialCount = assets.size,
        )
        Spacer(Modifier.height(16.dp))

        if (!capturePermissionsGranted) {
            Button(onClick = onRequestPermissions, modifier = Modifier.fillMaxWidth()) {
                Text("Разрешить камеру и микрофон")
            }
        } else {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Button(onClick = onOpenCamera, modifier = Modifier.fillMaxWidth()) {
                    Text("Фото / видео")
                }
                Button(onClick = onCreateFinding, modifier = Modifier.fillMaxWidth()) {
                    Text("Добавить находку")
                }
                Button(
                    onClick = { toggleVoice() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (recordingVoice) "Остановить запись" else "Записать голос") }
            }
        }

        Spacer(Modifier.height(18.dp))
        Text("Находки: ${findings.size}", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        if (findings.isEmpty()) {
            Text("Пока нет находок. Добавьте проблему и ориентировочную цену.")
        } else {
            findings.take(3).forEach { finding ->
                FindingCard(
                    finding = finding,
                    materialCount = assets.count { it.findingId == finding.id },
                    onOpenCamera = { onOpenFindingCamera(finding.id) },
                    onToggleVoice = { toggleVoice(finding.id) },
                    recordingVoice = recordingVoice && voiceFindingId == finding.id,
                    onPrepare = { onPrepareFinding(finding) },
                    onOpenCustomerPreview = { onOpenCustomerPreview(finding) },
                    onEdit = { onEditFinding(finding) },
                )
            }
        }
        Spacer(Modifier.height(18.dp))
        Text(
            "Материалы: ${assets.size} · ожидают: ${assets.count { it.syncState != SyncState.SYNCED }}",
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            assets.forEach { asset -> QueueItem(asset = asset, onRetry = { viewModel.retry(asset) }) }
        }
    }
}

@Composable
private fun VisitTimeline(
    findingCount: Int,
    readyForApprovalCount: Int,
    materialCount: Int,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(14.dp),
        ) {
            Text("Ход визита", style = MaterialTheme.typography.titleMedium)
            TimelineStep(
                number = "1",
                title = "Приёмка сохранена",
                detail = "Данные автомобиля подтверждены сервером",
                color = MaterialTheme.colorScheme.tertiaryContainer,
            )
            TimelineStep(
                number = "2",
                title = if (findingCount == 0) "Находок пока нет" else "Находки: $findingCount",
                detail = if (materialCount == 0) "Добавьте доказательства при необходимости" else "Материалов: $materialCount",
                color = if (findingCount == 0) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.primaryContainer,
            )
            TimelineStep(
                number = "3",
                title = if (readyForApprovalCount == 0) "Согласование не готово" else "Готово к согласованию: $readyForApprovalCount",
                detail = "Для отправки клиенту нужны цена и серверная ссылка",
                color = if (readyForApprovalCount == 0) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.secondaryContainer,
            )
        }
    }
}

@Composable
private fun TimelineStep(number: String, title: String, detail: String, color: androidx.compose.ui.graphics.Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        Surface(color = color, shape = CircleShape, modifier = Modifier.size(32.dp)) {
            Text(
                text = number,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.fillMaxSize().wrapContentSize(Alignment.Center),
            )
        }
        Column {
            Text(title, style = MaterialTheme.typography.labelLarge)
            Text(detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun FindingCard(
    finding: FindingEntity,
    materialCount: Int,
    onOpenCamera: () -> Unit,
    onToggleVoice: () -> Unit,
    recordingVoice: Boolean,
    onPrepare: () -> Unit,
    onOpenCustomerPreview: () -> Unit,
    onEdit: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(finding.title, style = MaterialTheme.typography.titleMedium)
            finding.description.takeIf(String::isNotBlank)?.let { Text(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusPill(finding.priority.label(), finding.priority.color())
                finding.priceRub?.let { StatusPill("${it} ₽", MaterialTheme.colorScheme.secondaryContainer) }
            }
            StatusPill(finding.status.label(), finding.status.color())
            Text("Материалов: $materialCount", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
            Button(onClick = onOpenCamera, modifier = Modifier.fillMaxWidth()) {
                Text("Фото / видео")
            }
            TextButton(onClick = onToggleVoice, modifier = Modifier.fillMaxWidth()) {
                Text(if (recordingVoice) "Остановить голос" else "Записать голос")
            }
            when (finding.status) {
                FindingStatus.DRAFT -> Button(onClick = onPrepare, modifier = Modifier.fillMaxWidth()) {
                    Text("Подготовить согласование")
                }
                FindingStatus.READY_FOR_APPROVAL -> Button(
                    onClick = onOpenCustomerPreview,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Открыть для клиента") }
                else -> Unit
            }
            if (finding.status == FindingStatus.DRAFT) {
                TextButton(onClick = onEdit, modifier = Modifier.fillMaxWidth()) { Text("Изменить") }
            }
        }
    }
}

@Composable
private fun QueueItem(asset: MediaAssetEntity, onRetry: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("${asset.kind.label()} · ${asset.syncState.label()}")
            Text(
                "${asset.byteCount / 1024} КБ · попыток: ${asset.uploadAttempts}",
                style = MaterialTheme.typography.bodySmall,
            )
            asset.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (asset.syncState == SyncState.RETRY || asset.syncState == SyncState.BLOCKED) {
                Button(onClick = onRetry) { Text("Повторить") }
            }
        }
    }
}

private fun MediaKind.label(): String = when (this) {
    MediaKind.PHOTO -> "Фото"
    MediaKind.VIDEO -> "Видео"
    MediaKind.VOICE -> "Голос"
}

private fun SyncState.label(): String = when (this) {
    SyncState.LOCAL -> "на телефоне"
    SyncState.QUEUED -> "в очереди"
    SyncState.UPLOADING -> "загружается"
    SyncState.SYNCED -> "загружено"
    SyncState.RETRY -> "ожидает повтора"
    SyncState.BLOCKED -> "нужно внимание"
}

private fun VisitStatus.label(): String = when (this) {
    VisitStatus.DRAFT -> "Черновик"
    VisitStatus.IN_REPAIR -> "В ремонте"
    VisitStatus.WAITING_APPROVAL -> "Ожидает согласования"
    VisitStatus.COMPLETED -> "Завершён"
    VisitStatus.CANCELLED -> "Отменён"
}

@Composable
private fun StatusPill(label: String, color: androidx.compose.ui.graphics.Color) {
    Surface(
        color = color,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = MaterialTheme.shapes.small,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun VisitStatus.color(): androidx.compose.ui.graphics.Color = when (this) {
    VisitStatus.DRAFT -> MaterialTheme.colorScheme.surfaceVariant
    VisitStatus.IN_REPAIR -> MaterialTheme.colorScheme.primaryContainer
    VisitStatus.WAITING_APPROVAL -> MaterialTheme.colorScheme.secondaryContainer
    VisitStatus.COMPLETED -> MaterialTheme.colorScheme.tertiaryContainer
    VisitStatus.CANCELLED -> MaterialTheme.colorScheme.errorContainer
}

@Composable
private fun FindingPriority.color(): androidx.compose.ui.graphics.Color = when (this) {
    FindingPriority.CRITICAL -> MaterialTheme.colorScheme.errorContainer
    FindingPriority.IMPORTANT -> MaterialTheme.colorScheme.secondaryContainer
    FindingPriority.PLANNED -> MaterialTheme.colorScheme.surfaceVariant
}

@Composable
private fun FindingStatus.color(): androidx.compose.ui.graphics.Color = when (this) {
    FindingStatus.DRAFT -> MaterialTheme.colorScheme.surfaceVariant
    FindingStatus.READY_FOR_APPROVAL, FindingStatus.SENT_TO_CUSTOMER -> MaterialTheme.colorScheme.secondaryContainer
    FindingStatus.APPROVED -> MaterialTheme.colorScheme.tertiaryContainer
    FindingStatus.DECLINED -> MaterialTheme.colorScheme.errorContainer
    FindingStatus.CALL_REQUESTED -> MaterialTheme.colorScheme.primaryContainer
    FindingStatus.DEFERRED -> MaterialTheme.colorScheme.surfaceVariant
}

private fun FindingPriority.label(): String = when (this) {
    FindingPriority.CRITICAL -> "Критично"
    FindingPriority.IMPORTANT -> "Важно"
    FindingPriority.PLANNED -> "Планово"
}

private fun ru.autoservice.spike.data.FindingStatus.label(): String = when (this) {
    ru.autoservice.spike.data.FindingStatus.DRAFT -> "Черновик"
    ru.autoservice.spike.data.FindingStatus.READY_FOR_APPROVAL -> "Готово к согласованию"
    ru.autoservice.spike.data.FindingStatus.SENT_TO_CUSTOMER -> "Отправлено клиенту"
    ru.autoservice.spike.data.FindingStatus.APPROVED -> "Согласовано"
    ru.autoservice.spike.data.FindingStatus.DECLINED -> "Отклонено"
    ru.autoservice.spike.data.FindingStatus.CALL_REQUESTED -> "Нужен звонок"
    ru.autoservice.spike.data.FindingStatus.DEFERRED -> "Отложено"
}
