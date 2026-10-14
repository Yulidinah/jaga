package id.jaga.app.data.model

data class ApiSession(val token: String, val displayName: String, val role: String, val villageId: String?)
data class ApiIncident(val id: String, val deviceId: String, val ownerName: String, val latitude: Double, val longitude: Double, val status: String, val createdAt: String)
data class ApiResident(val id: String, val fullName: String, val age: Int, val gender: String, val evacuationAssistance: String, val livingCondition: String, val deviceCode: String?, val villageName: String?)
data class ApiTicket(val id: String, val title: String, val category: String, val status: String, val villageName: String?, val createdAt: String)
data class ApiRescueTeam(val id: String, val name: String, val callSign: String, val status: String)
data class ApiIotStatus(val deviceId: String, val statusAlarm: String, val isSos: Boolean, val isSiaga: Boolean, val latitude: Double, val longitude: Double, val online: Boolean)
