package app.superdrive.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.superdrive.R

/** The website's design tokens (index.css), one for one, so the app and the site read as the same product. */
class SdColors(
    val canvas: Color, val surface: Color, val surface2: Color, val line: Color, val lineStrong: Color,
    val ink: Color, val muted: Color, val faint: Color,
    val primary: Color, val primaryInk: Color, val primarySoft: Color, val navy: Color, val navyDeep: Color,
    val okInk: Color, val okSoft: Color, val warnInk: Color, val warnSoft: Color,
    val dangerInk: Color, val dangerSoft: Color, val violetInk: Color, val violetSoft: Color,
    val dark: Boolean,
)

private val LightSd = SdColors(
    canvas = Color(0xFFF7F8FA), surface = Color.White, surface2 = Color(0xFFF1F4F8), line = Color(0xFFE5EAF0), lineStrong = Color(0xFFD3DBE6),
    ink = Color(0xFF172B4D), muted = Color(0xFF4B5B74), faint = Color(0xFF607087),
    primary = Color(0xFF1769E8), primaryInk = Color(0xFF1769E8), primarySoft = Color(0xFFEAF2FF), navy = Color(0xFF102C54), navyDeep = Color(0xFF0A1D3A),
    okInk = Color(0xFF047857), okSoft = Color(0xFFE7F8F0), warnInk = Color(0xFFA65A05), warnSoft = Color(0xFFFFF5E0),
    dangerInk = Color(0xFFB42318), dangerSoft = Color(0xFFFEECEB), violetInk = Color(0xFF6D4BD1), violetSoft = Color(0xFFF1EDFF), dark = false,
)
private val DarkSd = SdColors(
    canvas = Color(0xFF0A1220), surface = Color(0xFF111B2E), surface2 = Color(0xFF17243B), line = Color(0xFF223049), lineStrong = Color(0xFF2F4262),
    ink = Color(0xFFE8EEF8), muted = Color(0xFFB1BFD4), faint = Color(0xFF8191AC),
    primary = Color(0xFF1769E8), primaryInk = Color(0xFF7FB0FF), primarySoft = Color(0xFF16294A), navy = Color(0xFF0C1D38), navyDeep = Color(0xFF07122A),
    okInk = Color(0xFF4FD1A1), okSoft = Color(0xFF10302A), warnInk = Color(0xFFF3B04F), warnSoft = Color(0xFF34270F),
    dangerInk = Color(0xFFFF8A80), dangerSoft = Color(0xFF3A1B1D), violetInk = Color(0xFFB7A2FF), violetSoft = Color(0xFF26204A), dark = true,
)

val LocalSd = staticCompositionLocalOf { LightSd }
val MaterialTheme.sd: SdColors @Composable @ReadOnlyComposable get() = LocalSd.current

private fun scheme(s: SdColors) =
    if (s.dark) darkColorScheme(
        primary = s.primary, onPrimary = Color.White, primaryContainer = s.primarySoft, onPrimaryContainer = s.primaryInk,
        background = s.canvas, onBackground = s.ink, surface = s.surface, onSurface = s.ink, surfaceVariant = s.surface2, onSurfaceVariant = s.muted,
        outline = s.lineStrong, outlineVariant = s.line, error = s.dangerInk, onError = Color(0xFF3B0A06), errorContainer = s.dangerSoft, onErrorContainer = s.dangerInk,
        tertiary = s.warnInk, surfaceContainer = s.surface, surfaceContainerHigh = s.surface2, surfaceContainerHighest = s.surface2,
    ) else lightColorScheme(
        primary = s.primary, onPrimary = Color.White, primaryContainer = s.primarySoft, onPrimaryContainer = s.primaryInk,
        background = s.canvas, onBackground = s.ink, surface = s.surface, onSurface = s.ink, surfaceVariant = s.surface2, onSurfaceVariant = s.muted,
        outline = s.lineStrong, outlineVariant = s.line, error = Color(0xFFDC2F2F), onError = Color.White, errorContainer = s.dangerSoft, onErrorContainer = s.dangerInk,
        tertiary = s.warnInk, surfaceContainer = s.surface, surfaceContainerHigh = s.surface2, surfaceContainerHighest = s.surface2,
    )

val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal), Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold), Font(R.font.inter_bold, FontWeight.Bold),
)

private fun t(size: Int, weight: FontWeight, line: Int, track: Float = 0f) = TextStyle(fontFamily = Inter, fontSize = size.sp, fontWeight = weight, lineHeight = line.sp, letterSpacing = track.sp)
private val SdType = Typography(
    headlineLarge = t(28, FontWeight.Bold, 34, -0.5f), headlineMedium = t(24, FontWeight.Bold, 30, -0.4f), headlineSmall = t(22, FontWeight.Bold, 28, -0.3f),
    titleLarge = t(20, FontWeight.Bold, 26, -0.3f), titleMedium = t(16, FontWeight.SemiBold, 22, -0.1f), titleSmall = t(14, FontWeight.SemiBold, 20),
    bodyLarge = t(15, FontWeight.Normal, 22), bodyMedium = t(14, FontWeight.Normal, 20), bodySmall = t(12, FontWeight.Normal, 17),
    labelLarge = t(13, FontWeight.Medium, 18), labelMedium = t(12, FontWeight.Medium, 16), labelSmall = t(11, FontWeight.SemiBold, 14, 0.3f),
)

private val SdShapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(16.dp), extraLarge = RoundedCornerShape(24.dp))

/** The motion curves of the website: a strong ease-out and the drawer curve. */
object Motion {
    val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
    val Drawer = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)
}

/** Appearance chosen in Settings: 0 follows the phone, 1 light, 2 dark. */
object ThemePref {
    var mode by androidx.compose.runtime.mutableIntStateOf(0)
    fun load(c: android.content.Context) { mode = c.getSharedPreferences("superdrive", android.content.Context.MODE_PRIVATE).getInt("theme_mode", 0) }
    fun set(c: android.content.Context, m: Int) { mode = m; c.getSharedPreferences("superdrive", android.content.Context.MODE_PRIVATE).edit().putInt("theme_mode", m).apply() }
}

@Composable
fun SuperDriveTheme(dark: Boolean = when (ThemePref.mode) { 1 -> false; 2 -> true; else -> isSystemInDarkTheme() }, content: @Composable () -> Unit) {
    val sd = if (dark) DarkSd else LightSd
    val view = androidx.compose.ui.platform.LocalView.current
    if (!view.isInEditMode) androidx.compose.runtime.SideEffect {
        val w = (view.context as? android.app.Activity)?.window
        if (w != null) androidx.core.view.WindowCompat.getInsetsController(w, view).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
    }
    CompositionLocalProvider(LocalSd provides sd) { MaterialTheme(colorScheme = scheme(sd), shapes = SdShapes, typography = SdType, content = content) }
}
