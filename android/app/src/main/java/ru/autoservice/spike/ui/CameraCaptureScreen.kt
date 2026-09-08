package ru.autoservice.spike.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import ru.autoservice.spike.data.MediaKind
import java.io.File

@Composable
fun CameraCaptureScreen(
    visitId: String,
    findingId: String?,
    viewModel: QueueViewModel,
    onClose: () -> Unit,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var videoCapture by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var recording by remember { mutableStateOf<Recording?>(null) }
    var videoFile by remember { mutableStateOf<File?>(null) }
    var bindingError by remember { mutableStateOf<String?>(null) }

    DisposableEffect(lifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(context)
        val executor = ContextCompat.getMainExecutor(context)
        future.addListener(
            {
                runCatching {
                    val provider = future.get()
                    val preview = Preview.Builder().build().also {
                        it.surfaceProvider = previewView.surfaceProvider
                    }
                    val photos = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .build()
                    val recorder = Recorder.Builder()
                        .setQualitySelector(QualitySelector.from(Quality.SD))
                        .build()
                    val videos = VideoCapture.withOutput(recorder)

                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        photos,
                        videos,
                    )
                    imageCapture = photos
                    videoCapture = videos
                }.onFailure {
                    bindingError = it.message ?: "Не удалось открыть камеру"
                }
            },
            executor,
        )

        onDispose {
            recording?.stop()
            runCatching { future.get().unbindAll() }
        }
    }

    LaunchedEffect(recording) {
        if (recording != null) {
            delay(30_000)
            recording?.stop()
        }
    }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val previewHeight = maxHeight * 0.45f
        Column(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { previewView },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(previewHeight)
                    .clipToBounds(),
            )

            bindingError?.let {
                Text(
                    text = it,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(16.dp),
                )
            }

            if (imageCapture == null || videoCapture == null) {
                CircularProgressIndicator(modifier = Modifier.padding(16.dp))
            }

            Surface(
                tonalElevation = 3.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                ) {
                Button(
                enabled = imageCapture != null && recording == null,
                onClick = {
                    val output = viewModel.newCaptureFile(visitId, MediaKind.PHOTO, findingId)
                    val options = ImageCapture.OutputFileOptions.Builder(output).build()
                    imageCapture?.takePicture(
                        options,
                        ContextCompat.getMainExecutor(context),
                        object : ImageCapture.OnImageSavedCallback {
                            override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                                viewModel.registerCapture(
                                    visitId = visitId,
                                    findingId = findingId,
                                    kind = MediaKind.PHOTO,
                                    mimeType = "image/jpeg",
                                    file = output,
                                    onSuccess = { onMessage("Фото сохранено на телефоне") },
                                    onFailure = { onMessage(it.message ?: "Ошибка сохранения фото") },
                                )
                            }

                            override fun onError(error: ImageCaptureException) {
                                output.delete()
                                onMessage(error.message ?: "Ошибка камеры")
                            }
                        },
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Фото")
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                    enabled = videoCapture != null,
                    onClick = {
                        val active = recording
                        if (active != null) {
                            active.stop()
                        } else {
                            val output = viewModel.newCaptureFile(visitId, MediaKind.VIDEO, findingId)
                            videoFile = output
                            var pending = videoCapture!!.output
                                .prepareRecording(context, FileOutputOptions.Builder(output).build())
                            if (ContextCompat.checkSelfPermission(
                                    context,
                                    Manifest.permission.RECORD_AUDIO,
                                ) == PackageManager.PERMISSION_GRANTED
                            ) {
                                pending = pending.withAudioEnabled()
                            }
                            recording = pending.start(ContextCompat.getMainExecutor(context)) { event ->
                                if (event is VideoRecordEvent.Finalize) {
                                    recording = null
                                    val completed = videoFile
                                    videoFile = null
                                    if (!event.hasError() && completed != null) {
                                        viewModel.registerCapture(
                                            visitId = visitId,
                                            findingId = findingId,
                                            kind = MediaKind.VIDEO,
                                            mimeType = "video/mp4",
                                            file = completed,
                                            onSuccess = {
                                                onMessage("Видео сохранено на телефоне")
                                            },
                                            onFailure = {
                                                onMessage(it.message ?: "Ошибка сохранения видео")
                                            },
                                        )
                                    } else {
                                        completed?.delete()
                                        onMessage("Видео не сохранено: ${event.error}")
                                    }
                                }
                            }
                        }
                    },
                    modifier = Modifier.weight(1f),
                    ) {
                        Text(if (recording == null) "Видео" else "Стоп")
                    }

                    Button(onClick = onClose, modifier = Modifier.weight(1f)) {
                        Text("Назад")
                    }
                }
                }
            }
        }
    }
}
