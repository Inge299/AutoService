package ru.autoservice.spike.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingStatus
import ru.autoservice.spike.data.MediaAssetEntity
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitStatus
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

class ApiException(val statusCode: Int, message: String) : IOException(message)

data class WorkshopSnapshot(
    val visits: List<VisitEntity>,
    val findings: List<FindingEntity>,
)

interface WorkshopRemote {
    suspend fun loadWorkshop(): WorkshopSnapshot
    suspend fun saveVisit(visit: VisitEntity): VisitEntity
    suspend fun saveFinding(finding: FindingEntity): FindingEntity
    suspend fun uploadMedia(asset: MediaAssetEntity)
}

class AutoServiceApi(
    baseUrl: String,
    private val authStore: AuthStore,
) : WorkshopRemote {
    private val baseUrl = baseUrl.trimEnd('/')

    suspend fun login(login: String, password: String): AuthSession = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("login", login.trim())
            .put("password", password)
        val json = request("POST", "/v1/auth/login", body = body, authenticated = false)
        val session = AuthSession(
            accessToken = json.getString("accessToken"),
            userId = json.getString("userId"),
            workshopId = json.getString("workshopId"),
            displayName = json.getString("displayName"),
            role = json.getString("role"),
            expiresAtEpochMs = json.getLong("expiresAtEpochMs"),
        )
        authStore.save(session)
        session
    }

    override suspend fun loadWorkshop(): WorkshopSnapshot = withContext(Dispatchers.IO) {
        val response = requestArray("GET", "/v1/visits?limit=200")
        val visits = mutableListOf<VisitEntity>()
        val findings = mutableListOf<FindingEntity>()
        for (index in 0 until response.length()) {
            val item = response.getJSONObject(index)
            visits += item.toVisit()
            val nested = item.optJSONArray("findings") ?: JSONArray()
            for (findingIndex in 0 until nested.length()) {
                findings += nested.getJSONObject(findingIndex).toFinding()
            }
        }
        WorkshopSnapshot(visits, findings)
    }

    override suspend fun saveVisit(visit: VisitEntity): VisitEntity = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("customerName", visit.customerName)
            .put("customerPhone", visit.customerPhone)
            .put("vehicleLabel", visit.vehicleLabel)
            .put("licensePlate", visit.licensePlate)
            .put("mileageKm", visit.mileageKm ?: JSONObject.NULL)
            .put("complaint", visit.complaint)
            .put("status", visit.status.name)
            .put("createdAtEpochMs", visit.createdAtEpochMs)
            .put("updatedAtEpochMs", visit.updatedAtEpochMs)
            .put("baseServerVersion", visit.serverVersion.takeIf { it > 0 } ?: JSONObject.NULL)
        request("PUT", "/v1/visits/${visit.id}", body).toVisit()
    }

    override suspend fun saveFinding(finding: FindingEntity): FindingEntity = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("visitId", finding.visitId)
            .put("title", finding.title)
            .put("description", finding.description)
            .put("priceRub", finding.priceRub ?: JSONObject.NULL)
            .put("priority", finding.priority.name)
            .put("status", finding.status.name)
            .put("createdAtEpochMs", finding.createdAtEpochMs)
            .put("updatedAtEpochMs", finding.updatedAtEpochMs)
            .put("baseServerVersion", finding.serverVersion.takeIf { it > 0 } ?: JSONObject.NULL)
        request("PUT", "/v1/findings/${finding.id}", body).toFinding()
    }

    override suspend fun uploadMedia(asset: MediaAssetEntity): Unit = withContext(Dispatchers.IO) {
        val sessionBody = JSONObject()
            .put("operationId", asset.operationId)
            .put("visitId", asset.visitId)
            .put("findingId", asset.findingId ?: JSONObject.NULL)
            .put("kind", asset.kind.name)
            .put("mimeType", asset.mimeType)
            .put("byteCount", asset.byteCount)
            .put("sha256", asset.sha256)
        val target = request("POST", "/v1/media/${asset.id}/upload-session", sessionBody)
        uploadFile(target.getString("url"), target.getJSONObject("headers"), File(asset.localPath))
        request("POST", "/v1/media/${asset.id}/complete", JSONObject())

        repeat(20) {
            val state = request("GET", "/v1/media/${asset.id}").getString("state")
            if (state in setOf("VERIFIED", "PROCESSING", "READY")) return@withContext
            if (state == "BLOCKED") throw IllegalArgumentException("Сервер отклонил повреждённый файл")
            Thread.sleep(500)
        }
        throw IOException("Сервер ещё проверяет файл")
    }

    private fun uploadFile(url: String, headers: JSONObject, file: File) {
        if (!file.isFile) throw IOException("Локальный файл не найден")
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PUT"
            connection.doOutput = true
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setFixedLengthStreamingMode(file.length())
            headers.keys().forEach { name -> connection.setRequestProperty(name, headers.getString(name)) }
            file.inputStream().use { input -> connection.outputStream.use { output -> input.copyTo(output) } }
            val status = connection.responseCode
            if (status !in 200..299) throw ApiException(status, "Хранилище отклонило загрузку ($status)")
        } finally {
            connection.disconnect()
        }
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        authenticated: Boolean = true,
    ): JSONObject = JSONObject(requestText(method, path, body, authenticated))

    private fun requestArray(method: String, path: String): JSONArray =
        JSONArray(requestText(method, path, null, authenticated = true))

    private fun requestText(
        method: String,
        path: String,
        body: JSONObject?,
        authenticated: Boolean,
    ): String {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("accept", "application/json")
            if (authenticated) {
                val session = authStore.session.value ?: throw ApiException(401, "Войдите в систему")
                connection.setRequestProperty("authorization", "Bearer ${session.accessToken}")
            }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                if (authenticated && status in setOf(401, 403)) authStore.clear()
                val code = runCatching { JSONObject(response).optString("error") }.getOrNull()
                throw ApiException(status, code?.takeIf(String::isNotBlank) ?: "Ошибка сервера ($status)")
            }
            return response.ifBlank { "{}" }
        } finally {
            connection.disconnect()
        }
    }
}

private fun JSONObject.toVisit(): VisitEntity = VisitEntity(
    id = getString("id"),
    customerName = getString("customerName"),
    customerPhone = getString("customerPhone"),
    vehicleLabel = getString("vehicleLabel"),
    licensePlate = getString("licensePlate"),
    mileageKm = takeUnless { isNull("mileageKm") }?.getInt("mileageKm"),
    complaint = getString("complaint"),
    status = VisitStatus.valueOf(getString("status")),
    createdAtEpochMs = Instant.parse(getString("createdAt")).toEpochMilli(),
    updatedAtEpochMs = Instant.parse(getString("updatedAt")).toEpochMilli(),
    syncState = SyncState.SYNCED,
    serverVersion = getInt("serverVersion"),
)

private fun JSONObject.toFinding(): FindingEntity = FindingEntity(
    id = getString("id"),
    visitId = getString("visitId"),
    title = getString("title"),
    description = getString("description"),
    priceRub = takeUnless { isNull("priceRub") }?.getInt("priceRub"),
    priority = FindingPriority.valueOf(getString("priority")),
    status = FindingStatus.valueOf(getString("status")),
    createdAtEpochMs = Instant.parse(getString("createdAt")).toEpochMilli(),
    updatedAtEpochMs = Instant.parse(getString("updatedAt")).toEpochMilli(),
    serverVersion = getInt("serverVersion"),
)
