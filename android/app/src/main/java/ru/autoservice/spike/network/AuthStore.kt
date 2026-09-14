package ru.autoservice.spike.network

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class AuthSession(
    val accessToken: String,
    val userId: String,
    val workshopId: String,
    val displayName: String,
    val role: String,
    val expiresAtEpochMs: Long,
)

class AuthStore(context: Context) {
    private val preferences = context.getSharedPreferences("autoservice-auth", Context.MODE_PRIVATE)
    private val mutableSession = MutableStateFlow(readSession())

    val session: StateFlow<AuthSession?> = mutableSession

    fun save(session: AuthSession) {
        preferences.edit()
            .putString("accessToken", session.accessToken)
            .putString("userId", session.userId)
            .putString("workshopId", session.workshopId)
            .putString("displayName", session.displayName)
            .putString("role", session.role)
            .putLong("expiresAtEpochMs", session.expiresAtEpochMs)
            .apply()
        mutableSession.value = session
    }

    fun clear() {
        preferences.edit().clear().apply()
        mutableSession.value = null
    }

    private fun readSession(): AuthSession? {
        val token = preferences.getString("accessToken", null) ?: return null
        val expiresAt = preferences.getLong("expiresAtEpochMs", 0L)
        if (expiresAt <= System.currentTimeMillis()) {
            preferences.edit().clear().apply()
            return null
        }
        return AuthSession(
            accessToken = token,
            userId = preferences.getString("userId", null) ?: return null,
            workshopId = preferences.getString("workshopId", null) ?: return null,
            displayName = preferences.getString("displayName", "") ?: "",
            role = preferences.getString("role", "EMPLOYEE") ?: "EMPLOYEE",
            expiresAtEpochMs = expiresAt,
        )
    }
}
