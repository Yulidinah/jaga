package id.jaga.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val JagaGreen = Color(0xFF123D35)
val JagaAccent = Color(0xFF1A705B)
val JagaDanger = Color(0xFFB42318)
val JagaWarning = Color(0xFFE2700D)
val JagaBackground = Color(0xFFF3F5F2)
val JagaSurface = Color.White
val JagaMuted = Color(0xFF5B695F)

@Composable
fun JagaTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = lightColorScheme(primary = JagaAccent, onPrimary = Color.White, background = JagaBackground, surface = JagaSurface, error = JagaDanger),
    content = content
)
