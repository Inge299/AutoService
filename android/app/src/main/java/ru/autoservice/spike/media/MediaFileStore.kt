package ru.autoservice.spike.media

import android.content.Context
import ru.autoservice.spike.data.MediaKind
import ru.autoservice.spike.sync.MediaIntegrity
import java.io.File
import java.util.UUID

class MediaFileStore(context: Context, workshopId: String) {
    private val pendingDirectory = File(context.noBackupFilesDir, "workshops/$workshopId/pending_media").apply {
        mkdirs()
    }

    fun importLegacy(source: File): File {
        val target = File(pendingDirectory, source.name)
        if (!target.exists()) source.copyTo(target)
        return target
    }

    fun newCaptureFile(visitId: String, kind: MediaKind, findingId: String? = null): File {
        require(visitId.matches(Regex("[A-Za-z0-9-]+"))) { "Unsafe visit id" }
        require(findingId == null || findingId.matches(Regex("[A-Za-z0-9-]+"))) { "Unsafe finding id" }
        val extension = when (kind) {
            MediaKind.PHOTO -> "jpg"
            MediaKind.VIDEO -> "mp4"
            MediaKind.VOICE -> "m4a"
        }
        val findingPart = findingId?.let { "$FINDING_PREFIX$it$VISIT_SEPARATOR" }.orEmpty()
        return File(
            pendingDirectory,
            "$visitId$VISIT_SEPARATOR$findingPart${UUID.randomUUID()}.$extension.capture",
        )
    }

    fun commitCapture(captureFile: File): File {
        require(captureFile.parentFile?.canonicalFile == pendingDirectory.canonicalFile) {
            "Capture file is outside the private media directory"
        }
        require(captureFile.name.endsWith(CAPTURE_SUFFIX)) { "Capture file is not temporary" }
        require(captureFile.isFile && captureFile.length() > 0L) { "Capture is empty" }

        val committed = File(
            pendingDirectory,
            captureFile.name.removeSuffix(CAPTURE_SUFFIX),
        )
        check(captureFile.renameTo(committed)) { "Unable to commit captured file" }
        return committed
    }

    fun committedFiles(): List<File> = pendingDirectory
        .listFiles()
        .orEmpty()
        .filter { file ->
            file.isFile &&
                file.length() > 0L &&
                !file.name.endsWith(CAPTURE_SUFFIX) &&
                mediaKind(file) != null
        }

    fun mediaKind(file: File): MediaKind? = when (file.extension.lowercase()) {
        "jpg", "jpeg" -> MediaKind.PHOTO
        "mp4" -> MediaKind.VIDEO
        "m4a" -> MediaKind.VOICE
        else -> null
    }

    fun mimeType(file: File): String? = when (mediaKind(file)) {
        MediaKind.PHOTO -> "image/jpeg"
        MediaKind.VIDEO -> "video/mp4"
        MediaKind.VOICE -> "audio/mp4"
        null -> null
    }

    fun visitId(file: File): String? = file.name
        .substringBefore(VISIT_SEPARATOR, missingDelimiterValue = "")
        .takeIf { it.isNotBlank() }

    fun findingId(file: File): String? = file.name
        .substringAfter(VISIT_SEPARATOR, missingDelimiterValue = "")
        .takeIf { it.startsWith(FINDING_PREFIX) }
        ?.substringAfter(FINDING_PREFIX)
        ?.substringBefore(VISIT_SEPARATOR)
        ?.takeIf { it.isNotBlank() }

    fun requireComplete(file: File): StoredFile {
        require(file.parentFile?.canonicalFile == pendingDirectory.canonicalFile) { "Файл относится к другой мастерской" }
        require(file.exists()) { "Captured file does not exist: ${file.absolutePath}" }
        require(file.isFile) { "Capture target is not a file: ${file.absolutePath}" }
        require(file.length() > 0L) { "Captured file is empty: ${file.absolutePath}" }

        return StoredFile(
            path = file.absolutePath,
            byteCount = file.length(),
            sha256 = MediaIntegrity.sha256(file),
        )
    }

    fun verify(path: String, expectedBytes: Long, expectedSha256: String): Boolean {
        val file = File(path)
        return file.isFile &&
            file.length() == expectedBytes &&
            MediaIntegrity.sha256(file) == expectedSha256
    }

    data class StoredFile(
        val path: String,
        val byteCount: Long,
        val sha256: String,
    )

    private companion object {
        const val CAPTURE_SUFFIX = ".capture"
        const val VISIT_SEPARATOR = "__"
        const val FINDING_PREFIX = "finding-"
    }
}
