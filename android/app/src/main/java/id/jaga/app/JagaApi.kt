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

data class Resident(
    val id: String,
    val fullName: String,
    val age: Int,
    val gender: String,
    val evacuationAssistance: String,
    val livingCondition: String,
    val deviceCode: String?,
    val villageName: String?
)

data class TechnicalTicket(
    val id: String,
    val title: String,
    val category: String,
    val status: String,
    val villageName: String?,
    val createdAt: String
)

data class RescueTeam(
    val id: String,
    val name: String,
    val callSign: String,
    val status: String,
    val vehicleInfo: String?
)

data class IotDeviceStatus(
    val deviceId: String,
    val statusAlarm: String,
    val isSos: Boolean,
    val isSiaga: Boolean,
    val isAman: Boolean,
    val latitude: Double,
    val longitude: Double,
    val online: Boolean
)

data class Session(
    val token: String,
    val displayName: String,
    val role: String,
    val villageId: String?
)

/** Klien HTTP Native yang terhubung langsung ke backend JAGA. */
class JagaApi(var baseUrl: String = BuildConfig.API_BASE) {
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

    suspend fun teams(): List<RescueTeam> = withContext(Dispatchers.IO) {
        val connection = open("/teams", "GET")
        val data = JSONObject(read(connection)).get("data")
        val payload: JSONArray = if (data is JSONArray) data else (data as JSONObject).getJSONArray("data")
        (0 until payload.length()).map {
            val obj = payload.getJSONObject(it)
            RescueTeam(
                id = obj.getString("id"),
                name = obj.getString("name"),
                callSign = obj.optString("callSign", "-"),
                status = obj.optString("status", "AVAILABLE"),
                vehicleInfo = obj.optString("vehicleInfo", null)
            )
        }
    }

    suspend fun assignTeam(incidentId: String, teamId: String): Unit = withContext(Dispatchers.IO) {
        val connection = open("/incidents/$incidentId/assignments", "POST")
        connection.outputStream.bufferedWriter().use {
            it.write(JSONObject().put("teamId", teamId).put("force", true).toString())
        }
        read(connection)
        Unit
    }

    suspend fun residents(): List<Resident> = withContext(Dispatchers.IO) {
        val connection = open("/residents?limit=200", "GET")
        val data = JSONObject(read(connection)).get("data")
        val payload: JSONArray = if (data is JSONArray) data else (data as JSONObject).getJSONArray("data")
        (0 until payload.length()).map {
            val obj = payload.getJSONObject(it)
            Resident(
                id = obj.getString("id"),
                fullName = obj.getString("fullName"),
                age = obj.optInt("age", 0),
                gender = obj.optString("gender", "-"),
                evacuationAssistance = obj.optString("evacuationAssistance", "INDEPENDENT"),
                livingCondition = obj.optString("livingCondition", "ALONE"),
                deviceCode = obj.optString("deviceCode", null).takeIf { c -> !c.isNullOrBlank() && c != "null" },
                villageName = obj.optString("villageName", "Desa")
            )
        }
    }

    suspend fun tickets(): List<TechnicalTicket> = withContext(Dispatchers.IO) {
        val connection = open("/tickets?limit=100", "GET")
        val data = JSONObject(read(connection)).get("data")
        val payload: JSONArray = if (data is JSONArray) data else (data as JSONObject).getJSONArray("data")
        (0 until payload.length()).map {
            val obj = payload.getJSONObject(it)
            TechnicalTicket(
                id = obj.getString("id"),
                title = obj.getString("title"),
                category = obj.optString("category", "DEVICE"),
                status = obj.optString("status", "OPEN"),
                villageName = obj.optString("villageName", "Desa"),
                createdAt = obj.optString("createdAt", "")
            )
        }
    }

    suspend fun createResident(
        fullName: String,
        age: Int,
        gender: String,
        villageId: String,
        evacuationAssistance: String,
        livingCondition: String
    ): Unit = withContext(Dispatchers.IO) {
        val connection = open("/residents", "POST")
        connection.outputStream.bufferedWriter().use {
            it.write(
                JSONObject()
                    .put("fullName", fullName)
                    .put("age", age)
                    .put("gender", gender)
                    .put("villageId", villageId)
                    .put("evacuationAssistance", evacuationAssistance)
                    .put("livingCondition", livingCondition)
                    .toString()
            )
        }
        read(connection)
        Unit
    }

    suspend fun updateIncident(id: String, status: String) = withContext(Dispatchers.IO) {
        val connection = open("/incidents/$id/status", "PATCH")
        connection.outputStream.bufferedWriter().use { it.write(JSONObject().put("status", status).toString()) }
        read(connection)
        Unit
    }

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

    suspend fun iotStatus(): IotDeviceStatus = withContext(Dispatchers.IO) {
        val connection = open("/iot/status", "GET")
        val json = JSONObject(read(connection))
        val data = json.optJSONObject("data") ?: JSONObject()
        IotDeviceStatus(
            deviceId = json.optString("deviceId", "JAGA-052"),
            statusAlarm = data.optString("status_alarm", "AMAN"),
            isSos = data.optBoolean("sos", false),
            isSiaga = data.optBoolean("siaga", false),
            isAman = data.optBoolean("aman", true),
            latitude = data.optDouble("lat", 5.54829),
            longitude = data.optDouble("lng", 95.323753),
            online = json.optBoolean("success", true)
        )
    }

    suspend fun setIotAlarm(status: String) = withContext(Dispatchers.IO) {
        val connection = open("/iot/alarm", "POST")
        connection.outputStream.bufferedWriter().use {
            it.write(JSONObject().put("status", status).toString())
        }
        read(connection)
        Unit
    }

    private fun open(path: String, method: String): HttpURLConnection =
        (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 12_000
            setRequestProperty("Content-Type", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            doOutput = method == "POST" || method == "PATCH" || method == "PUT"
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
