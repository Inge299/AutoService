package ru.autoservice.spike.sync

import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.network.WorkshopRemote

interface UploadTransport {
    suspend fun upload(asset: MediaAssetEntity): UploadReceipt
}

data class UploadReceipt(
    val remoteKey: String,
    val byteCount: Long,
    val sha256: String,
)

class ServerUploadTransport(private val api: WorkshopRemote) : UploadTransport {
    override suspend fun upload(asset: MediaAssetEntity): UploadReceipt {
        api.uploadMedia(asset)
        return UploadReceipt(
            remoteKey = asset.id,
            byteCount = asset.byteCount,
            sha256 = asset.sha256,
        )
    }
}
