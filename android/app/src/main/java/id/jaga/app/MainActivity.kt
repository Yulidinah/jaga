package id.jaga.app

import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
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
    private val api = JagaApi()
    var session by mutableStateOf<Session?>(null)
    var incidents by mutableStateOf<List<Incident>>(emptyList())
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
            message = "Melanjutkan sesi aktif..."
            startPolling()
        } else {
            message = "Masuk untuk melihat panggilan SOS"
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
                message = "Berhasil masuk. Menghubungkan..."
                startPolling() 
            }
            .onFailure { message = it.message ?: "Gagal masuk. Periksa sandi dan koneksi." }
        busy = false
    }

    fun logout() {
        poller?.cancel()
        api.token = null
        session = null
        prefs.edit().clear().apply()
        incidents = emptyList()
        message = "Sesi diakhiri. Silakan masuk kembali."
    }

    private fun startPolling() {
        poller?.cancel()
        poller = viewModelScope.launch {
            var wait = 5_000L
            while (true) {
                val ok = runCatching { api.incidents() }
                    .onSuccess { 
                        incidents = it
                        message = if (it.isEmpty()) "Area aman. Tidak ada SOS." else "${it.size} panggilan darurat terpantau." 
                    }
                    .onFailure { message = "Koneksi terputus: ${it.message}" }
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
            .onSuccess { message = "Sinyal Siaga dikirim ke $it kalung" }
            .onFailure { message = it.message ?: "Gagal mengirim peringatan" }
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
            modifier = Modifier.fillMaxWidth().padding(32.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceColor),
            shape = RoundedCornerShape(28.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Box(modifier = Modifier.size(64.dp).background(JagaGreen, CircleShape), contentAlignment = Alignment.Center) {
                        Text("J", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Black)
                    }
                    Spacer(Modifier.height(16.dp))
                    Text("Masuk ke JAGA", fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall, color = JagaGreen)
                    Text("Sistem Respons Bencana", color = TextMuted, style = MaterialTheme.typography.bodyMedium)
                }

                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
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
                        shape = RoundedCornerShape(16.dp)
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
                        shape = RoundedCornerShape(16.dp)
                    )
                }

                Button(
                    onClick = { vm.login(email, password) }, 
                    enabled = !vm.busy && email.isNotBlank() && password.isNotBlank(), 
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = JagaGreen),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Text(if (vm.busy) "Memverifikasi..." else "Masuk", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
                
                if (vm.message.isNotBlank() && vm.message != "Masuk untuk melihat panggilan SOS" && vm.message != "Memeriksa sesi...") {
                    Text(vm.message, color = Danger, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(vm: JagaViewModel) {
    val canAlert = vm.role == "DESA" || vm.role == "PUSAT"
    Scaffold(
        topBar = {
            Surface(color = JagaGreen, shadowElevation = 4.dp) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(40.dp).background(Color.White.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                        Text("J", color = Color.White, fontWeight = FontWeight.Black, fontSize = 20.sp)
                    }
                    Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(vm.session?.displayName ?: "Petugas", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(if (vm.role == "RESCUE") "Tim Penyelamat" else "Pusat Kendali", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp)
                    }
                    TextButton(onClick = vm::logout) { Text("Keluar", color = Color.White, fontWeight = FontWeight.Bold) }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().background(BgColor).padding(padding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Text(vm.message, color = TextMuted, fontWeight = FontWeight.Medium, fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp))
            }
            if (canAlert) item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFDECEA)), 
                    shape = RoundedCornerShape(20.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFF3CBC7))
                ) {
                    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Peringatan Darurat Desa", fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = Danger)
                        Text("Perhatian: Hanya bunyikan alarm ini jika evakuasi benar-benar harus segera dilakukan.", color = Color(0xFF912219), fontSize = 14.sp)
                        Button(
                            onClick = vm::broadcast, 
                            enabled = !vm.busy, 
                            colors = ButtonDefaults.buttonColors(containerColor = Danger),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                        ) {
                            Text(if (vm.busy) "Memproses..." else "Kirim Sinyal Siaga ke Kalung", fontWeight = FontWeight.Bold)
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
    Card(
        shape = RoundedCornerShape(20.dp), 
        colors = CardDefaults.cardColors(containerColor = SurfaceColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(44.dp).background(Color(0xFFFDECEA), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(incident.ownerName.take(1).uppercase(), color = Danger, fontWeight = FontWeight.Black, fontSize = 18.sp)
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(incident.ownerName, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp, color = JagaGreen)
                    Text("Perangkat: ${incident.deviceId}", color = TextMuted, fontSize = 13.sp)
                }
                Box(modifier = Modifier.background(Color(0xFFFDECEA), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                    Text(incident.status.replace('_', ' '), color = Danger, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                }
            }
            Divider(color = Color(0xFFE4E9E4))
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text("LOKASI", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = TextMuted)
                    Text("${incident.latitude}, ${incident.longitude}", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
            }
            if (next != null) {
                Button(
                    onClick = { onAdvance(incident) }, 
                    colors = ButtonDefaults.buttonColors(containerColor = JagaAccent),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                ) {
                    Text(if (role == "RESCUE") "Ubah Status: ${next.replace('_', ' ')}" else "Tutup Kasus", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
