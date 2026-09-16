package ru.autoservice.spike.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

data class OtpChallenge(
    val challengeId: String,
    val expiresInSeconds: Int,
    val resendAfterEpochMs: Long,
)

data class ApprovalLink(
    val publicUrl: String,
    val expiresAtEpochMs: Long,
)

interface WorkshopRemote {
    suspend fun loadWorkshop(): WorkshopSnapshot
    suspend fun saveVisit(visit: VisitEntity): VisitEntity
    suspend fun saveFinding(finding: FindingEntity): FindingEntity
    suspend fun createApprovalLink(
        findingId: String,
        operationId: String,
        token: String,
        mediaIds: List<String>,
    ): ApprovalLink
    suspend fun uploadMedia(asset: MediaAssetEntity)
}

class AutoServiceApi(
    baseUrl: String,
    private val authStore: AuthStore,
) : WorkshopRemote {
    private val baseUrl = baseUrl.trimEnd('/')
    private val refreshMutex = Mutex()

    suspend fun login(login: String, password: String): AuthSession = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("login", login.trim())
            .put("password", password)
        val json = request("POST", "/v1/auth/login", body = body, authenticated = false)
        val session = AuthSession(
            accessToken = json.getString("accessToken"),
            accessTokenExpiresAtEpochMs = json.getLong("accessTokenExpiresAtEpochMs"),
            refreshToken = json.getString("refreshToken"),
            refreshTokenExpiresAtEpochMs = json.getLong("refreshTokenExpiresAtEpochMs"),
            userId = json.getString("userId"),
            workshopId = json.getString("workshopId"),
            displayName = json.getString("displayName"),
            role = json.getString("role"),
        )
        authStore.save(session)
        session
    }

    suspend fun requestLoginCode(phone: String): OtpChallenge = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("audience", "STAFF")
            .put("phone", phone.trim())
        val json = request("POST", "/public/v1/auth/phone/request-code", body, authenticated = false)
        OtpChallenge(
            challengeId = json.getString("challengeId"),
            expiresInSeconds = json.getInt("expiresInSeconds"),
            resendAfterEpochMs = json.getLong("resendAfterEpochMs"),
        )
    }

    suspend fun verifyLoginCode(challengeId: String, code: String): AuthSession = withContext(Dispatchers.IO) {
        val tokenJson = request(
            "POST",
            "/public/v1/auth/phone/verify-code",
            JSONObject().put("challengeId", challengeId).put("code", code.trim()),
            authenticated = false,
        )
        val accessToken = tokenJson.getString("accessToken")
        val identity = requestWithAccessToken("GET", "/v1/session", accessToken)
        val session = AuthSession(
            accessToken = accessToken,
            accessTokenExpiresAtEpochMs = tokenJson.getLong("accessTokenExpiresAtEpochMs"),
            refreshToken = tokenJson.getString("refreshToken"),
            refreshTokenExpiresAtEpochMs = tokenJson.getLong("refreshTokenExpiresAtEpochMs"),
            userId = identity.getString("id"),
            workshopId = identity.getString("workshopId"),
            displayName = identity.getString("displayName"),
            role = identity.getString("role"),
        )
        authStore.save(session)
        session
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        try {
            if (authStore.session.value != null) request("POST", "/v1/auth/logout", JSONObject())
        } finally {
            authStore.clear()
        }
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

    override suspend fun createApprovalLink(
        findingId: String,
        operationId: String,
        token: String,
        mediaIds: List<String>,
    ): ApprovalLink = withContext(Dispatchers.IO) {
        val json = request(
            "POST",
            "/v1/findings/$findingId/approval-link",
            JSONObject()
                .put("operationId", operationId)
                .put("token", token)
                .put("mediaIds", JSONArray(mediaIds)),
        )
        ApprovalLink(
            publicUrl = "$baseUrl${json.getString("publicPath")}",
            expiresAtEpochMs = Instant.parse(json.getString("expiresAt")).toEpochMilli(),
        )
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
            if (state in setOf("VERIFIED", "READY")) return@withContext
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
            if (status !in 200..299) {
                val detail = runCatching {
                    connection.errorStream?.bufferedReader()?.use { it.readText() }
                }.getOrNull()?.replace(Regex("\\s+"), " ")?.take(300)
                throw ApiException(status, "Хранилище отклонило загрузку ($status)${if (detail.isNullOrBlank()) "" else ": $detail"}")
            }
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        authenticated: Boolean = true,
    ): JSONObject = JSONObject(requestText(method, path, body, authenticated))

    private suspend fun requestArray(method: String, path: String): JSONArray =
        JSONArray(requestText(method, path, null, authenticated = true))

    private suspend fun requestText(
        method: String,
        path: String,
        body: JSONObject?,
        authenticated: Boolean,
    ): String {
        if (!authenticated) return requireSuccess(executeRequest(method, path, body, null))

        var session = validAccessSession()
        var response = executeRequest(method, path, body, session.accessToken)
        if (response.status == 401) {
            session = rotateSession(session.accessToken)
            response = executeRequest(method, path, body, session.accessToken)
        }
        return requireSuccess(response, clearSessionOnUnauthorized = true)
    }

    private fun requestWithAccessToken(method: String, path: String, accessToken: String): JSONObject =
        JSONObject(requireSuccess(executeRequest(method, path, null, accessToken)))

    private suspend fun validAccessSession(): AuthSession {
        val current = authStore.session.value ?: throw ApiException(401, "Войдите в систему")
        if (current.refreshTokenExpiresAtEpochMs <= System.currentTimeMillis()) {
            authStore.clear()
            throw ApiException(401, "Сессия истекла")
        }
        return if (current.accessTokenExpiresAtEpochMs > System.currentTimeMillis() + ACCESS_REFRESH_MARGIN_MS) {
            current
        } else {
            rotateSession(current.accessToken)
        }
    }

    private suspend fun rotateSession(rejectedAccessToken: String): AuthSession = refreshMutex.withLock {
        val current = authStore.session.value ?: throw ApiException(401, "Войдите в систему")
        // Другой запрос уже выполнил одноразовую ротацию, пока этот ожидал mutex.
        if (current.accessToken != rejectedAccessToken) return@withLock current
        if (current.refreshTokenExpiresAtEpochMs <= System.currentTimeMillis()) {
            authStore.clear()
            throw ApiException(401, "Сессия истекла")
        }
        val response = executeRequest(
            method = "POST",
            path = "/public/v1/auth/refresh",
            body = JSONObject().put("refreshToken", current.refreshToken),
            accessToken = null,
        )
        val json = JSONObject(requireSuccess(response, clearSessionOnUnauthorized = true))
        val refreshed = current.copy(
            accessToken = json.getString("accessToken"),
            accessTokenExpiresAtEpochMs = json.getLong("accessTokenExpiresAtEpochMs"),
            refreshToken = json.getString("refreshToken"),
            refreshTokenExpiresAtEpochMs = json.getLong("refreshTokenExpiresAtEpochMs"),
        )
        authStore.save(refreshed)
        refreshed
    }

    private data class ApiResponse(val status: Int, val body: String)

    private fun executeRequest(
        method: String,
        path: String,
        body: JSONObject?,
        accessToken: String?,
    ): ApiResponse {
        val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("accept", "application/json")
            if (accessToken != null) connection.setRequestProperty("authorization", "Bearer $accessToken")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            return ApiResponse(status, response)
        } finally {
            connection.disconnect()
        }
    }

    private fun requireSuccess(response: ApiResponse, clearSessionOnUnauthorized: Boolean = false): String {
        if (response.status !in 200..299) {
            if (clearSessionOnUnauthorized && response.status == 401) authStore.clear()
            val code = runCatching { JSONObject(response.body).optString("error") }.getOrNull()
            throw ApiException(
                response.status,
                code?.takeIf(String::isNotBlank) ?: "Ошибка сервера (${response.status})",
            )
        }
        return response.body.ifBlank { "{}" }
    }

    private companion object {
        const val ACCESS_REFRESH_MARGIN_MS = 60_000L
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
