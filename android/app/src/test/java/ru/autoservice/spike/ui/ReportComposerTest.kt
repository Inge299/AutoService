package ru.autoservice.spike.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class ReportComposerTest {
    @Test fun `future work has a clear deadline without losing custom recommendations`() {
        val due = reportDateEpoch(LocalDate.of(2026, 11, 18), ZoneId.of("Europe/Moscow"))
        val text = futureWorkRecommendations("Проверять масло", listOf("Заменить ремень", "Заменить ремень"), due)
        assertEquals("Проверять масло\nНе выполнено в этот визит: Заменить ремень. Необходимо выполнить в дальнейшем. Рекомендуемый срок: до 18.11.2026.", text)
        assertEquals(text, futureWorkRecommendations(text, listOf("Заменить ремень"), due))
        assertEquals("Проверять масло", futureWorkRecommendations(text, emptyList(), due))
    }

    @Test fun `future work without a date asks to agree a deadline`() {
        assertEquals("Не выполнено в этот визит: Заменить ремень. Необходимо выполнить в дальнейшем. Срок необходимо согласовать с мастерской.",
            futureWorkRecommendations("", listOf("Заменить ремень"), null))
    }
    @Test fun `calendar date preserves the selected local day across time zones`() {
        val date = LocalDate.of(2026, 10, 25)
        listOf("Europe/Moscow", "Europe/Berlin", "Pacific/Auckland").forEach { name ->
            val zone = ZoneId.of(name)
            assertEquals(date, Instant.ofEpochMilli(reportDateEpoch(date, zone)).atZone(zone).toLocalDate())
        }
    }

    @Test fun `adding completed work keeps custom notes and does not duplicate suggestions`() {
        assertEquals("Заменён фильтр\nКонтрольный осмотр\nПлановое ТО",
            appendReportLines("Заменён фильтр\nКонтрольный осмотр", listOf("Контрольный осмотр", "Плановое ТО")))
    }
}
