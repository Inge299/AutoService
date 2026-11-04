package ru.autoservice.spike.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.toggleable
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
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

data class ReportRecommendationOption(val id: String, val title: String, val dueAtEpochMs: Long?, val followUpConfigured: Boolean = false)

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
    privateFindingIds: List<String> = emptyList(),
    expectedMediaIds: List<String> = emptyList(),
    pendingMediaCount: Int = 0,
    privateRecommendationOptions: List<ReportRecommendationOption> = emptyList(),
    initialRecommendedPrivateIds: List<String> = emptyList(),
) {
    var completedWork by rememberSaveable(initialCompletedWork) { mutableStateOf(initialCompletedWork) }
    var recommendations by rememberSaveable(initialRecommendations) { mutableStateOf(initialRecommendations) }
    var nextVisitAt by rememberSaveable(initialNextVisitAtEpochMs) { mutableStateOf(initialNextVisitAtEpochMs) }
    var showValidation by rememberSaveable { mutableStateOf(false) }
    var reviewing by rememberSaveable { mutableStateOf(false) }
    val contentScroll = rememberScrollState()
    LaunchedEffect(reviewing) { contentScroll.scrollTo(0) }
    val acknowledgedPrivateIds = rememberSaveable { ArrayList(privateFindingIds) }
    var recommendedIds by rememberSaveable { mutableStateOf(ArrayList(initialRecommendedPrivateIds.filter { it in privateFindingIds })) }
    val acknowledgedMediaIds = rememberSaveable { ArrayList(expectedMediaIds) }
    val context = LocalContext.current
    val zone = ZoneId.of("Europe/Moscow")
    val today = LocalDate.now(zone)
    val maxHeight = LocalConfiguration.current.screenHeightDp.dp * 0.9f
    fun recommendationDeadline(option: ReportRecommendationOption): String {
        val deadline = if (option.followUpConfigured) option.dueAtEpochMs else nextVisitAt
        return deadline?.let { "Срок: " + Instant.ofEpochMilli(it).atZone(zone).toLocalDate().format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) } ?: "Срок не указан"
    }
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
                Column(modifier = Modifier.weight(1f, fill = false).verticalScroll(contentScroll).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Итоговый отчёт", style = MaterialTheme.typography.headlineSmall)
                    Text(if (reviewing) "Проверьте состав отчёта. Ссылку нужно будет отправить клиенту отдельно." else "После публикации визит завершится, а ссылка на отчёт будет готова. Отправьте её клиенту отдельно.", style = MaterialTheme.typography.bodySmall)
                    if (!reviewing && acknowledgedPrivateIds.isNotEmpty()) {
                        if (privateRecommendationOptions.isEmpty()) {
                            Text("Черновики и их материалы не войдут в отчёт: ${acknowledgedPrivateIds.size}. Чтобы рекомендовать работу клиенту, опишите её в рекомендациях.", style = MaterialTheme.typography.bodySmall)
                        } else {
                            Text("Черновики не публикуются автоматически. Можно отдельно включить работу как рекомендацию; её материалы останутся внутренними.", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    if (pendingMediaCount > 0) {
                        Text("Ожидают загрузки: $pendingMediaCount. Отчёт можно опубликовать после проверки материалов.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                    if (!reviewing && privateRecommendationOptions.isNotEmpty()) {
                        Text("Рекомендовать из черновиков", style = MaterialTheme.typography.titleMedium)
                        Text("Отметьте работы, которые клиенту стоит запланировать. Это не означает согласия на ремонт.", style = MaterialTheme.typography.bodySmall)
                        privateRecommendationOptions.forEach { option ->
                            Row(Modifier.fillMaxWidth().toggleable(value = option.id in recommendedIds, role = Role.Checkbox, onValueChange = { selected ->
                                recommendedIds = ArrayList(if (selected) recommendedIds + option.id else recommendedIds - option.id)
                            }), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Checkbox(checked = option.id in recommendedIds, onCheckedChange = null)
                                Column(Modifier.weight(1f).padding(top = 12.dp)) {
                                    Text(option.title, style = MaterialTheme.typography.bodyLarge)
                                    Text(recommendationDeadline(option), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                    if (reviewing) {
                        Text("Проверьте перед публикацией", style = MaterialTheme.typography.titleLarge)
                        Text("Что выполнено", style = MaterialTheme.typography.titleMedium)
                        Text(completedWork.trim())
                        Text("Дополнительные рекомендации", style = MaterialTheme.typography.titleMedium)
                        Text(recommendations.trim().ifBlank { "Не указаны" })
                        if (futureFindingTitles.isNotEmpty()) {
                            Text("Работы с планом", style = MaterialTheme.typography.titleMedium)
                            futureFindingTitles.distinct().forEach { Text("• $it") }
                            Text("Индивидуальные сроки берутся из плана каждой работы.", style = MaterialTheme.typography.bodySmall)
                        }
                        if (recommendedIds.isNotEmpty()) {
                            Text("Рекомендации из черновиков", style = MaterialTheme.typography.titleMedium)
                            privateRecommendationOptions.filter { it.id in recommendedIds }.forEach { Text("• ${it.title} — ${recommendationDeadline(it).lowercase()}") }
                            Text("Клиент ещё не согласовал эти работы; их материалы не публикуются.", style = MaterialTheme.typography.bodySmall)
                        }
                        Text("Следующий визит", style = MaterialTheme.typography.titleMedium)
                        Text(nextVisitAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate().format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) } ?: "Не назначен")
                        Text("Материалов в отчёте: ${acknowledgedMediaIds.size}", style = MaterialTheme.typography.bodyMedium)
                        Text("После публикации проверьте готовую ссылку и отправьте её клиенту.", style = MaterialTheme.typography.bodySmall)
                    } else {
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
                }
                HorizontalDivider()
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (reviewing) {
                        Button(onClick = { onPublish(ReportDraft(completedWork.trim(),
                            futureWorkRecommendations(recommendations, futureFindingTitles, nextVisitAt), nextVisitAt, acknowledgedPrivateIds, acknowledgedMediaIds, recommendedIds)) },
                            enabled = pendingMediaCount == 0, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Опубликовать отчёт") }
                        OutlinedButton(onClick = { reviewing = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Вернуться к редактированию") }
                    } else {
                        Button(onClick = { showValidation = true; if (completedWork.isNotBlank()) reviewing = true },
                            enabled = pendingMediaCount == 0, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Проверить отчёт") }
                        OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Отмена") }
                    }
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
