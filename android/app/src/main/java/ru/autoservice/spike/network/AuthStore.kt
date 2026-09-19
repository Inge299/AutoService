package ru.autoservice.spike.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AuthSession(
    val accessToken: String,
    val accessTokenExpiresAtEpochMs: Long,
    val refreshToken: String,
    val refreshTokenExpiresAtEpochMs: Long,
    val userId: String,
    val workshopId: String,
    val displayName: String,
    val role: String,
)

class AuthStore(context: Context) {
    val refreshMutex = kotlinx.coroutines.sync.Mutex()
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val mutableSession = MutableStateFlow(readSession())

    val session: StateFlow<AuthSession?> = mutableSession

    @Synchronized
    fun save(session: AuthSession) {
        val payload = JSONObject()
            .put("accessToken", session.accessToken)
            .put("accessTokenExpiresAtEpochMs", session.accessTokenExpiresAtEpochMs)
            .put("refreshToken", session.refreshToken)
            .put("refreshTokenExpiresAtEpochMs", session.refreshTokenExpiresAtEpochMs)
            .put("userId", session.userId)
            .put("workshopId", session.workshopId)
            .put("displayName", session.displayName)
            .put("role", session.role)
            .toString()
            .toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        }
        val encrypted = cipher.doFinal(payload)
        val persisted = preferences.edit()
            .clear()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(KEY_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .commit()
        check(persisted) { "Не удалось безопасно сохранить сессию" }
        mutableSession.value = session
    }

    @Synchronized
    fun clear() {
        preferences.edit { clear() }
        mutableSession.value = null
    }

    private fun readSession(): AuthSession? {
        // Старые версии сохраняли access token открытым. Не мигрируем секрет из plaintext.
        val iv = preferences.getString(KEY_IV, null)
        val ciphertext = preferences.getString(KEY_CIPHERTEXT, null)
        if (iv == null || ciphertext == null) {
            if (preferences.all.isNotEmpty()) preferences.edit { clear() }
            return null
        }
        val session = runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateKey(),
                    GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
                )
            }
            val json = JSONObject(
                cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)).toString(Charsets.UTF_8),
            )
            AuthSession(
                accessToken = json.getString("accessToken"),
                accessTokenExpiresAtEpochMs = json.getLong("accessTokenExpiresAtEpochMs"),
                refreshToken = json.getString("refreshToken"),
                refreshTokenExpiresAtEpochMs = json.getLong("refreshTokenExpiresAtEpochMs"),
                userId = json.getString("userId"),
                workshopId = json.getString("workshopId"),
                displayName = json.getString("displayName"),
                role = json.getString("role"),
            )
        }.getOrNull()
        if (session == null || session.refreshTokenExpiresAtEpochMs <= System.currentTimeMillis()) {
            preferences.edit { clear() }
            return null
        }
        return session
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val PREFERENCES_NAME = "autoservice-auth"
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "autoservice-session-v2"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_IV = "session_iv"
        const val KEY_CIPHERTEXT = "session_ciphertext"
    }
}
