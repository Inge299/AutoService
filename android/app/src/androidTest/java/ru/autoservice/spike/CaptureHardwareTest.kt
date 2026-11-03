package ru.autoservice.spike

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaMetadataRetriever
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import ru.autoservice.spike.media.VoiceRecorder
import java.io.File

@RunWith(AndroidJUnit4::class)
class CaptureHardwareTest {
    @Test fun microphoneProducesPlayableRecording() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Manual hardware test: grant RECORD_AUDIO to the isolated package first",
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        val file = File(context.cacheDir, "synthetic-hardware-audio.m4a")
        val recorder = VoiceRecorder(context)
        try {
            recorder.start(file)
            Thread.sleep(1800)
            assertNotNull(recorder.stop())
            assertTrue(file.length() > 0)
            val reader = MediaMetadataRetriever()
            try {
                reader.setDataSource(file.absolutePath)
                assertTrue((reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) > 500)
                assertTrue(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes")
            } finally { reader.release() }
        } finally { recorder.release(); file.delete() }
    }
}
