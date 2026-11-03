package ru.autoservice.spike.ui

import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitStatus

internal enum class QueueFilter(val label: String) {
    ACTIVE("Все активные"), UPLOADS("Загрузки"), ATTENTION("Нужен звонок"), DRAFT("Черновики"),
    IN_REPAIR("В ремонте"), WAITING_APPROVAL("Ждут решения"), ARCHIVE("Архив")
}

internal fun filterVisitQueue(visits: List<VisitEntity>, query: String, filter: QueueFilter, attentionIds: Set<String>, uploadIds: Set<String> = emptySet()): List<VisitEntity> {
    val text = query.trim().lowercase().replace('ё', 'е')
    val phone = phoneSearchKey(text)
    val phoneQuery = text.isNotEmpty() && text.all { it.isDigit() || it in "+ ()-" } && phone.length >= 3
    return visits.filter { visit ->
        val archived = visit.status in setOf(VisitStatus.COMPLETED, VisitStatus.CANCELLED)
        val scope = when (filter) {
            QueueFilter.ACTIVE -> !archived
            QueueFilter.UPLOADS -> visit.id in uploadIds
            QueueFilter.ATTENTION -> !archived && visit.id in attentionIds
            QueueFilter.ARCHIVE -> archived
            else -> visit.status.name == filter.name
        }
        scope && (text.isEmpty() || listOf(visit.customerName, visit.vehicleLabel).any { it.lowercase().replace('ё', 'е').contains(text) } ||
            (plateSearchKey(text).isNotEmpty() && plateSearchKey(visit.licensePlate).contains(plateSearchKey(text))) ||
            (phoneQuery && phoneSearchKey(visit.customerPhone).contains(phone)))
    }.sortedWith(compareBy<VisitEntity> { if (it.id in attentionIds) 0 else 1 }
        .thenBy { when (it.status) { VisitStatus.WAITING_APPROVAL -> 0; VisitStatus.IN_REPAIR -> 1; else -> 2 } }
        .thenByDescending { it.updatedAtEpochMs }.thenBy { it.id })
}

private fun phoneSearchKey(value: String) = value.filter(Char::isDigit).let {
    if (it.length == 10) "7$it" else if (it.length == 11 && it.startsWith('8')) "7" + it.drop(1) else it
}

private fun plateSearchKey(value: String): String {
    val latin = "ABEKMHOPCTYX"
    val cyrillic = "АВЕКМНОРСТУХ"
    return value.uppercase().filterNot { it.isWhitespace() || it == '-' }.map { ch -> latin.indexOf(ch).let { if (it >= 0) cyrillic[it] else ch } }.joinToString("")
}
