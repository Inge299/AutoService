package ru.autoservice.spike.ui

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingStatus

class FollowUpPlanTest {
    @Test fun inheritedDateNeverOverridesAnIndividualDateOrExplicitNoDate() {
        val finding = FindingEntity("finding", "visit", "Test", "", null,
            FindingPriority.PLANNED, FindingStatus.DEFERRED, 1, 1)
        assertEquals(1234L, initialFollowUpDueAt(finding, 1234L))
        assertEquals(5678L, initialFollowUpDueAt(finding.copy(followUpConfigured = true, followUpDueAtEpochMs = 5678L), 1234L))
        assertEquals(null, initialFollowUpDueAt(finding.copy(followUpConfigured = true), 1234L))
    }
}
