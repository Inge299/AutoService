package ru.autoservice.spike.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ru.autoservice.spike.data.ReportDraft
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

@Composable
fun ReportComposerDialog(
    initialCompletedWork: String,
    initialRecommendations: String,
    initialNextVisitAtEpochMs: Long?,
    onDismiss: () -> Unit,
    onPublish: (ReportDraft) -> Unit,
) {
    var completedWork by remember(initialCompletedWork) { mutableStateOf(initialCompletedWork) }
    var recommendations by remember(initialRecommendations) { mutableStateOf(initialRecommendations) }
    var nextVisitAt by remember(initialNextVisitAtEpochMs) { mutableStateOf(initialNextVisitAtEpochMs?.let(::formatNextVisitDate).orEmpty()) }
    var showValidation by remember { mutableStateOf(false) }
    val parsedNextVisitAt = parseNextVisitDate(nextVisitAt)
    val invalidNextVisitAt = nextVisitAt.isNotBlank() && parsedNextVisitAt == null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Итоговый отчёт") },
        text = {
            Column {
                Text("После публикации создаётся неизменяемая версия, а визит завершается.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = completedWork,
                    onValueChange = { completedWork = it },
                    label = { Text("Что выполнено") },
                    minLines = 3,
                    isError = showValidation && completedWork.isBlank(),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
                OutlinedTextField(
                    value = recommendations,
                    onValueChange = { recommendations = it },
                    label = { Text("Рекомендации клиенту") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                )
                OutlinedTextField(
                    value = nextVisitAt,
                    onValueChange = { nextVisitAt = it },
                    label = { Text("Следующий визит (дд.мм.гггг)") },
                    singleLine = true,
                    isError = showValidation && invalidNextVisitAt,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                )
                if (showValidation && completedWork.isBlank()) {
                    Text("Опишите выполненные работы", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                if (showValidation && invalidNextVisitAt) {
                    Text("Укажите дату в формате дд.мм.гггг", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                showValidation = true
                if (completedWork.isNotBlank() && !invalidNextVisitAt) {
                    onPublish(ReportDraft(completedWork, recommendations, parsedNextVisitAt))
                }
            }) { Text("Опубликовать отчёт") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Отмена") } },
    )
}

private fun formatNextVisitDate(epochMs: Long): String = reportDateFormatter.format(epochMs)

private fun parseNextVisitDate(value: String): Long? {
    val normalized = value.trim()
    if (normalized.isEmpty()) return null
    return runCatching { reportDateFormatter.parse(normalized)?.time }.getOrNull()
}

private val reportDateFormatter = SimpleDateFormat("dd.MM.yyyy", Locale.forLanguageTag("ru-RU")).apply {
    isLenient = false
    timeZone = TimeZone.getTimeZone("Europe/Moscow")
}
