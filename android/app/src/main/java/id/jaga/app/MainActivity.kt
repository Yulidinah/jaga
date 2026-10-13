package id.jaga.app

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val JagaGreen = Color(0xFF123D35)
private val JagaAccent = Color(0xFF1A705B)
private val Danger = Color(0xFFB42318)
private val Warning = Color(0xFFE2700D)
private val BgColor = Color(0xFFF3F5F2)
private val SurfaceColor = Color.White
private val TextMuted = Color(0xFF5B695F)

class JagaViewModelFactory(private val context: Context) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val prefs = context.getSharedPreferences("jaga_session", Context.MODE_PRIVATE)
        @Suppress("UNCHECKED_CAST")
        return JagaViewModel(prefs) as T
    }
}

class JagaViewModel(private val prefs: SharedPreferences) : ViewModel() {
    private val api = JagaApi(BuildConfig.API_BASE)
    var session by mutableStateOf<Session?>(null)
    var incidents by mutableStateOf<List<Incident>>(emptyList())
    var residents by mutableStateOf<List<Resident>>(emptyList())
    var tickets by mutableStateOf<List<TechnicalTicket>>(emptyList())
    var iotStatus by mutableStateOf<IotDeviceStatus?>(null)
    var currentTab by mutableStateOf("UTAMA") // "UTAMA", "WARGA", "KENDALA"
    var message by mutableStateOf("Memeriksa sesi...")
    var busy by mutableStateOf(false)
    private var poller: Job? = null

    val role: String get() = session?.role ?: ""

    init {
        val token = prefs.getString("token", null)
        val name = prefs.getString("name", null)
        val role = prefs.getString("role", null)
        val villageId = prefs.getString("villageId", null)

        if (token != null && name != null && role != null) {
            api.token = token
            session = Session(token, name, role, villageId)
            message = "Sesi aktif: $name ($role)"
            startPolling()
        } else {
            message = "Masuk dengan akun organisasi JAGA"
        }
    }

    fun login(email: String, password: String) = viewModelScope.launch {
        busy = true
        runCatching { api.login(email.trim(), password) }
            .onSuccess {
                session = it
                api.token = it.token
                prefs.edit()
                    .putString("token", it.token)
                    .putString("name", it.displayName)
                    .putString("role", it.role)
                    .putString("villageId", it.villageId)
                    .apply()
                message = "Berhasil masuk sebagai ${it.displayName} (${it.role})"
                startPolling()
            }
            .onFailure { message = it.message ?: "Gagal masuk. Periksa email, sandi, dan koneksi." }
        busy = false
    }

    fun logout() {
        poller?.cancel()
        api.token = null
        session = null
        prefs.edit().clear().apply()
        incidents = emptyList()
        residents = emptyList()
        tickets = emptyList()
        message = "Sesi diakhiri. Silakan masuk kembali."
    }

    private fun startPolling() {
        poller?.cancel()
        poller = viewModelScope.launch {
            var wait = 5_000L
            while (true) {
                val ok = runCatching {
                    incidents = api.incidents()
                    if (role == "DESA" || role == "PUSAT") {
                        residents = api.residents()
                    }
                    if (role == "PUSAT") {
                        tickets = api.tickets()
                    }
                    iotStatus = api.iotStatus()
                }.isSuccess

                message = if (ok) {
                    if (incidents.isEmpty()) "Area aman. Tidak ada panggilan SOS aktif."
                    else "${incidents.size} panggilan darurat / SOS aktif."
                } else {
                    "Koneksi terputus. Mencoba menghubungkan kembali..."
                }

                wait = if (ok) 5_000L else minOf(wait * 2, 30_000L)
                delay(wait)
            }
        }
    }

    fun refresh() = viewModelScope.launch {
        busy = true
        runCatching {
            incidents = api.incidents()
            if (role == "DESA" || role == "PUSAT") residents = api.residents()
            if (role == "PUSAT") tickets = api.tickets()
            iotStatus = api.iotStatus()
            message = "Data berhasil diperbarui."
        }.onFailure {
            message = it.message ?: "Gagal memperbarui data"
        }
        busy = false
    }

    fun triggerIotAlarm(status: String) = viewModelScope.launch {
        busy = true
        runCatching { api.setIotAlarm(status) }
            .onSuccess {
                message = "Status alarm kalung diubah ke $status"
                runCatching { iotStatus = api.iotStatus() }
            }
            .onFailure { message = it.message ?: "Gagal mengirim ke kalung" }
        busy = false
    }

    fun broadcastVillage(severity: String) = viewModelScope.launch {
        val villageId = session?.villageId
        if (villageId == null) {
            message = "Akun ini belum terikat pada desa tertentu"
            return@launch
        }
        busy = true
        val text = when (severity) {
            "AWAS" -> "Awas: Segera evakuasi ke titik kumpul aman!"
            "SIAGA" -> "Siaga: Air mulai naik, persiapkan dokumen dan evakuasi mandiri."
            else -> "Kondisi kembali normal dan terkendali."
        }
        runCatching { api.sendVillageAlert(villageId, severity, text) }
            .onSuccess { message = "Sinyal $severity berhasil disiarkan ke $it kalung warga" }
            .onFailure { message = it.message ?: "Gagal menyiarkan sinyal desa" }
        busy = false
    }

    fun nextStatus(incident: Incident): String? = if (role == "RESCUE") {
        when (incident.status) {
            "NEW", "ACKNOWLEDGED" -> "ASSIGNED"
            "ASSIGNED" -> "EN_ROUTE"
            "EN_ROUTE" -> "ARRIVED"
            "ARRIVED" -> "EVACUATED"
            "EVACUATED" -> "SAFE"
            else -> null
        }
    } else {
        when (incident.status) {
            "NEW" -> "ACKNOWLEDGED"
            "SAFE", "EVACUATED" -> "CLOSED"
            else -> null
        }
    }

    fun advanceIncident(incident: Incident) = viewModelScope.launch {
        val next = nextStatus(incident) ?: return@launch
        busy = true
        runCatching { api.updateIncident(incident.id, next) }
            .onSuccess {
                refresh()
            }
            .onFailure { message = it.message ?: "Gagal memperbarui insiden" }
        busy = false
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = JagaAccent,
                    background = BgColor,
                    surface = SurfaceColor,
                    error = Danger
                )
            ) {
                JagaApp()
            }
        }
    }
}

@Composable
fun JagaApp() {
    val context = LocalContext.current
    val vm: JagaViewModel = viewModel(factory = JagaViewModelFactory(context))

    if (vm.session == null) {
        LoginScreen(vm)
    } else {
        HomeScreen(vm)
    }
}

@Composable
private fun LoginScreen(vm: JagaViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(BgColor), contentAlignment = Alignment.Center) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceColor),
            shape = RoundedCornerShape(24.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 6.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Box(modifier = Modifier.size(56.dp).background(JagaGreen, CircleShape), contentAlignment = Alignment.Center) {
                        Text("J", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Black)
                    }
                    Spacer(Modifier.height(12.dp))
                    Text("JAGA Mobile", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall, color = JagaGreen)
                    Text("Peringatan & Respons Bencana Inklusif", color = TextMuted, fontSize = 13.sp)
                }

                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextField(
                        value = email,
                        onValueChange = { email = it },
                        placeholder = { Text("Email operasional") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(),
                        colors = TextFieldDefaults.colors(
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            focusedContainerColor = BgColor,
                            unfocusedContainerColor = BgColor
                        ),
                        shape = RoundedCornerShape(14.dp)
                    )

                    TextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = { Text("Kata sandi") },
                        singleLine = true,
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            TextButton(onClick = { showPassword = !showPassword }) {
                                Text(if (showPassword) "Tutup" else "Lihat", color = JagaAccent, fontWeight = FontWeight.Bold)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = TextFieldDefaults.colors(
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            focusedContainerColor = BgColor,
                            unfocusedContainerColor = BgColor
                        ),
                        shape = RoundedCornerShape(14.dp)
                    )
                }

                Button(
                    onClick = { vm.login(email, password) },
                    enabled = !vm.busy && email.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = JagaGreen),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Text(if (vm.busy) "Memverifikasi..." else "Masuk", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                }

                if (vm.message.isNotBlank()) {
                    Text(vm.message, color = if (vm.message.startsWith("Berhasil")) JagaAccent else Danger, fontSize = 12.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(vm: JagaViewModel) {
    val roleTitle = when (vm.role) {
        "PUSAT" -> "JAGA Pusat"
        "DESA" -> "JAGA Desa"
        "RESCUE" -> "JAGA Rescue"
        else -> vm.role
    }

    Scaffold(
        topBar = {
            Surface(color = JagaGreen, shadowElevation = 4.dp) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Box(modifier = Modifier.size(36.dp).background(Color.White.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                            Text("J", color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(vm.session?.displayName ?: "Petugas", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Text(roleTitle, color = Color(0xFFD5F27C), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        TextButton(onClick = vm::logout) {
                            Text("Keluar", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }

                    // Tab navigasi native untuk Pusat dan Desa
                    if (vm.role == "PUSAT" || vm.role == "DESA") {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(
                                selected = vm.currentTab == "UTAMA",
                                onClick = { vm.currentTab = "UTAMA" },
                                label = { Text("Operasi / Alarm") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFD5F27C),
                                    selectedLabelColor = Color(0xFF153D28)
                                )
                            )
                            FilterChip(
                                selected = vm.currentTab == "WARGA",
                                onClick = { vm.currentTab = "WARGA" },
                                label = { Text("Data Warga (${vm.residents.size})") },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color(0xFFD5F27C),
                                    selectedLabelColor = Color(0xFF153D28)
                                )
                            )
                            if (vm.role == "PUSAT") {
                                FilterChip(
                                    selected = vm.currentTab == "KENDALA",
                                    onClick = { vm.currentTab = "KENDALA" },
                                    label = { Text("Kendala (${vm.tickets.size})") },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = Color(0xFFD5F27C),
                                        selectedLabelColor = Color(0xFF153D28)
                                    )
                                )
                            }
                        }
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().background(BgColor).padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(vm.message, color = TextMuted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    TextButton(onClick = vm::refresh) {
                        Text("Perbarui", color = JagaAccent, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }

            // --- TAB KENDALA TEKNIS (KHUSUS PUSAT) ---
            if (vm.currentTab == "KENDALA" && vm.role == "PUSAT") {
                items(vm.tickets, key = { it.id }) { ticket ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceColor),
                        shape = RoundedCornerShape(16.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(ticket.title, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = JagaGreen, modifier = Modifier.weight(1f))
                                Text(ticket.status, color = if (ticket.status == "OPEN") Danger else Warning, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                            }
                            Text("Wilayah: ${ticket.villageName ?: "Pusat"} · Kategori: ${ticket.category}", color = TextMuted, fontSize = 12.sp)
                        }
                    }
                }
            }
            // --- TAB DATA WARGA (DESA & PUSAT) ---
            else if (vm.currentTab == "WARGA" && (vm.role == "DESA" || vm.role == "PUSAT")) {
                items(vm.residents, key = { it.id }) { res ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceColor),
                        shape = RoundedCornerShape(16.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier.size(36.dp).background(Color(0xFFE4EFE7), CircleShape),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(res.fullName.take(1).uppercase(), color = JagaGreen, fontWeight = FontWeight.Bold)
                                }
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(res.fullName, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = JagaGreen)
                                    Text("${res.age} th · ${res.gender} · ${res.villageName}", color = TextMuted, fontSize = 12.sp)
                                }
                                res.deviceCode?.let {
                                    Box(modifier = Modifier.background(Color(0xFFE4EFE7), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
                                        Text(it, color = JagaGreen, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                                    }
                                }
                            }
                            HorizontalDivider(color = Color(0xFFF1F6F2))
                            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                Text("Evakuasi: ${res.evacuationAssistance}", color = TextMuted, fontSize = 12.sp)
                                Text("Kondisi: ${res.livingCondition}", color = TextMuted, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
            // --- TAB UTAMA: KONTROL ALARM, STATUS IOT, DAN PRIORITAS SOS ---
            else {
                // Kontrol Alarm Desa
                if (vm.role == "DESA" || vm.role == "PUSAT") {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFFFDECEA)),
                            shape = RoundedCornerShape(18.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF3CBC7))
                        ) {
                            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("Kontrol Alarm & Peringatan Desa", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Danger)
                                Text("Aktifkan sinyal darurat untuk memicu buzzer dan LED kalung seluruh warga di desa.", color = Color(0xFF912219), fontSize = 13.sp)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                    Button(
                                        onClick = { vm.broadcastVillage("SIAGA") },
                                        enabled = !vm.busy,
                                        colors = ButtonDefaults.buttonColors(containerColor = Warning),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text("Kirim SIAGA", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                    }
                                    Button(
                                        onClick = { vm.broadcastVillage("AWAS") },
                                        enabled = !vm.busy,
                                        colors = ButtonDefaults.buttonColors(containerColor = Danger),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text("Kirim AWAS", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }

                // Status Perangkat Kalung Realtime
                item {
                    val iot = vm.iotStatus
                    val isSos = iot?.isSos == true || iot?.statusAlarm == "DARURAT"
                    val isSiaga = iot?.isSiaga == true || iot?.statusAlarm == "SIAGA"
                    val statusColor = if (isSos) Danger else if (isSiaga) Warning else JagaAccent
                    val statusText = iot?.statusAlarm ?: "AMAN"
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfaceColor),
                        shape = RoundedCornerShape(18.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                    ) {
                        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(modifier = Modifier.size(10.dp).background(statusColor, CircleShape))
                                Spacer(Modifier.width(8.dp))
                                Text("Status Kalung IoT (${iot?.deviceId ?: "JAGA-052"})", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = JagaGreen, modifier = Modifier.weight(1f))
                                Box(modifier = Modifier.background(statusColor.copy(alpha = 0.15f), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 4.dp)) {
                                    Text(statusText, color = statusColor, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                                }
                            }
                            Text("Koordinat GPS: ${iot?.latitude ?: 5.54829}, ${iot?.longitude ?: 95.323753}", color = TextMuted, fontSize = 12.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                Button(
                                    onClick = { vm.triggerIotAlarm("DARURAT") },
                                    enabled = !vm.busy,
                                    colors = ButtonDefaults.buttonColors(containerColor = Danger),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Test DARURAT", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                                OutlinedButton(
                                    onClick = { vm.triggerIotAlarm("AMAN") },
                                    enabled = !vm.busy,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Text("Reset AMAN", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = JagaGreen)
                                }
                            }
                        }
                    }
                }

                // Daftar Panggilan SOS / Prioritas Penyelamatan
                items(vm.incidents, key = { it.id }) { incident ->
                    IncidentCard(incident, vm.nextStatus(incident), vm.role, vm::advanceIncident)
                }
            }
        }
    }
}

@Composable
private fun IncidentCard(incident: Incident, next: String?, role: String, onAdvance: (Incident) -> Unit) {
    Card(
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(40.dp).background(Color(0xFFFDECEA), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(incident.ownerName.take(1).uppercase(), color = Danger, fontWeight = FontWeight.Black, fontSize = 16.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(incident.ownerName, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = JagaGreen)
                    Text("Kalung: ${incident.deviceId}", color = TextMuted, fontSize = 12.sp)
                }
                Box(modifier = Modifier.background(Color(0xFFFDECEA), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 4.dp)) {
                    Text(incident.status.replace('_', ' '), color = Danger, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                }
            }
            HorizontalDivider(color = Color(0xFFE4E9E4))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text("KOORDINAT TERAKHIR", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = TextMuted)
                    Text("${incident.latitude}, ${incident.longitude}", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
            if (next != null) {
                Button(
                    onClick = { onAdvance(incident) },
                    colors = ButtonDefaults.buttonColors(containerColor = JagaAccent),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp)
                ) {
                    Text(if (role == "RESCUE") "Proses: ${next.replace('_', ' ')}" else "Tutup Kasus", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
        }
    }
}
