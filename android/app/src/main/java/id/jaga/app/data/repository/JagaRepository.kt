package id.jaga.app.data.repository

import id.jaga.app.data.remote.Incident
import id.jaga.app.data.remote.IotDeviceStatus
import id.jaga.app.data.remote.RescueTeam
import id.jaga.app.data.remote.Resident
import id.jaga.app.data.remote.Session
import id.jaga.app.data.remote.TechnicalTicket
import id.jaga.app.data.remote.PusatPlatform
import id.jaga.app.data.remote.PusatSnapshot
import id.jaga.app.data.remote.JagaApi

/**
 * Single data boundary for screens. It deliberately exposes domain data rather than HTTP
 * details, making a later replacement of the JSON client or offline cache local to this layer.
 */
class JagaRepository(private val api: JagaApi) {
    var token: String?
        get() = api.token
        set(value) { api.token = value }

    suspend fun login(email: String, password: String): Session = api.login(email, password)
    suspend fun incidents(): List<Incident> = api.incidents()
    suspend fun residents(): List<Resident> = api.residents()
    suspend fun tickets(): List<TechnicalTicket> = api.tickets()
    suspend fun teams(): List<RescueTeam> = api.teams()
    suspend fun iotStatus(): IotDeviceStatus = api.iotStatus()
    suspend fun assignTeam(incidentId: String, teamId: String) = api.assignTeam(incidentId, teamId)
    suspend fun updateIncident(id: String, status: String) = api.updateIncident(id, status)
    suspend fun sendVillageAlert(villageId: String, severity: String, message: String, teamId: String? = null) = api.sendVillageAlert(villageId, severity, message, teamId)
    suspend fun setIotAlarm(status: String) = api.setIotAlarm(status)
    suspend fun pusatSnapshot(): PusatSnapshot = api.pusatSnapshot()
    suspend fun resolveTicket(ticketId: String, note: String) = api.resolveTicket(ticketId, note)
    suspend fun savePlatform(platform: PusatPlatform): PusatPlatform = api.savePlatform(platform)
}
