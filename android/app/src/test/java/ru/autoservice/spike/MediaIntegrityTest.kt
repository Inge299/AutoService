package ru.autoservice.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ru.autoservice.spike.sync.MediaIntegrity

class MediaIntegrityTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `checksum is stable for the same bytes`() {
        val file = temporaryFolder.newFile("photo.jpg").apply {
            writeBytes("offline-media".encodeToByteArray())
        }

        assertEquals(MediaIntegrity.sha256(file), MediaIntegrity.sha256(file))
    }

    @Test
    fun `checksum changes when a local file changes`() {
        val file = temporaryFolder.newFile("video.mp4").apply {
            writeBytes(byteArrayOf(1, 2, 3, 4))
        }
        val before = MediaIntegrity.sha256(file)

        file.appendBytes(byteArrayOf(5))

        assertNotEquals(before, MediaIntegrity.sha256(file))
    }
}

