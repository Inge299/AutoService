package ru.autoservice.spike.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ru.autoservice.spike.data.FindingEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal fun initialFollowUpDueAt(finding: FindingEntity, inheritedDueAt: Long?): Long? =
    if (finding.followUpConfigured) finding.followUpDueAtEpochMs else inheritedDueAt

@Composable
internal fun FollowUpPlanDialog(finding: FindingEntity, inheritedDueAt: Long?, onDismiss: () -> Unit,
    onSubmit: (Long?, String, (String?) -> Unit) -> Unit) {
    val zone = ZoneId.of("Europe/Moscow")
    val today = LocalDate.now(zone)
    val context = LocalContext.current
    var dueAt by rememberSaveable(finding.id) { mutableStateOf(initialFollowUpDueAt(finding, inheritedDueAt)) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmCancel by remember { mutableStateOf(false) }
    val active = finding.followUpState == "OPEN"
    fun submit(state: String) {
        busy = true; error = null
        onSubmit(dueAt, state) { message -> busy = false; error = message }
    }
    fun chooseDate() {
        val date = dueAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() } ?: today.plusMonths(1)
        DatePickerDialog(context, { _, year, month, day ->
            dueAt = LocalDate.of(year, month + 1, day).atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
        }, date.year, date.monthValue-1, date.dayOfMonth).apply { datePicker.minDate=today.atStartOfDay(zone).toInstant().toEpochMilli() }.show()
    }
    Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(shape = MaterialTheme.shapes.extraLarge, tonalElevation = 6.dp,
            modifier = Modifier.padding(16.dp).widthIn(max=520.dp).fillMaxWidth().heightIn(max=LocalConfiguration.current.screenHeightDp.dp*.88f)) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                Text("План работы",style=MaterialTheme.typography.headlineSmall)
                Text(finding.title,style=MaterialTheme.typography.titleMedium)
                Text("Назначьте срок или отметьте выполнение. Исходный отчёт останется в истории.",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Выполнить до",style=MaterialTheme.typography.labelLarge)
                OutlinedButton(onClick=::chooseDate,enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) {
                    Text(dueAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate().format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) } ?: "Выбрать в календаре")
                }
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp),modifier=Modifier.fillMaxWidth()) {
                    listOf("2 недели" to today.plusWeeks(2), "Месяц" to today.plusMonths(1)).forEach { (label,date) ->
                        OutlinedButton(onClick={dueAt=date.atTime(12,0).atZone(zone).toInstant().toEpochMilli()},enabled=!busy,modifier=Modifier.weight(1f).heightIn(min=48.dp)) { Text(label) }
                    }
                }
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp),modifier=Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick={dueAt=today.plusMonths(3).atTime(12,0).atZone(zone).toInstant().toEpochMilli()},enabled=!busy,modifier=Modifier.weight(1f).heightIn(min=48.dp)) { Text("3 месяца") }
                    OutlinedButton(onClick={dueAt=null},enabled=!busy,modifier=Modifier.weight(1f).heightIn(min=48.dp)) { Text("Без срока") }
                }
                error?.let { Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodyMedium) }
                Button(onClick={submit("OPEN")},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(if(busy)"Сохраняем…" else if(active)"Сохранить срок" else "Вернуть в план") }
                if(active) {
                    OutlinedButton(onClick={submit("DONE")},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text("Отметить выполненной") }
                    TextButton(onClick={confirmCancel=true},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text("Снять с плана") }
                }
                TextButton(onClick=onDismiss,enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text("Закрыть") }
                Text("Для сохранения нужна связь. Ожидающее напоминание этой работы обновится автоматически.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if(confirmCancel) AlertDialog(onDismissRequest={confirmCancel=false},title={Text("Снять работу с плана?")},
        text={Text("Ожидающее напоминание будет отменено. История сохранится, работу можно вернуть в план.")},
        confirmButton={TextButton(onClick={confirmCancel=false;submit("CANCELLED")}){Text("Снять с плана")}},
        dismissButton={TextButton(onClick={confirmCancel=false}){Text("Оставить")}})
}
