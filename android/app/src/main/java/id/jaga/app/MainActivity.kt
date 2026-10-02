package id.jaga.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val JagaGreen = Color(0xFF123D35)
private val JagaAccent = Color(0xFF1A705B)
private val Danger = Color(0xFFB42318)

class JagaViewModel : ViewModel() {
    private val api = JagaApi()
    var session by mutableStateOf<Session?>(null)
    var incidents by mutableStateOf<List<Incident>>(emptyList())
    var message by mutableStateOf("Masuk untuk melihat panggilan SOS")
    var busy by mutableStateOf(false)
    private var poller: Job? = null

    /** Peran berasal dari server (akun yang masuk), bukan pilihan di layar. */
    val role: String get() = session?.role ?: ""

    fun login(email: String, password: String) = viewModelScope.launch {
        busy = true
        runCatching { api.login(email.trim(), password) }
            .onSuccess { session = it; message = "Menghubungkan ke pusat JAGA…"; startPolling() }
            .onFailure { message = it.message ?: "Gagal masuk" }
        busy = false
    }

    fun logout() {
        poller?.cancel()
        api.token = null
        session = null
        incidents = emptyList()
        message = "Masuk untuk melihat panggilan SOS"
    }

    /** Polling hanya berjalan selama sudah masuk, dengan jeda yang membesar saat gagal. */
    private fun startPolling() {
        poller?.cancel()
        poller = viewModelScope.launch {
            var wait = 5_000L
            while (true) {
                val ok = runCatching { api.incidents() }
                    .onSuccess { incidents = it; message = if (it.isEmpty()) "Belum ada panggilan SOS" else "${it.size} panggilan terpantau" }
                    .onFailure { message = "Backend belum terhubung: ${it.message}" }
                    .isSuccess
                wait = if (ok) 5_000L else minOf(wait * 2, 60_000L)
                delay(wait)
            }
        }
    }

    fun refresh() = viewModelScope.launch {
        runCatching { api.incidents() }.onSuccess { incidents = it }.onFailure { message = it.message ?: "Gagal memuat" }
    }

    fun nextStatus(incident: Incident): String? = if (role == "RESCUE") {
        when (incident.status) {
            "NEW", "ACKNOWLEDGED" -> "ASSIGNED"; "ASSIGNED" -> "EN_ROUTE"; "EN_ROUTE" -> "ARRIVED"
            "ARRIVED" -> "EVACUATED"; "EVACUATED" -> "SAFE"; else -> null
        }
    } else {
        when (incident.status) {
            "NEW" -> "ACKNOWLEDGED"; "SAFE", "EVACUATED" -> "CLOSED"; else -> null
        }
    }

    fun advance(incident: Incident) = viewModelScope.launch {
        val next = nextStatus(incident) ?: return@launch
        runCatching { api.updateIncident(incident.id, next) }
            .onSuccess { refresh() }.onFailure { message = it.message ?: "Gagal memperbarui" }
    }

    fun broadcast() = viewModelScope.launch {
        val villageId = session?.villageId
        if (villageId == null) { message = "Akun ini belum terikat pada desa"; return@launch }
        busy = true
        runCatching { api.sendVillageAlert(villageId, "SIAGA", "Siaga: bersiap evakuasi dan hubungi pendamping Anda.") }
            .onSuccess { message = "Peringatan Siaga masuk antrean untuk $it kalung" }
            .onFailure { message = it.message ?: "Peringatan gagal dikirim" }
        busy = false
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = lightColorScheme(primary = JagaAccent, error = Danger)) { JagaApp() } }
    }
}

@Composable
fun JagaApp(vm: JagaViewModel = viewModel()) {
    if (vm.session == null) LoginScreen(vm) else HomeScreen(vm)
}

@Composable
private fun LoginScreen(vm: JagaViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().background(Color(0xFFF4F7F5)).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)
    ) {
        Text("JAGA", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineLarge, color = JagaGreen)
        Text("Masuk dengan akun organisasi Anda", color = Color(0xFF586760))
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Kata sandi") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Button(onClick = { vm.login(email, password) }, enabled = !vm.busy && email.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text(if (vm.busy) "Memverifikasi…" else "Masuk")
        }
        Text(vm.message, color = Color(0xFF586760))
    }
}

@Composable
private fun HomeScreen(vm: JagaViewModel) {
    val canAlert = vm.role == "DESA" || vm.role == "PUSAT"
    Scaffold(
        topBar = {
            Surface(color = JagaGreen) {
                Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("JAGA", color = Color.White, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall)
                        Text(
                            "${vm.session?.displayName} · " + if (vm.role == "RESCUE") "Operasi penyelamatan" else "Pusat kendali",
                            color = Color(0xFFD7E8E2)
                        )
                    }
                    TextButton(onClick = vm::logout) { Text("Keluar", color = Color.White) }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().background(Color(0xFFF4F7F5)).padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Text(if (canAlert) "Kesiapsiagaan desa" else "Panggilan prioritas", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(vm.message, color = Color(0xFF586760))
            }
            if (canAlert) item {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFE9E7)), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Peringatan seluruh kalung", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                        Text("Hanya operator JAGA Desa atau Pusat yang dapat menjalankan tindakan ini. Pastikan kondisi sudah diverifikasi.")
                        Button(onClick = vm::broadcast, enabled = !vm.busy, colors = ButtonDefaults.buttonColors(containerColor = Danger)) {
                            Text(if (vm.busy) "Mengirim…" else "Kirim sinyal Siaga")
                        }
                    }
                }
            }
            items(vm.incidents, key = { it.id }) { incident -> IncidentCard(incident, vm.nextStatus(incident), vm.role, vm::advance) }
        }
    }
}

@Composable
private fun IncidentCard(incident: Incident, next: String?, role: String, onAdvance: (Incident) -> Unit) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(incident.ownerName, Modifier.weight(1f), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text(incident.status.replace('_', ' '), color = Danger, fontWeight = FontWeight.Bold)
            }
            Text("Perangkat ${incident.deviceId}")
            Text("${incident.latitude}, ${incident.longitude}", color = Color(0xFF586760))
            if (next != null) Button(onClick = { onAdvance(incident) }) {
                Text(if (role == "RESCUE") "Perbarui status: ${next.replace('_', ' ')}" else "Konfirmasi / tutup kejadian")
            }
        }
    }
}
