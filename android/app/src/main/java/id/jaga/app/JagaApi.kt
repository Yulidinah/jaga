package id.jaga.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class Incident(
    val id: String,
    val deviceId: String,
    val ownerName: String,
    val latitude: Double,
    val longitude: Double,
    val status: String,
    val createdAt: String
)

data class Session(
    val token: String,
    val displayName: String,
    val role: String,
    val villageId: String?
)

/** Semua respons backend dibungkus {"data": ...}; daftar berpaginasi berbentuk {"data": {"data": [...]}}. */
class JagaApi(private val baseUrl: String = BuildConfig.API_BASE) {
    var token: String? = null

    suspend fun login(email: String, password: String): Session = withContext(Dispatchers.IO) {
        val connection = open("/auth/login", "POST")
        connection.outputStream.bufferedWriter().use {
            it.write(JSONObject().put("email", email).put("password", password).toString())
        }
        val data = JSONObject(read(connection)).getJSONObject("data")
        val session = data.getJSONObject("session")
        val villages = session.optJSONArray("villageIds")
        token = data.getString("token")
        Session(
            token = data.getString("token"),
            displayName = session.optString("displayName", "Petugas"),
            role = session.getString("role"),
            villageId = if (villages != null && villages.length() > 0) villages.getString(0) else null
        )
    }

    suspend fun incidents(): List<Incident> = withContext(Dispatchers.IO) {
        val connection = open("/incidents?limit=200", "GET")
        val data = JSONObject(read(connection)).get("data")
        val payload: JSONArray = if (data is JSONArray) data else (data as JSONObject).getJSONArray("data")
        (0 until payload.length()).map { payload.getJSONObject(it).toIncident() }
    }

    suspend fun updateIncident(id: String, status: String) = withContext(Dispatchers.IO) {
        val connection = open("/incidents/$id/status", "PATCH")
        connection.outputStream.bufferedWriter().use { it.write(JSONObject().put("status", status).toString()) }
        read(connection)
        Unit
    }

    /** Mengembalikan jumlah perangkat yang menerima perintah (devicesReached). */
    suspend fun sendVillageAlert(villageId: String, severity: String, message: String): Int = withContext(Dispatchers.IO) {
        val connection = open("/alerts", "POST")
        connection.outputStream.bufferedWriter().use {
            it.write(
                JSONObject()
                    .put("villageId", villageId)
                    .put("targetType", "DESA")
                    .put("severity", severity)
                    .put("message", message)
                    .toString()
            )
        }
        JSONObject(read(connection)).getJSONObject("data").getInt("devicesReached")
    }

    private fun open(path: String, method: String): HttpURLConnection =
        (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = 8_000
            setRequestProperty("Content-Type", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            doOutput = method == "POST" || method == "PATCH"
        }

    private fun read(connection: HttpURLConnection): String {
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (code !in 200..299) {
            val message = runCatching { JSONObject(body).optString("error", "") }.getOrDefault("")
            throw IllegalStateException(message.ifBlank { "Permintaan gagal ($code)" })
        }
        return body
    }

    private fun JSONObject.toIncident() = Incident(
        id = getString("id"),
        deviceId = if (isNull("deviceId")) "-" else getString("deviceId"),
        ownerName = optString("ownerName", "Tidak diketahui"),
        latitude = optDouble("latitude", 0.0),
        longitude = optDouble("longitude", 0.0),
        status = getString("status"),
        createdAt = optString("createdAt", "")
    )
}
