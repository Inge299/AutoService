package ru.autoservice.spike.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class ReportComposerTest {
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
