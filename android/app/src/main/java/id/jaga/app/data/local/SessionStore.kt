package id.jaga.app.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Stores only the issued session token using Android Keystore-backed encryption. */
class SessionStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "jaga_secure_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    data class StoredSession(val token: String, val displayName: String, val role: String, val villageId: String?)

    fun read(): StoredSession? {
        val token = preferences.getString(TOKEN, null) ?: return null
        val name = preferences.getString(NAME, null) ?: return null
        val role = preferences.getString(ROLE, null) ?: return null
        return StoredSession(token, name, role, preferences.getString(VILLAGE, null))
    }

    fun save(token: String, displayName: String, role: String, villageId: String?) = preferences.edit()
        .putString(TOKEN, token).putString(NAME, displayName)
        .putString(ROLE, role).putString(VILLAGE, villageId).apply()

    fun clear() = preferences.edit().clear().apply()

    private companion object { const val TOKEN = "token"; const val NAME = "name"; const val ROLE = "role"; const val VILLAGE = "village" }
}
