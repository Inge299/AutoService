package ru.autoservice.spike.media

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var output: File? = null

    fun start(file: File) {
        check(recorder == null) { "Voice recording is already active" }
        val nextRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        try {
            nextRecorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(96_000)
                setAudioSamplingRate(44_100)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            output = file
            recorder = nextRecorder
        } catch (error: Throwable) {
            nextRecorder.release()
            file.delete()
            throw error
        }
    }

    fun stop(): File? {
        val active = recorder ?: return null
        val file = output
        recorder = null
        output = null
        return try {
            active.stop()
            file
        } catch (_: RuntimeException) {
            file?.delete()
            null
        } finally {
            active.release()
        }
    }

    fun release() {
        val active = recorder ?: return
        recorder = null
        output?.delete()
        output = null
        runCatching { active.stop() }
        active.release()
    }
}

