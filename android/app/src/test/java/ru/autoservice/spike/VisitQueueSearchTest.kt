package ru.autoservice.spike

import org.junit.Assert.*
import org.junit.Test
import ru.autoservice.spike.data.*
import ru.autoservice.spike.ui.QueueFilter
import ru.autoservice.spike.ui.filterVisitQueue

class VisitQueueSearchTest {
    private fun visit(id: String, status: VisitStatus = VisitStatus.DRAFT) = VisitEntity(id, "Семён", "8 (999) 111-22-33", "Toyota", "А123ВС77", null, "", status, 1, 1, SyncState.SYNCED)
    @Test fun searchHandlesCyrillicLatinPlatesPhonesAndNames() {
        for (q in listOf("a123bc 77", "+7 999 1112233", "9991112233", "семен"))
            assertEquals(q, listOf("one"), filterVisitQueue(listOf(visit("one")), q, QueueFilter.ACTIVE, emptySet()).map { it.id })
    }
    @Test fun archiveIsSeparateAndStatusFiltersRemainExact() {
        val rows = listOf(visit("draft"), visit("repair", VisitStatus.IN_REPAIR), visit("completed", VisitStatus.COMPLETED), visit("cancelled", VisitStatus.CANCELLED))
        assertEquals(2, filterVisitQueue(rows, "", QueueFilter.ACTIVE, emptySet()).size)
        assertEquals(setOf("completed", "cancelled"), filterVisitQueue(rows, "", QueueFilter.ARCHIVE, emptySet()).map { it.id }.toSet())
        assertEquals("repair", filterVisitQueue(rows, "", QueueFilter.IN_REPAIR, emptySet()).single().id)
    }
    @Test fun requestedCallPrecedesOrdinaryWaitingAndClosedVisitsAreExcludedFromAttention() {
        val rows = listOf(visit("waiting", VisitStatus.WAITING_APPROVAL), visit("call"), visit("closed", VisitStatus.COMPLETED))
        assertEquals("call", filterVisitQueue(rows, "", QueueFilter.ACTIVE, setOf("call", "closed")).first().id)
        assertEquals("call", filterVisitQueue(rows, "", QueueFilter.ATTENTION, setOf("call", "closed")).single().id)
        assertTrue(filterVisitQueue(rows, "нет такого", QueueFilter.ACTIVE, emptySet()).isEmpty())
    }
}
