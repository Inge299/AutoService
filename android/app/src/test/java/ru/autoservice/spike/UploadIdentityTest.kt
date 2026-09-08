package ru.autoservice.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import ru.autoservice.spike.sync.UploadScheduler

class UploadIdentityTest {
    @Test
    fun `same asset produces same unique work name`() {
        assertEquals(
            UploadScheduler.uniqueName("asset-1"),
            UploadScheduler.uniqueName("asset-1"),
        )
    }

    @Test
    fun `different assets do not share work`() {
        assertNotEquals(
            UploadScheduler.uniqueName("asset-1"),
            UploadScheduler.uniqueName("asset-2"),
        )
    }
}
