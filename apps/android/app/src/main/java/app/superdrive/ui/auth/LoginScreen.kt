package app.superdrive.ui.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.superdrive.R
import app.superdrive.ui.design.IconTile
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.theme.Motion
import app.superdrive.ui.theme.sd

/** The website's login hero: deep navy fading into the brand blue, with soft glows. */
@Composable
private fun HeroBackdrop(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = MaterialTheme.sd
    Box(modifier.background(Brush.linearGradient(listOf(c.navyDeep, c.navy, Color(0xFF1A4F9C)), start = Offset(0f, 0f), end = Offset(1200f, 1800f))).drawBehind {
        drawCircle(Brush.radialGradient(listOf(Color(0x551769E8), Color.Transparent), center = Offset(size.width * 0.9f, size.height * 0.08f), radius = size.width * 0.8f), radius = size.width * 0.8f, center = Offset(size.width * 0.9f, size.height * 0.08f))
        drawCircle(Brush.radialGradient(listOf(Color(0x33FFFFFF), Color.Transparent), center = Offset(size.width * 0.05f, size.height * 0.55f), radius = size.width * 0.6f), radius = size.width * 0.6f, center = Offset(size.width * 0.05f, size.height * 0.55f))
    }) { content() }
}

@Composable
fun Splash() {
    val t = rememberInfiniteTransition(label = "splash")
    val s by t.animateFloat(0.94f, 1.06f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pulse")
    HeroBackdrop(Modifier.fillMaxSize()) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Image(painterResource(R.drawable.ic_logo_cube), contentDescription = null, modifier = Modifier.size(72.dp).scale(s)) } }
}

@Composable
fun LoginScreen(state: AuthState, onLogin: (String, String) -> Unit, onVerify: (String, Boolean) -> Unit, onBackToPassword: () -> Unit, server: String, google: Boolean = false, onGoogle: () -> Unit = {}) {
    val c = MaterialTheme.sd
    Column(Modifier.fillMaxSize().background(c.navy).imePadding()) {
        HeroBackdrop(Modifier.fillMaxWidth().weight(0.38f)) {
            Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 28.dp, vertical = 20.dp), verticalArrangement = Arrangement.Bottom) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Color(0x26FFFFFF)).border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) { Image(painterResource(R.drawable.ic_logo_cube), contentDescription = null, modifier = Modifier.size(30.dp)) }
                Text("SuperDrive", Modifier.padding(top = 18.dp), style = MaterialTheme.typography.headlineLarge, color = Color.White)
                Text("Semua penyimpanan Anda, satu tempat. Pindahkan file antar penyimpanan langsung lewat server.", Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.72f))
            }
        }
        Column(Modifier.fillMaxWidth().weight(0.62f).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(c.surface).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(top = 28.dp, bottom = 20.dp).navigationBarsPadding()) {
            AnimatedContent(state is AuthState.Mfa, label = "step", transitionSpec = { (slideInVertically(tween(320, easing = Motion.EaseOut)) { it / 10 } + fadeIn(tween(240))) togetherWith fadeOut(tween(120)) }) { mfa ->
                Column(Modifier.fillMaxWidth()) {
                    if (mfa && state is AuthState.Mfa) MfaStep(state, onVerify, onBackToPassword)
                    else if (state is AuthState.SignedOut) PasswordStep(state, onLogin, server, google, onGoogle)
                }
            }
        }
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaultsColors()
@Composable
private fun OutlinedTextFieldDefaultsColors() = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
    focusedBorderColor = MaterialTheme.sd.primary, unfocusedBorderColor = MaterialTheme.sd.lineStrong, focusedContainerColor = MaterialTheme.sd.surface, unfocusedContainerColor = MaterialTheme.sd.surface,
)

@Composable
private fun PrimaryButton(text: String, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !busy, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().height(52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.sd.primary, contentColor = Color.White, disabledContainerColor = MaterialTheme.sd.primary.copy(alpha = 0.4f), disabledContentColor = Color.White)) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White) else Text(text, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
private fun PasswordStep(state: AuthState.SignedOut, onLogin: (String, String) -> Unit, server: String, google: Boolean, onGoogle: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    Text("Selamat datang kembali", Modifier.riseIn(0), style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.sd.ink)
    Row(Modifier.padding(top = 6.dp).riseIn(1), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(MaterialTheme.sd.okInk))
        Text(server.removePrefix("https://").removePrefix("http://"), Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.sd.muted)
    }
    Spacer(Modifier.height(22.dp))
    OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, shape = RoundedCornerShape(14.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth().riseIn(2), enabled = !state.busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(password, { password = it }, label = { Text("Kata sandi") }, singleLine = true, shape = RoundedCornerShape(14.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth().riseIn(3), enabled = !state.busy, visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { if (email.isNotBlank() && password.isNotEmpty()) onLogin(email, password) }))
    state.error?.let {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.sd.dangerSoft).padding(12.dp), verticalAlignment = Alignment.Top) {
            Text(it, color = MaterialTheme.sd.dangerInk, style = MaterialTheme.typography.bodyMedium)
        }
    }
    Spacer(Modifier.height(20.dp))
    Box(Modifier.riseIn(4)) { PrimaryButton("Masuk", email.isNotBlank() && password.isNotEmpty(), state.busy) { onLogin(email, password) } }
    if (google) {
        Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).height(1.dp).background(MaterialTheme.sd.line)); Text("atau", Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.sd.faint); Box(Modifier.weight(1f).height(1.dp).background(MaterialTheme.sd.line))
        }
        OutlinedButton(onClick = onGoogle, enabled = !state.busy, shape = RoundedCornerShape(14.dp), border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.sd.lineStrong), modifier = Modifier.fillMaxWidth().height(52.dp).riseIn(5)) {
            Text("G", color = Color(0xFF4285F4), style = MaterialTheme.typography.titleMedium); Text("Masuk dengan Google", Modifier.padding(start = 10.dp), color = MaterialTheme.sd.ink, style = MaterialTheme.typography.titleSmall)
        }
    }
}

@Composable
private fun MfaStep(state: AuthState.Mfa, onVerify: (String, Boolean) -> Unit, onBack: () -> Unit) {
    var code by rememberSaveable { mutableStateOf("") }
    var recovery by rememberSaveable { mutableStateOf(false) }
    IconTile(Lu.Shield, MaterialTheme.sd.primarySoft, MaterialTheme.sd.primaryInk, size = 52.dp, iconSize = 26.dp, radius = 16.dp)
    Text("Verifikasi dua langkah", Modifier.padding(top = 14.dp), style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.sd.ink)
    Text(if (recovery) "Masukkan salah satu kode pemulihan yang Anda simpan." else "Masukkan kode 6 digit dari aplikasi autentikator Anda.", Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.sd.muted)
    Spacer(Modifier.height(20.dp))
    OutlinedTextField(code, { code = it }, label = { Text(if (recovery) "Kode pemulihan" else "Kode verifikasi") }, singleLine = true, shape = RoundedCornerShape(14.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth(), enabled = !state.busy,
        keyboardOptions = KeyboardOptions(keyboardType = if (recovery) KeyboardType.Ascii else KeyboardType.NumberPassword, imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { if (code.isNotBlank()) onVerify(code, recovery) }))
    state.error?.let { Text(it, Modifier.padding(top = 10.dp), color = MaterialTheme.sd.dangerInk, style = MaterialTheme.typography.bodyMedium) }
    Spacer(Modifier.height(18.dp))
    PrimaryButton("Verifikasi", code.isNotBlank(), state.busy) { onVerify(code, recovery) }
    TextButton(onClick = { recovery = !recovery; code = "" }, modifier = Modifier.fillMaxWidth()) { Text(if (recovery) "Pakai kode dari aplikasi" else "Pakai kode pemulihan") }
    TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Kembali") }
}
