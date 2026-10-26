package ru.autoservice.spike

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.os.Bundle
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.BorderStroke
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.data.ReportDraft
import ru.autoservice.spike.data.FindingDraft
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingStatus
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitDraft
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitStatus
import ru.autoservice.spike.media.VoiceRecorder
import ru.autoservice.spike.network.OtpChallenge
import ru.autoservice.spike.network.ApiException
import ru.autoservice.spike.network.CustomerMatch
import ru.autoservice.spike.ui.CameraCaptureScreen
import ru.autoservice.spike.ui.QueueViewModel
import ru.autoservice.spike.ui.ReportComposerDialog
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
    val visits by viewModel.visits.collectAsState()
    val mediaQueue by viewModel.assets.collectAsState()
    val vehicleBrandSuggestions by viewModel.vehicleBrandSuggestions.collectAsState()
    val complaintSuggestions by viewModel.complaintSuggestions.collectAsState()
    val session by viewModel.session.collectAsState()
    var selectedVisitId by remember { mutableStateOf<String?>(null) }
    var creatingVisit by remember { mutableStateOf(false) }
    var creatingFindingForVisitId by remember { mutableStateOf<String?>(null) }
    var showCamera by remember { mutableStateOf(false) }
    var captureFindingId by remember { mutableStateOf<String?>(null) }
    var editingFinding by remember { mutableStateOf<FindingEntity?>(null) }
    androidx.compose.runtime.LaunchedEffect(session?.workshopId) {
        selectedVisitId = null
        creatingVisit = false
        creatingFindingForVisitId = null
        showCamera = false
        captureFindingId = null
        editingFinding = null
    }


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

    // A customer decides in the browser, so refresh an opened visit while the
    // master is looking at it instead of requiring a manual "Обновить" tap.
    LaunchedEffect(selectedVisitId, session?.accessToken) {
        if (selectedVisitId == null || session == null) return@LaunchedEffect
        while (true) {
            delay(15_000)
            viewModel.refresh()
        }
    }

    if (session == null) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("AutoService") },
                    navigationIcon = { Image(painterResource(R.drawable.ic_launcher), null, Modifier.padding(start = 12.dp).size(36.dp)) },
                )
            },
            snackbarHost = { SnackbarHost(snackbarHost) },
        ) { padding ->
            LoginScreen(
                onPasswordLogin = { login, password, completed ->
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
                onRequestCode = { phone, completed ->
                    viewModel.requestLoginCode(
                        phone = phone,
                        onSuccess = completed,
                        onFailure = {
                            completed(null)
                            message(authErrorMessage(it))
                        },
                    )
                },
                onVerifyCode = { challengeId, code, completed ->
                    viewModel.verifyLoginCode(
                        challengeId = challengeId,
                        code = code,
                        onSuccess = completed,
                        onFailure = {
                            completed()
                            message(authErrorMessage(it))
                        },
                    )
                },
                modifier = Modifier.padding(padding),
            )
        }
        return
    }

    if (session?.mustChangePassword == true) {
        Scaffold(
            topBar = { TopAppBar(title = { Text("Смените временный пароль") }) },
            snackbarHost = { SnackbarHost(snackbarHost) },
        ) { padding ->
            ChangePasswordScreen(
                onSubmit = { current, password, completed ->
                    viewModel.changePassword(current, password, completed) {
                        completed()
                        message(authErrorMessage(it))
                    }
                },
                onLogout = { viewModel.logout() },
                modifier = Modifier.padding(padding),
            )
        }
        return
    }

    // Approval decisions are recorded on the server by a public link. Keep the
    // foreground app current even when the master does not leave this screen.
    LaunchedEffect(session?.accessToken) {
        while (true) {
            delay(30_000)
            viewModel.refresh()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AutoService", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { Image(painterResource(R.drawable.ic_launcher), null, Modifier.padding(start = 12.dp).size(36.dp)) },
                actions = {
                    IconButton(onClick = {
                        viewModel.refresh { error ->
                            message(error.message ?: "Не удалось обновить данные")
                        }
                    }) {
                        Icon(Icons.Outlined.Refresh, contentDescription = "Обновить")
                    }
                    IconButton(onClick = viewModel::logout) {
                        Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = "Выйти")
                    }
                },
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
                onSearchCustomers = { viewModel.searchCustomers(it) },
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
                onSendApprovalLink = { finding ->
                    if (finding.approvalPublicUrl != null && finding.approvalPreparationState != "PENDING" && finding.status == FindingStatus.SENT_TO_CUSTOMER) {
                        val share = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, finding.approvalPublicUrl)
                        }
                        context.startActivity(Intent.createChooser(share, "Поделиться согласованием"))
                    } else {
                        viewModel.queueApproval(finding,
                            onSuccess = { message("Готовим ссылку в фоне. Можно продолжать работу") },
                            onFailure = { message(it.message ?: "Не удалось подготовить ссылку") })
                    }
                },
                onRenewApprovalLink = { finding ->
                    viewModel.queueApproval(finding,
                        onSuccess = { message("Обновляем согласование после загрузки материалов") },
                        onFailure = { message(it.message ?: "Не удалось обновить ссылку") })
                },
                onEditFinding = { finding -> editingFinding = finding },
                onCompleteFinding = { finding ->
                    viewModel.completeFinding(
                        finding,
                        onSuccess = { message("Работа отмечена как выполненная") },
                        onFailure = { message(it.message ?: "Не удалось обновить статус работы") },
                    )
                },
                onStartRepair = {
                    viewModel.startRepair(
                        visit = selectedVisit,
                        onSuccess = { message("Ремонт начат") },
                        onFailure = { message(it.message ?: "Не удалось начать ремонт") },
                    )
                },
                onPublishReport = { draft ->
                    viewModel.publishReport(
                        visit = selectedVisit,
                        draft = draft,
                        onSuccess = { link ->
                            val share = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, link.publicUrl)
                            }
                            context.startActivity(Intent.createChooser(share, "Поделиться отчётом"))
                            message("Отчёт опубликован, ремонт завершён")
                        },
                        onFailure = { message(it.reportPublicationMessage()) },
                    )
                },
                onShareReport = { url ->
                    val share = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, url)
                    }
                    context.startActivity(Intent.createChooser(share, "Поделиться отчётом"))
                },
                onReviseReport = {
                    viewModel.reviseReport(
                        visit = selectedVisit,
                        onSuccess = { message("Отчёт отозван. Внесите правки и опубликуйте новую версию") },
                        onFailure = { message(it.reportPublicationMessage()) },
                    )
                },
                onCreateFinding = { creatingFindingForVisitId = selectedVisit.id },
                onBack = { selectedVisitId = null },
                onMessage = message,
                modifier = Modifier.padding(padding),
            )

            else -> VisitsScreen(
                visits = visits,
                mediaQueue = mediaQueue,
                onCreate = { creatingVisit = true },
                onOpen = { selectedVisitId = it.id },
                modifier = Modifier.padding(padding),
            )
        }
    }
}

@Composable
private fun BrandTitle() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Image(painterResource(R.drawable.ic_brand_emblem), contentDescription = null, modifier = Modifier.size(32.dp))
        Text("AutoService", maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LoginScreen(
    onPasswordLogin: (String, String, () -> Unit) -> Unit,
    onRequestCode: (String, (OtpChallenge?) -> Unit) -> Unit,
    onVerifyCode: (String, String, () -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    var mode by remember { mutableStateOf(LoginMode.PASSWORD) }
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var challenge by remember { mutableStateOf<OtpChallenge?>(null) }
    var loading by remember { mutableStateOf(false) }

    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f),
                        MaterialTheme.colorScheme.background,
                    ),
                ),
            )
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(24.dp),
    ) {
        Spacer(Modifier.height(36.dp))
        Text("Вход в мастерскую", style = MaterialTheme.typography.headlineMedium)
        when (mode) {
            LoginMode.SMS -> {
                Text("Получите одноразовый код на рабочий номер.")
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Телефон") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    enabled = !loading,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        loading = true
                        onRequestCode(phone) { created ->
                            loading = false
                            if (created != null) {
                                challenge = created
                                code = ""
                                mode = LoginMode.CODE
                            }
                        }
                    },
                    enabled = !loading && phone.trim().length in 8..32,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (loading) "Отправка…" else "Получить код") }
                TextButton(onClick = { mode = LoginMode.PASSWORD }, enabled = !loading) {
                    Text("Войти по паролю")
                }
            }

            LoginMode.CODE -> {
                Text("Введите 6 цифр из SMS. Код действует 5 минут.")
                OutlinedTextField(
                    value = code,
                    onValueChange = { value -> code = value.filter(Char::isDigit).take(6) },
                    label = { Text("Код из SMS") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    enabled = !loading,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        val challengeId = challenge?.challengeId ?: return@Button
                        loading = true
                        onVerifyCode(challengeId, code) { loading = false }
                    },
                    enabled = !loading && code.length == 6 && challenge != null,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (loading) "Проверка…" else "Войти") }
                TextButton(
                    onClick = {
                        challenge = null
                        code = ""
                        mode = LoginMode.SMS
                    },
                    enabled = !loading,
                ) { Text("Изменить номер") }
            }

            LoginMode.PASSWORD -> {
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
                        onPasswordLogin(login, password) { loading = false }
                    },
                    enabled = !loading && login.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (loading) "Подключение…" else "Войти") }
            }
        }
        Text(
            "Сессия зашифрована ключом устройства. Все визиты и находки сохраняются на сервере.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

private enum class LoginMode { SMS, CODE, PASSWORD }

@Composable
private fun ChangePasswordScreen(
    onSubmit: (String, String, () -> Unit) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var current by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    Column(modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Перед началом работы задайте свой пароль: минимум 12 символов.")
        OutlinedTextField(current, { current = it }, label = { Text("Временный пароль") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), enabled = !loading)
        OutlinedTextField(password, { password = it }, label = { Text("Новый пароль") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), enabled = !loading)
        OutlinedTextField(confirmation, { confirmation = it }, label = { Text("Повторите пароль") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), enabled = !loading)
        Button(onClick = { loading = true; onSubmit(current, password) { loading = false } },
            enabled = !loading && current.isNotEmpty() && password.length in 12..256 && password == confirmation) {
            Text(if (loading) "Сохранение…" else "Сохранить пароль")
        }
        TextButton(onClick = onLogout, enabled = !loading) { Text("Выйти") }
    }
}

private fun authErrorMessage(error: Throwable): String = when (error.message) {
    "invalid_credentials" -> "Неверный логин или пароль"
    "invalid_or_expired_code" -> "Код неверен или истёк"
    "retry_later" -> "Новый код можно запросить через минуту"
    "too_many_attempts" -> "Слишком много попыток. Попробуйте позже"
    "verification_delivery_failed" -> "Не удалось отправить SMS"
    "phone_authentication_unavailable" -> "Вход по SMS временно недоступен"
    else -> error.message ?: "Не удалось войти"
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
    mediaQueue: List<MediaAssetEntity>,
    onCreate: () -> Unit,
    onOpen: (VisitEntity) -> Unit,
    modifier: Modifier = Modifier,
) {
    val pendingCount = mediaQueue.count { it.syncState != SyncState.SYNCED }
    val attentionCount = mediaQueue.count { it.syncState == SyncState.RETRY || it.syncState == SyncState.BLOCKED }
    val activeVisits = visits
        .filter { it.status !in setOf(VisitStatus.COMPLETED, VisitStatus.CANCELLED) }
        .sortedWith(compareBy<VisitEntity> { it.status.queueRank() }.thenByDescending { it.updatedAtEpochMs })
    val archivedVisits = visits
        .filter { it.status in setOf(VisitStatus.COMPLETED, VisitStatus.CANCELLED) }
        .sortedByDescending { it.updatedAtEpochMs }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp),
        ) {
            Text("Очередь мастерской", style = MaterialTheme.typography.headlineMedium)
            Text(
                "Текущие автомобили и согласования в работе.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = onCreate,
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 2.dp, pressedElevation = 0.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            ) {
                Icon(Icons.Outlined.DirectionsCar, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Принять автомобиль")
            }
            Surface(
                color = if (attentionCount > 0) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, if (attentionCount > 0) MaterialTheme.colorScheme.error.copy(alpha = 0.24f) else MaterialTheme.colorScheme.outlineVariant),
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    Icon(
                        imageVector = if (attentionCount > 0) Icons.Outlined.WarningAmber else Icons.Outlined.Check,
                        contentDescription = null,
                        tint = if (attentionCount > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.size(22.dp),
                    )
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (attentionCount > 0) "Нужно проверить: $attentionCount" else if (pendingCount > 0) "Загружается: $pendingCount" else "Все материалы загружены",
                            style = MaterialTheme.typography.labelLarge,
                        )
                        if (attentionCount > 0 || pendingCount > 0) Text(
                            if (attentionCount > 0) "Откройте визит и повторите загрузку." else "Можно продолжать работу — загрузка идёт в фоне.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            ) {
                Text("В работе", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Text(
                    activeVisits.size.toString(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (visits.isEmpty()) {
            Text(
                "Пока нет визитов. Первый можно создать без подключения к сети.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 28.dp),
            ) {
                if (activeVisits.isEmpty()) {
                    item {
                        Text(
                            "Сейчас нет активных визитов.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                }
                items(activeVisits, key = { it.id }) { visit ->
                    VisitQueueRow(visit = visit, archived = false, onOpen = { onOpen(visit) })
                }
                if (archivedVisits.isNotEmpty()) {
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 2.dp),
                        ) {
                            Text("Завершённые", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Text(
                                archivedVisits.size.toString(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                items(archivedVisits, key = { it.id }) { visit ->
                    VisitQueueRow(visit = visit, archived = true, onOpen = { onOpen(visit) })
                }
            }
        }
    }
}

@Composable
private fun VisitQueueRow(visit: VisitEntity, archived: Boolean, onOpen: () -> Unit) {
    Card(
        onClick = onOpen,
        colors = CardDefaults.cardColors(
            containerColor = if (archived) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (archived) 0.dp else 2.dp),
        border = if (archived) BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
        modifier = Modifier.fillMaxWidth().heightIn(min = 76.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Surface(
                color = if (archived) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.size(40.dp),
            ) {
                Icon(
                    Icons.Outlined.DirectionsCar,
                    contentDescription = null,
                    tint = if (archived) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(9.dp),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.weight(1f)) {
                Text(
                    visit.vehicleLabel.ifBlank { visit.licensePlate },
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOf(visit.licensePlate, visit.customerName.ifBlank { "Клиент" })
                        .filter(String::isNotBlank)
                        .joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(visit.status.label(), visit.status.color())
        }
    }
}

@Composable
internal fun IntakeScreen(
    onSearchCustomers: suspend (String) -> List<CustomerMatch>,
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
    var search by remember { mutableStateOf("") }
    var matches by remember { mutableStateOf<List<CustomerMatch>>(emptyList()) }
    var searchMessage by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var selectedVehicle by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = PaddingValues(bottom = 24.dp),
        modifier = modifier.fillMaxSize().imePadding().padding(16.dp).testTag("intake-form"),
    ) {
        item { Text("Новый визит", style = MaterialTheme.typography.headlineSmall) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Клиент уже был у нас?", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(value = search, onValueChange = { search = it; matches = emptyList(); searchMessage = null },
                    label = { Text("Госномер или телефон клиента") }, singleLine = true,
                    enabled = !searching, modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = {
                    scope.launch {
                        searching = true
                        searchMessage = null
                        try {
                            matches = onSearchCustomers(search)
                            searchMessage = if (matches.isEmpty()) "Не найдено. Заполните данные нового клиента ниже."
                                else "Выберите автомобиль клиента."
                        } catch (error: Exception) {
                            if (error is kotlinx.coroutines.CancellationException) throw error
                            matches = emptyList()
                            searchMessage = "Не удалось выполнить поиск. Проверьте соединение и повторите."
                        } finally { searching = false }
                    }
                }, enabled = !searching && search.trim().length >= 3, modifier = Modifier.fillMaxWidth()) {
                    Text(if (searching) "Поиск…" else "Найти клиента")
                }
                searchMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                if (matches.size == 25) Text("Показаны первые 25 клиентов. Уточните запрос.", style = MaterialTheme.typography.bodySmall)
            }
        }
        items(matches, key = { "customer-${it.id}" }) { customer ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(customer.name.ifBlank { "Клиент" }, style = MaterialTheme.typography.titleMedium)
                    Text(customer.phone)
                    customer.vehicles.forEach { existing ->
                        OutlinedButton(onClick = {
                            customerName = customer.name
                            phone = customer.phone
                            vehicle = existing.label
                            plate = existing.licensePlate
                            mileage = ""
                            selectedVehicle = "${existing.label} · ${existing.licensePlate}"
                            matches = emptyList()
                            searchMessage = null
                        }, modifier = Modifier.fillMaxWidth()) {
                            Text("${existing.label.ifBlank { "Автомобиль" }} · ${existing.licensePlate.ifBlank { "Без госномера" }}")
                        }
                    }
                    TextButton(onClick = {
                        customerName = customer.name; phone = customer.phone
                        vehicle = ""; plate = ""; mileage = ""; selectedVehicle = null
                        matches = emptyList(); searchMessage = "Клиент выбран. Укажите новый автомобиль ниже."
                    }) { Text("Другой автомобиль этого клиента") }
                }
            }
        }
        selectedVehicle?.let { selected -> item { Text("Выбран: $selected. Укажите текущий пробег и жалобы.", style = MaterialTheme.typography.bodySmall) } }
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
    onSendApprovalLink: (FindingEntity) -> Unit,
    onRenewApprovalLink: (FindingEntity) -> Unit,
    onEditFinding: (FindingEntity) -> Unit,
    onCompleteFinding: (FindingEntity) -> Unit,
    onStartRepair: () -> Unit,
    onPublishReport: (ReportDraft) -> Unit,
    onShareReport: (String) -> Unit,
    onReviseReport: () -> Unit,
    onCreateFinding: () -> Unit,
    onBack: () -> Unit,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val allAssets by viewModel.assets.collectAsState()
    val assets = allAssets.filter { it.visitId == visit.id }
    val visitAssets = assets.filter { it.findingId == null }
    val findings by viewModel.findingsForVisit(visit.id).collectAsState(initial = emptyList())
    val voiceRecorder = remember { VoiceRecorder(context) }
    var recordingVoice by remember { mutableStateOf(false) }
    var voiceFindingId by remember { mutableStateOf<String?>(null) }
    var renewalFinding by remember { mutableStateOf<FindingEntity?>(null) }
    var deletionAsset by remember { mutableStateOf<MediaAssetEntity?>(null) }
    var completionFinding by remember { mutableStateOf<FindingEntity?>(null) }
    var showReportComposer by remember { mutableStateOf(false) }
    var showReportRevisionConfirmation by remember { mutableStateOf(false) }
    var observedFindingStatuses by remember(visit.id) {
        mutableStateOf<Map<String, FindingStatus>?>(null)
    }
    val activeFindings = findings
        .filter { it.status !in setOf(FindingStatus.COMPLETED, FindingStatus.DECLINED, FindingStatus.DEFERRED) }
        .sortedWith(compareBy<FindingEntity> { it.status.actionRank() }.thenByDescending { it.updatedAtEpochMs })
    val resolvedFindings = findings
        .filter { it.status in setOf(FindingStatus.COMPLETED, FindingStatus.DECLINED, FindingStatus.DEFERRED) }
        .sortedByDescending { it.updatedAtEpochMs }

    LaunchedEffect(findings) {
        observedFindingStatuses?.let { previous ->
            findings.forEach { finding ->
                val before = previous[finding.id]
                if (before == FindingStatus.SENT_TO_CUSTOMER && finding.status.isCustomerDecision()) {
                    onMessage("Клиент: ${finding.status.decisionLabel()} — ${finding.title}")
                }
            }
        }
        observedFindingStatuses = findings.associate { it.id to it.status }
    }

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
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            TextButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Визиты")
            }
            StatusPill(visit.status.label(), visit.status.color())
        }
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = MaterialTheme.shapes.medium,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.padding(16.dp)) {
                Text(
                    visit.vehicleLabel.ifBlank { visit.licensePlate },
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    listOf(visit.licensePlate, visit.customerName.ifBlank { "Клиент" }, visit.customerPhone)
                        .filter(String::isNotBlank)
                        .joinToString(" · "),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                visit.mileageKm?.let {
                    Text("Пробег: $it км", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (visit.complaint.isNotBlank()) {
                    Text("Жалоба: ${visit.complaint}", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Spacer(Modifier.height(14.dp))

        if (visit.status !in setOf(VisitStatus.COMPLETED, VisitStatus.CANCELLED)) {
            VisitNextStepCard(visit = visit, findings = findings)
            Spacer(Modifier.height(14.dp))
        }

        if (visit.status == VisitStatus.COMPLETED && visit.reportPublicUrl != null) {
            Text("Отчёт опубликован", color = MaterialTheme.colorScheme.primary)
            Button(onClick = { onShareReport(visit.reportPublicUrl) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Share, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Поделиться отчётом")
            }
            OutlinedButton(onClick = { showReportRevisionConfirmation = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Edit, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Исправить и выпустить новую версию")
            }
            Spacer(Modifier.height(12.dp))
        } else if (visit.status in setOf(VisitStatus.IN_REPAIR, VisitStatus.WAITING_APPROVAL)) {
            when (visit.reportPreparationState) {
                "PENDING" -> Text("Публикуем итоговый отчёт", color = MaterialTheme.colorScheme.primary)
                "FAILED" -> Text(visit.reportPreparationError ?: "Не удалось опубликовать отчёт", color = MaterialTheme.colorScheme.error)
                "READY" -> Text("Отчёт опубликован", color = MaterialTheme.colorScheme.primary)
            }
            if (visit.reportPreparationState == "READY" && visit.reportPublicUrl != null) {
                Button(onClick = { onShareReport(visit.reportPublicUrl) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Share, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Поделиться отчётом")
                }
            } else {
                Button(
                    onClick = { showReportComposer = true },
                    enabled = visit.reportPreparationState != "PENDING",
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (visit.reportPreparationState == "FAILED") "Повторить публикацию отчёта" else "Завершить ремонт и создать отчёт")
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        if (visit.status == VisitStatus.DRAFT) {
            Button(onClick = onStartRepair, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Build, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Начать ремонт")
            }
            Spacer(Modifier.height(12.dp))
        }

        if (!capturePermissionsGranted) {
            Text("Материалы и находки", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Button(onClick = onRequestPermissions, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Icon(Icons.Outlined.PhotoCamera, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Разрешить камеру и микрофон")
            }
        } else {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Материалы и находки", style = MaterialTheme.typography.titleLarge)
                Button(onClick = onCreateFinding, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Добавить находку")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = onOpenCamera, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                        Icon(Icons.Outlined.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Фото / видео")
                    }
                    OutlinedButton(
                        onClick = { toggleVoice() },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) {
                        Icon(Icons.Outlined.Phone, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (recordingVoice) "Стоп" else "Голос")
                    }
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text("Находки", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            Text(
                findings.size.toString(),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(8.dp))
        if (findings.isEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = MaterialTheme.shapes.small,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    "Пока нет находок. Добавьте проблему и ориентировочную цену.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(14.dp),
                )
            }
        } else {
            activeFindings.forEach { finding ->
                FindingCard(
                    finding = finding,
                    findingAssets = assets.filter { it.findingId == finding.id },
                    onOpenCamera = { onOpenFindingCamera(finding.id) },
                    onToggleVoice = { toggleVoice(finding.id) },
                    recordingVoice = recordingVoice && voiceFindingId == finding.id,
                    onPrepare = { onPrepareFinding(finding) },
                    onSendApprovalLink = { onSendApprovalLink(finding) },
                    onRenewApprovalLink = { renewalFinding = finding },
                    onEdit = { onEditFinding(finding) },
                    onComplete = { completionFinding = finding },
                    onRetryUpload = { asset -> viewModel.retry(asset) },
                    onDelete = { asset -> deletionAsset = asset },
                )
            }
            if (resolvedFindings.isNotEmpty()) {
                Text(
                    "Завершённые и отложенные",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp, bottom = 8.dp),
                )
                resolvedFindings.forEach { finding ->
                    FindingCard(
                        finding = finding,
                        findingAssets = assets.filter { it.findingId == finding.id },
                        onOpenCamera = { onOpenFindingCamera(finding.id) },
                        onToggleVoice = { toggleVoice(finding.id) },
                        recordingVoice = recordingVoice && voiceFindingId == finding.id,
                        onPrepare = { onPrepareFinding(finding) },
                        onSendApprovalLink = { onSendApprovalLink(finding) },
                        onRenewApprovalLink = { renewalFinding = finding },
                        onEdit = { onEditFinding(finding) },
                        onComplete = { completionFinding = finding },
                        onRetryUpload = { asset -> viewModel.retry(asset) },
                        onDelete = { asset -> deletionAsset = asset },
                    )
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        VisitTimeline(
            findingCount = findings.size,
            readyForApprovalCount = findings.count { it.status == FindingStatus.READY_FOR_APPROVAL },
            decisionCount = findings.count { it.status.isCustomerDecision() },
            materialCount = assets.size,
        )
        renewalFinding?.let { finding ->
            AlertDialog(
                onDismissRequest = { renewalFinding = null },
                title = { Text("Обновить ссылку?") },
                text = {
                    Text(
                        "Предыдущая ссылка станет недействительной. Новая ссылка включит только " +
                            "материалы, которые уже загружены на сервер.",
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        renewalFinding = null
                        onRenewApprovalLink(finding)
                    }) { Text("Создать новую") }
                },
                dismissButton = {
                    TextButton(onClick = { renewalFinding = null }) { Text("Отмена") }
                },
            )
        }
        deletionAsset?.let { asset ->
            AlertDialog(
                onDismissRequest = { deletionAsset = null },
                title = { Text("Удалить материал?") },
                text = {
                    Text(
                        "${asset.kind.label()} будет удалён с телефона и с сервера. " +
                            "После удаления он не попадёт в ссылку клиенту.",
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        deletionAsset = null
                        viewModel.deleteMedia(
                            asset = asset,
                            onSuccess = { onMessage("Материал удалён") },
                            onFailure = { onMessage(it.message ?: "Не удалось удалить материал") },
                        )
                    }) { Text("Удалить") }
                },
                dismissButton = { TextButton(onClick = { deletionAsset = null }) { Text("Отмена") } },
            )
        }
        completionFinding?.let { finding ->
            AlertDialog(
                onDismissRequest = { completionFinding = null },
                title = { Text("Отметить работу выполненной?") },
                text = { Text("«${finding.title}» перейдёт в статус «Выполнено» и войдёт в итоговый отчёт.") },
                confirmButton = {
                    Button(onClick = {
                        completionFinding = null
                        onCompleteFinding(finding)
                    }) { Text("Выполнено") }
                },
                dismissButton = { TextButton(onClick = { completionFinding = null }) { Text("Отмена") } },
            )
        }
        if (showReportComposer) {
            ReportComposerDialog(
                initialCompletedWork = visit.reportCompletedWork.orEmpty(),
                initialRecommendations = visit.reportRecommendations.orEmpty(),
                initialNextVisitAtEpochMs = visit.reportNextVisitAtEpochMs,
                completedFindingTitles = findings.filter { it.status == FindingStatus.COMPLETED }.map { it.title },
                futureFindingTitles = findings.filter { it.status != FindingStatus.COMPLETED && it.status != FindingStatus.DECLINED &&
                    (it.status == FindingStatus.DEFERRED || it.priority == FindingPriority.PLANNED) }.map { it.title },
                onDismiss = { showReportComposer = false },
                onPublish = { draft ->
                    showReportComposer = false
                    onPublishReport(draft)
                },
            )
        }
        if (showReportRevisionConfirmation) {
            AlertDialog(
                onDismissRequest = { showReportRevisionConfirmation = false },
                title = { Text("Исправить отчёт?") },
                text = { Text("Текущая ссылка станет недействительной. После правок будет создана новая неизменяемая версия отчёта.") },
                confirmButton = {
                    Button(onClick = {
                        showReportRevisionConfirmation = false
                        onReviseReport()
                    }) { Text("Отозвать отчёт") }
                },
                dismissButton = { TextButton(onClick = { showReportRevisionConfirmation = false }) { Text("Отмена") } },
            )
        }
        Spacer(Modifier.height(18.dp))
        if (visitAssets.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            Text(
                "Материалы визита без находки: ${visitAssets.size} · ожидают: ${visitAssets.count { it.syncState != SyncState.SYNCED }}",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                "Они не войдут в согласование отдельной находки.",
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                visitAssets.forEach { asset ->
                    QueueItem(
                        asset = asset,
                        onRetry = { viewModel.retry(asset) },
                        onDelete = { deletionAsset = asset },
                    )
                }
            }
        }
    }
}

@Composable
private fun VisitNextStepCard(visit: VisitEntity, findings: List<FindingEntity>) {
    val callRequested = findings.count { it.status == FindingStatus.CALL_REQUESTED }
    val approved = findings.count { it.status == FindingStatus.APPROVED }
    val needsApproval = findings.count { it.status in setOf(FindingStatus.DRAFT, FindingStatus.READY_FOR_APPROVAL) }
    val awaitingCustomer = findings.count { it.status == FindingStatus.SENT_TO_CUSTOMER }
    val (title, detail) = when {
        visit.status == VisitStatus.DRAFT ->
            "Начните ремонт" to "Данные автомобиля сохранены. После проверки переведите визит в работу."
        callRequested > 0 ->
            "Клиент просит звонок" to "Запросов на звонок: $callRequested. Свяжитесь с клиентом и уточните решение."
        approved > 0 ->
            "Есть согласованные работы" to "Согласовано работ: $approved. После ремонта отметьте результат в карточке."
        needsApproval > 0 ->
            "Подготовьте согласование" to "Карточек к отправке: $needsApproval. Проверьте цену и материалы, затем отправьте ссылку клиенту."
        awaitingCustomer > 0 ->
            "Ожидайте решения" to "Согласование отправлено. Ответ клиента появится в карточке автоматически."
        else ->
            "Зафиксируйте результат осмотра" to "Добавьте находку, фото, видео или голосовую заметку."
    }
    val shape = MaterialTheme.shapes.medium
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(
                elevation = 6.dp,
                shape = shape,
                ambientColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                spotColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
            )
            .background(
                brush = Brush.linearGradient(
                    listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.inverseSurface),
                ),
                shape = shape,
            )
            .padding(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(
                "Следующий шаг",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.72f),
            )
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimary)
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.84f),
            )
        }
    }
}

@Composable
private fun VisitTimeline(
    findingCount: Int,
    readyForApprovalCount: Int,
    decisionCount: Int,
    materialCount: Int,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(16.dp),
        ) {
            Text("Сводка визита", style = MaterialTheme.typography.titleMedium)
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
                title = when {
                    decisionCount > 0 -> "Решения клиента: $decisionCount"
                    readyForApprovalCount > 0 -> "Готово к согласованию: $readyForApprovalCount"
                    else -> "Согласование не готово"
                },
                detail = when {
                    decisionCount > 0 -> "Проверьте ответы в карточках находок"
                    readyForApprovalCount > 0 -> "Можно готовить ссылку для клиента"
                    else -> "Добавьте цену и материалы к находкам"
                },
                color = if (readyForApprovalCount == 0 && decisionCount == 0) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.secondaryContainer,
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
    findingAssets: List<MediaAssetEntity>,
    onOpenCamera: () -> Unit,
    onToggleVoice: () -> Unit,
    recordingVoice: Boolean,
    onPrepare: () -> Unit,
    onSendApprovalLink: () -> Unit,
    onRenewApprovalLink: () -> Unit,
    onEdit: () -> Unit,
    onComplete: () -> Unit,
    onRetryUpload: (MediaAssetEntity) -> Unit,
    onDelete: (MediaAssetEntity) -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(finding.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                StatusPill(finding.status.label(), finding.status.color())
            }
            finding.description.takeIf(String::isNotBlank)?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(finding.priority.label(), finding.priority.color())
                finding.priceRub?.let { StatusPill("${it} ₽", MaterialTheme.colorScheme.secondaryContainer) }
            }
            val syncedAssets = findingAssets.filter { it.syncState == SyncState.SYNCED }
            val pendingAssets = findingAssets.filter { it.syncState != SyncState.SYNCED }
            Text(
                "Материалы: ${findingAssets.size} · загружено ${syncedAssets.size}",
                style = MaterialTheme.typography.labelLarge,
            )
            if (findingAssets.isEmpty()) {
                Text("Материалы не прикреплены", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                FindingMediaGallery(
                    assets = findingAssets,
                    onRetryUpload = onRetryUpload,
                    onDelete = onDelete,
                    allowDelete = finding.approvalPreparationState != "PENDING" && finding.status in setOf(FindingStatus.DRAFT, FindingStatus.READY_FOR_APPROVAL),
                )
                Text("Листайте вправо, чтобы увидеть все материалы", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (pendingAssets.isNotEmpty() && finding.status in setOf(FindingStatus.READY_FOR_APPROVAL, FindingStatus.SENT_TO_CUSTOMER)) {
                Text(
                    "Загружаем ${pendingAssets.size} материалов. Ссылка будет готова после проверки всего выбранного набора.",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onOpenCamera, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.PhotoCamera, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Фото / видео")
                }
                OutlinedButton(onClick = onToggleVoice, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.Phone, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (recordingVoice) "Стоп" else "Голос")
                }
            }
            when (finding.approvalPreparationState) {
                "PENDING" -> Text("Готовим ссылку · можно продолжать работу", color = MaterialTheme.colorScheme.primary)
                "READY" -> Text("Ссылка готова · отправьте её через «Поделиться»", color = MaterialTheme.colorScheme.primary)
                "FAILED" -> Text(finding.approvalPreparationError ?: "Нужен повтор", color = MaterialTheme.colorScheme.error)
            }
            when (finding.status) {
                FindingStatus.DRAFT -> Button(onClick = onSendApprovalLink, enabled = finding.approvalPreparationState != "PENDING", modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("Подготовить ссылку")
                }
                FindingStatus.READY_FOR_APPROVAL -> Button(
                    onClick = onSendApprovalLink,
                    enabled = finding.approvalPreparationState != "PENDING",
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(if (finding.approvalPreparationState == "FAILED") "Повторить подготовку" else "Подготовить ссылку") }
                FindingStatus.SENT_TO_CUSTOMER -> Button(
                    onClick = onSendApprovalLink,
                    enabled = finding.approvalPreparationState != "PENDING",
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Outlined.Share, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Поделиться")
                }
                FindingStatus.APPROVED -> Button(onClick = onComplete, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.Check, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Отметить выполненной")
                }
                else -> Unit
            }
            if (finding.status == FindingStatus.DRAFT && finding.approvalPreparationState != "PENDING") {
                TextButton(onClick = onEdit, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Edit, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Изменить")
                }
            }
            if (finding.status == FindingStatus.SENT_TO_CUSTOMER) {
                OutlinedButton(onClick = onRenewApprovalLink, enabled = finding.approvalPreparationState != "PENDING", modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Refresh, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (finding.approvalPreparationState == "FAILED") "Повторить подготовку" else "Обновить материалы")
                }
            }
        }
    }
}

@Composable
private fun FindingMediaGallery(
    assets: List<MediaAssetEntity>,
    onRetryUpload: (MediaAssetEntity) -> Unit,
    onDelete: (MediaAssetEntity) -> Unit,
    allowDelete: Boolean,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
    ) {
        assets.forEach { asset ->
            FindingMediaPreview(
                asset = asset,
                onRetryUpload = { onRetryUpload(asset) },
                onDelete = if (allowDelete) ({ onDelete(asset) }) else null,
            )
        }
    }
}

@Composable
private fun FindingMediaPreview(
    asset: MediaAssetEntity,
    onRetryUpload: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    var showImage by remember(asset.id) { mutableStateOf(false) }
    var showVideo by remember(asset.id) { mutableStateOf(false) }
    val localFileExists = remember(asset.localPath) { File(asset.localPath).isFile }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.width(156.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(8.dp)) {
            when (asset.kind) {
                MediaKind.PHOTO -> PhotoThumbnail(
                    path = asset.localPath,
                    onOpen = { showImage = true },
                )
                MediaKind.VIDEO -> VideoThumbnail(
                    path = asset.localPath,
                    onOpen = { showVideo = true },
                )
                MediaKind.VOICE -> VoicePlayer(path = asset.localPath)
            }
            Text(asset.kind.label(), style = MaterialTheme.typography.labelLarge)
            Text(asset.syncState.label(), style = MaterialTheme.typography.bodySmall)
            if (!localFileExists) {
                Text("Файл недоступен на телефоне", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            if (asset.syncState == SyncState.RETRY || asset.syncState == SyncState.BLOCKED) {
                TextButton(onClick = onRetryUpload, modifier = Modifier.fillMaxWidth()) { Text("Повторить") }
            }
            onDelete?.let { delete ->
                TextButton(onClick = delete, modifier = Modifier.fillMaxWidth()) { Text("Удалить") }
            }
        }
    }

    if (showImage) ImagePreviewDialog(path = asset.localPath, onDismiss = { showImage = false })
    if (showVideo) VideoPreviewDialog(path = asset.localPath, onDismiss = { showVideo = false })
}

@Composable
private fun PhotoThumbnail(path: String, onOpen: () -> Unit) {
    val bitmap = rememberPreviewBitmap(path = path, isVideo = false)
    PreviewSurface(onClick = onOpen) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Открыть фото",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text("Фото\nнедоступно", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun VideoThumbnail(path: String, onOpen: () -> Unit) {
    val bitmap = rememberPreviewBitmap(path = path, isVideo = true)
    PreviewSurface(onClick = onOpen) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Открыть видео",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.92f),
            shape = CircleShape,
            modifier = Modifier.align(Alignment.Center),
        ) {
            Text("Видео", modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp))
        }
    }
}

@Composable
private fun PreviewSurface(onClick: () -> Unit, content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    androidx.compose.foundation.layout.Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .height(96.dp)
            .clickable(onClick = onClick),
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {}
        content()
    }
}

@Composable
private fun rememberPreviewBitmap(path: String, isVideo: Boolean): Bitmap? {
    var bitmap by remember(path, isVideo) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(path, isVideo) {
        bitmap = withContext(Dispatchers.IO) {
            if (isVideo) videoFrame(path) else sampledPhoto(path)
        }
    }
    return bitmap
}

private fun sampledPhoto(path: String): Bitmap? {
    if (!File(path).isFile) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    val widestSide = maxOf(bounds.outWidth, bounds.outHeight)
    var sampleSize = 1
    while (widestSide / sampleSize > 512) sampleSize *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
}

private fun videoFrame(path: String): Bitmap? {
    if (!File(path).isFile) return null
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(path)
        retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
    } catch (_: RuntimeException) {
        null
    } finally {
        retriever.release()
    }
}

@Composable
private fun ImagePreviewDialog(path: String, onDismiss: () -> Unit) {
    val bitmap = rememberPreviewBitmap(path = path, isVideo = false)
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(modifier = Modifier.padding(12.dp)) {
                if (bitmap != null) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "Фото находки",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 560.dp),
                    )
                } else {
                    Text("Не удалось открыть фото")
                }
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("Закрыть") }
            }
        }
    }
}

@Composable
private fun VideoPreviewDialog(path: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(modifier = Modifier.padding(12.dp)) {
                AndroidView(
                    factory = { context ->
                        VideoView(context).apply {
                            setVideoPath(path)
                            setMediaController(MediaController(context).also { controller -> controller.setAnchorView(this) })
                            setOnPreparedListener { player ->
                                player.isLooping = false
                                start()
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(280.dp),
                )
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("Закрыть") }
            }
        }
    }
}

@Composable
private fun VoicePlayer(path: String) {
    var player by remember(path) { mutableStateOf<MediaPlayer?>(null) }
    var ready by remember(path) { mutableStateOf(false) }
    var playing by remember(path) { mutableStateOf(false) }
    var durationMs by remember(path) { mutableStateOf(0) }

    DisposableEffect(path) {
        if (!File(path).isFile) {
            onDispose {}
        } else {
            val mediaPlayer = MediaPlayer()
            player = mediaPlayer
            runCatching {
                mediaPlayer.setDataSource(path)
                mediaPlayer.setOnPreparedListener {
                    durationMs = it.duration.coerceAtLeast(0)
                    ready = true
                }
                mediaPlayer.setOnCompletionListener { playing = false }
                mediaPlayer.prepareAsync()
            }.onFailure { ready = false }
            onDispose {
                mediaPlayer.release()
                if (player === mediaPlayer) player = null
            }
        }
    }

    Button(
        onClick = {
            player?.let {
                if (it.isPlaying) {
                    it.pause()
                    playing = false
                } else if (ready) {
                    it.start()
                    playing = true
                }
            }
        },
        enabled = ready,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            when {
                !ready -> "Голос…"
                playing -> "Пауза · ${durationMs.asDurationLabel()}"
                else -> "Воспроизвести · ${durationMs.asDurationLabel()}"
            },
        )
    }
}

private fun Int.asDurationLabel(): String = "%d:%02d".format(this / 60_000, (this / 1_000) % 60)

@Composable
private fun QueueItem(asset: MediaAssetEntity, onRetry: () -> Unit, onDelete: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
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
            TextButton(onClick = onDelete) { Text("Удалить") }
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
    VisitStatus.WAITING_APPROVAL -> "На согласовании"
    VisitStatus.COMPLETED -> "Завершён"
    VisitStatus.CANCELLED -> "Отменён"
}

private fun VisitStatus.queueRank(): Int = when (this) {
    VisitStatus.DRAFT -> 0
    VisitStatus.IN_REPAIR -> 1
    VisitStatus.WAITING_APPROVAL -> 2
    VisitStatus.COMPLETED -> 3
    VisitStatus.CANCELLED -> 4
}

private fun FindingStatus.actionRank(): Int = when (this) {
    FindingStatus.CALL_REQUESTED -> 0
    FindingStatus.APPROVED -> 1
    FindingStatus.DRAFT -> 2
    FindingStatus.READY_FOR_APPROVAL -> 3
    FindingStatus.SENT_TO_CUSTOMER -> 4
    FindingStatus.DEFERRED -> 5
    FindingStatus.DECLINED -> 6
    FindingStatus.COMPLETED -> 7
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
    FindingStatus.COMPLETED -> MaterialTheme.colorScheme.primaryContainer
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
    ru.autoservice.spike.data.FindingStatus.READY_FOR_APPROVAL -> "Готово"
    ru.autoservice.spike.data.FindingStatus.SENT_TO_CUSTOMER -> "У клиента"
    ru.autoservice.spike.data.FindingStatus.APPROVED -> "Согласовано"
    ru.autoservice.spike.data.FindingStatus.COMPLETED -> "Выполнено"
    ru.autoservice.spike.data.FindingStatus.DECLINED -> "Отклонено"
    ru.autoservice.spike.data.FindingStatus.CALL_REQUESTED -> "Нужен звонок"
    ru.autoservice.spike.data.FindingStatus.DEFERRED -> "Отложено"
}

private fun FindingStatus.isCustomerDecision(): Boolean = this in setOf(
    FindingStatus.APPROVED,
    FindingStatus.DECLINED,
    FindingStatus.CALL_REQUESTED,
    FindingStatus.DEFERRED,
)

private fun FindingStatus.decisionLabel(): String = when (this) {
    FindingStatus.APPROVED -> "согласовал работы"
    FindingStatus.DECLINED -> "отклонил работы"
    FindingStatus.CALL_REQUESTED -> "просит позвонить"
    FindingStatus.DEFERRED -> "отложил решение"
    else -> label()
}

private fun Throwable.reportPublicationMessage(): String = when ((this as? ApiException)?.message) {
    "pending_approvals" -> "Сначала дождитесь решения клиента по всем согласованиям"
    "completed_work_required" -> "Опишите выполненные работы"
    "report_already_published" -> "Отчёт уже опубликован. Нажмите «Поделиться отчётом»"
    "report_not_draft" -> "Отчёт нельзя опубликовать для этого визита"
    else -> message ?: "Не удалось опубликовать отчёт. Проверьте сеть и повторите."
}
