package id.jaga.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val JagaGreen = Color(0xFF123D35)
private val JagaAccent = Color(0xFF1A705B)
private val Danger = Color(0xFFB42318)

class JagaViewModel : ViewModel() {
    private val api = JagaApi()
    var role by mutableStateOf("RESCUE")
    var incidents by mutableStateOf<List<Incident>>(emptyList())
    var message by mutableStateOf("Menghubungkan ke pusat JAGA…")
    var busy by mutableStateOf(false)

    init { viewModelScope.launch { while (true) { refresh(); delay(5_000) } } }

    fun refresh() = viewModelScope.launch {
        runCatching { api.incidents() }
            .onSuccess { incidents = it; message = if (it.isEmpty()) "Belum ada panggilan SOS" else "${it.size} panggilan terpantau" }
            .onFailure { message = "Backend belum terhubung: ${it.message}" }
    }

    fun advance(incident: Incident) = viewModelScope.launch {
        val next = when (incident.status) {
            "NEW" -> "ACKNOWLEDGED"; "ACKNOWLEDGED" -> "EN_ROUTE"; "EN_ROUTE" -> "ARRIVED"
            "ARRIVED" -> "EVACUATED"; else -> "CLOSED"
        }
        runCatching { api.updateIncident(incident.id, next, role) }
            .onSuccess { refresh() }.onFailure { message = it.message ?: "Gagal memperbarui" }
    }

    fun broadcast() = viewModelScope.launch {
        busy = true
        runCatching { api.sendVillageAlert("SIAGA") }
            .onSuccess { message = "Peringatan Siaga dikirim ke $it kalung" }
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
    Scaffold(
        topBar = {
            Surface(color = JagaGreen) {
                Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("JAGA", color = Color.White, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall)
                        Text(if (vm.role == "DESA") "Pusat kendali desa" else "Operasi penyelamatan", color = Color(0xFFD7E8E2))
                    }
                    TextButton(onClick = { vm.role = if (vm.role == "DESA") "RESCUE" else "DESA" }) {
                        Text(vm.role, color = Color.White)
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().background(Color(0xFFF4F7F5)).padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Text(if (vm.role == "DESA") "Kesiapsiagaan desa" else "Panggilan prioritas", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(vm.message, color = Color(0xFF586760))
            }
            if (vm.role == "DESA") item {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFE9E7)), shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Peringatan seluruh kalung", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                        Text("Hanya operator JAGA Desa yang dapat menjalankan tindakan ini.")
                        Button(onClick = vm::broadcast, enabled = !vm.busy, colors = ButtonDefaults.buttonColors(containerColor = Danger)) {
                            Text(if (vm.busy) "Mengirim…" else "Kirim sinyal Siaga")
                        }
                    }
                }
            }
            items(vm.incidents, key = { it.id }) { incident -> IncidentCard(incident, vm.role, vm::advance) }
        }
    }
}

@Composable
private fun IncidentCard(incident: Incident, role: String, onAdvance: (Incident) -> Unit) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(incident.ownerName, Modifier.weight(1f), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text(incident.status.replace('_', ' '), color = Danger, fontWeight = FontWeight.Bold)
            }
            Text("Perangkat ${incident.deviceId}")
            Text("${incident.latitude}, ${incident.longitude}", color = Color(0xFF586760))
            if (role == "RESCUE" || role == "DESA") Button(onClick = { onAdvance(incident) }) {
                Text(if (role == "RESCUE") "Perbarui status penanganan" else "Konfirmasi kejadian")
            }
        }
    }
}
