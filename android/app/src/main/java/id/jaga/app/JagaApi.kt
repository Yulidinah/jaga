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

class JagaApi(private val baseUrl: String = "http://10.0.2.2:3000/api") {
    suspend fun incidents(): List<Incident> = withContext(Dispatchers.IO) {
        val connection = open("/incidents", "GET")
        val payload = JSONObject(read(connection)).getJSONArray("data")
        (0 until payload.length()).map { payload.getJSONObject(it).toIncident() }
    }

    suspend fun updateIncident(id: String, status: String, role: String): Incident = withContext(Dispatchers.IO) {
        val connection = open("/incidents/$id", "PATCH", role)
        connection.outputStream.bufferedWriter().use { it.write(JSONObject().put("status", status).toString()) }
        JSONObject(read(connection)).getJSONObject("data").toIncident()
    }

    suspend fun sendVillageAlert(severity: String): Int = withContext(Dispatchers.IO) {
        val connection = open("/alerts", "POST", "DESA")
        connection.outputStream.bufferedWriter().use {
            it.write(JSONObject().put("severity", severity).put("target", "ALL").toString())
        }
        JSONObject(read(connection)).getInt("targetedDevices")
    }

    private fun open(path: String, method: String, role: String? = null): HttpURLConnection =
        (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = 5_000
            setRequestProperty("Content-Type", "application/json")
            role?.let { setRequestProperty("X-JAGA-Role", it) }
            doOutput = method != "GET"
        }

    private fun read(connection: HttpURLConnection): String {
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val body = stream.bufferedReader().use { it.readText() }
        if (connection.responseCode !in 200..299) throw IllegalStateException(JSONObject(body).optString("error", "Permintaan gagal"))
        return body
    }

    private fun JSONObject.toIncident() = Incident(
        getString("id"), getString("deviceId"), getString("ownerName"),
        getDouble("latitude"), getDouble("longitude"), getString("status"), getString("createdAt")
    )
}
