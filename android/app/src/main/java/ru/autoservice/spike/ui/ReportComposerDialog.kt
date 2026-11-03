package ru.autoservice.spike.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ru.autoservice.spike.data.ReportDraft
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun ReportComposerDialog(
    initialCompletedWork: String,
    initialRecommendations: String,
    initialNextVisitAtEpochMs: Long?,
    onDismiss: () -> Unit,
    onPublish: (ReportDraft) -> Unit,
    completedFindingTitles: List<String> = emptyList(),
    futureFindingTitles: List<String> = emptyList(),
    hasIndividualPlans: Boolean = false,
) {
    var completedWork by rememberSaveable(initialCompletedWork) { mutableStateOf(initialCompletedWork) }
    var recommendations by rememberSaveable(initialRecommendations) { mutableStateOf(initialRecommendations) }
    var nextVisitAt by rememberSaveable(initialNextVisitAtEpochMs) { mutableStateOf(initialNextVisitAtEpochMs) }
    var showValidation by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val maxHeight = LocalConfiguration.current.screenHeightDp.dp * 0.9f
    fun selectDate() {
        val date = nextVisitAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() } ?: today.plusMonths(1)
        DatePickerDialog(context, { _, year, month, day ->
            nextVisitAt = reportDateEpoch(LocalDate.of(year, month + 1, day), zone)
        }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
            datePicker.minDate = reportDateEpoch(today, zone)
        }.show()
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.padding(16.dp).widthIn(max = 560.dp).fillMaxWidth().heightIn(max = maxHeight).imePadding(),
            shape = RoundedCornerShape(24.dp), tonalElevation = 6.dp) {
            Column {
                Column(modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Итоговый отчёт", style = MaterialTheme.typography.headlineSmall)
                    Text("После публикации визит завершится. Клиент получит неизменяемую версию отчёта.", style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(value = completedWork, onValueChange = { completedWork = it },
                        label = { Text("Что выполнено") }, minLines = 3,
                        supportingText = { Text("Перечислите фактически выполненные работы") },
                        isError = showValidation && completedWork.isBlank(), modifier = Modifier.fillMaxWidth())
                    if (completedFindingTitles.isNotEmpty()) {
                        OutlinedButton(onClick = { completedWork = appendReportLines(completedWork, completedFindingTitles) },
                            modifier = Modifier.fillMaxWidth()) { Text("Добавить выполненные работы") }
                    }
                    if (showValidation && completedWork.isBlank()) {
                        Text("Опишите выполненные работы", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    OutlinedTextField(value = recommendations, onValueChange = { recommendations = it },
                        label = { Text("Рекомендации клиенту") }, minLines = 2,
                        supportingText = { Text("Необязательно. Подсказки можно дополнять и редактировать.") }, modifier = Modifier.fillMaxWidth())
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Контрольный осмотр", "Плановое ТО", "Повторная диагностика").forEach { suggestion ->
                            AssistChip(onClick = { recommendations = appendReportLines(recommendations, listOf(suggestion)) }, label = { Text(suggestion) })
                        }
                    }
                    if (futureFindingTitles.isNotEmpty()) {
                        Text("Необходимо выполнить в дальнейшем", style = MaterialTheme.typography.titleMedium)
                        futureFindingTitles.distinct().forEach { Text("• $it") }
                        Text("Эти работы будут добавлены в рекомендации. Индивидуальный срок из плана работы имеет приоритет; для остальных используется дата следующего визита.", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Следующий визит", style = MaterialTheme.typography.titleMedium)
                    OutlinedButton(onClick = ::selectDate, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                        Text(nextVisitAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate().format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) } ?: "Выбрать дату в календаре")
                    }
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Через неделю" to today.plusWeeks(1), "Через месяц" to today.plusMonths(1),
                            "Через 3 месяца" to today.plusMonths(3), "Через 6 месяцев" to today.plusMonths(6)).forEach { (label, date) ->
                            AssistChip(onClick = { nextVisitAt = reportDateEpoch(date, zone) }, label = { Text(label) })
                        }
                    }
                    if (nextVisitAt != null) TextButton(onClick = { nextVisitAt = null }) { Text("Не планировать визит") }
                    else Text("Дату можно не назначать.", style = MaterialTheme.typography.bodySmall)
                    Text(if (hasIndividualPlans) "Напоминания создаются отдельно для каждой работы с назначенным сроком. Следующий визит задаёт срок только работам без индивидуального плана."
                        else if (nextVisitAt != null) "Для каждой работы будет создано напоминание за 7 дней до срока; если осталось меньше недели — сразу."
                        else "Без даты автоматическое напоминание не создаётся. Срок работ нужно согласовать с клиентом.", style = MaterialTheme.typography.bodySmall)
                }
                HorizontalDivider()
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        showValidation = true
                        if (completedWork.isNotBlank()) onPublish(ReportDraft(completedWork.trim(),
                            futureWorkRecommendations(recommendations, futureFindingTitles, nextVisitAt), nextVisitAt))
                    }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Опубликовать отчёт") }
                    OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Отмена") }
                }
            }
        }
    }
}

internal fun reportDateEpoch(date: LocalDate, zone: ZoneId): Long = date.atStartOfDay(zone).toInstant().toEpochMilli()

internal fun appendReportLines(current: String, suggestions: List<String>): String {
    val lines = current.lines().map(String::trim).filter(String::isNotBlank)
    return (lines + suggestions.map(String::trim).filter(String::isNotBlank)).distinct().joinToString("\n")
}

internal fun futureWorkRecommendations(notes: String, titles: List<String>, dueAt: Long?): String {
    val date = dueAt?.let { Instant.ofEpochMilli(it).atZone(ZoneId.of("Europe/Moscow")).toLocalDate()
        .format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) }
    val prefixes = titles.distinct().map { "Не выполнено в этот визит: $it. Необходимо выполнить в дальнейшем." }
    val generated = Regex("^Не выполнено в этот визит: .+\\. Необходимо выполнить в дальнейшем\\. (Рекомендуемый срок: до \\d{2}\\.\\d{2}\\.\\d{4}\\.|Срок необходимо согласовать с мастерской\\.)$")
    val custom = notes.lines().filterNot { generated.matches(it.trim()) }.joinToString("\n").trim()
    return (listOf(custom) + prefixes.map { "$it ${date?.let { value -> "Рекомендуемый срок: до $value." } ?: "Срок необходимо согласовать с мастерской."}" })
        .filter(String::isNotBlank).joinToString("\n")
}
