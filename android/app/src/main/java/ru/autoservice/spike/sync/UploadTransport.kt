package ru.autoservice.spike.sync

import android.content.Context
import ru.autoservice.spike.data.MediaAssetEntity
import java.io.File

interface UploadTransport {
    suspend fun upload(asset: MediaAssetEntity): UploadReceipt
}

data class UploadReceipt(
    val remoteKey: String,
    val byteCount: Long,
    val sha256: String,
)

/**
 * Spike transport. It models an idempotent server by using operationId as the
 * destination key. Repeating the same work overwrites the same temporary file
 * and produces one final object. Replace this class with multipart HTTP while
 * keeping the UploadTransport contract.
 */
class LocalMirrorUploadTransport(context: Context) : UploadTransport {
    private val remoteDirectory = File(context.filesDir, "server_mirror").apply {
        mkdirs()
    }

    override suspend fun upload(asset: MediaAssetEntity): UploadReceipt {
        val source = File(asset.localPath)
        require(source.isFile) { "Local source is missing" }

        val finalFile = File(remoteDirectory, asset.operationId)
        val temporaryFile = File(remoteDirectory, "${asset.operationId}.part")
        source.inputStream().use { input ->
            temporaryFile.outputStream().use { output ->
                input.copyTo(output)
                output.flush()
            }
        }
        check(temporaryFile.length() == asset.byteCount) { "Copied size mismatch" }
        if (!temporaryFile.renameTo(finalFile)) {
            check(
                finalFile.isFile &&
                    finalFile.length() == asset.byteCount &&
                    MediaIntegrity.sha256(finalFile) == asset.sha256,
            ) { "Unable to publish mirrored file" }
            temporaryFile.delete()
        }

        val remoteSha256 = MediaIntegrity.sha256(finalFile)

        return UploadReceipt(
            remoteKey = "spike/${asset.operationId}",
            byteCount = finalFile.length(),
            sha256 = remoteSha256,
        )
    }
}
