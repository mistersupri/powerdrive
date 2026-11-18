package app.superdrive.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** The same colours as the website (index.css), so both interfaces look like one product. */
private val Light = lightColorScheme(
    primary = Color(0xFF1769E8), onPrimary = Color.White, primaryContainer = Color(0xFFEAF2FF), onPrimaryContainer = Color(0xFF1769E8),
    background = Color(0xFFF7F8FA), onBackground = Color(0xFF172B4D), surface = Color.White, onSurface = Color(0xFF172B4D),
    surfaceVariant = Color(0xFFF1F4F8), onSurfaceVariant = Color(0xFF4B5B74), outline = Color(0xFFD3DBE6), outlineVariant = Color(0xFFE6EBF2),
    error = Color(0xFFDC2F2F), onError = Color.White, errorContainer = Color(0xFFFEECEB), onErrorContainer = Color(0xFFB42318),
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFF1F4F8),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF5B9BFF), onPrimary = Color(0xFF06142B), primaryContainer = Color(0xFF1C3358), onPrimaryContainer = Color(0xFF9EC5FF),
    background = Color(0xFF0B1424), onBackground = Color(0xFFE8EEF8), surface = Color(0xFF111B2E), onSurface = Color(0xFFE8EEF8),
    surfaceVariant = Color(0xFF17243B), onSurfaceVariant = Color(0xFFB1BFD4), outline = Color(0xFF2B3A55), outlineVariant = Color(0xFF223049),
    error = Color(0xFFFF8A80), onError = Color(0xFF3B0A06), errorContainer = Color(0xFF34120F), onErrorContainer = Color(0xFFFFB4AB),
    surfaceContainer = Color(0xFF111B2E), surfaceContainerHigh = Color(0xFF17243B),
)

private val Shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(16.dp), extraLarge = RoundedCornerShape(24.dp))

/** The motion curves of the website: a strong ease-out and the drawer curve. */
object Motion {
    val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
    val Drawer = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
}

@Composable
fun SuperDriveTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, shapes = Shapes, content = content)
}
