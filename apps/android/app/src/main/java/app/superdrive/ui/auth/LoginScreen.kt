package app.superdrive.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.superdrive.R

@Composable
fun LoginScreen(state: AuthState, onLogin: (String, String) -> Unit, onVerify: (String, Boolean) -> Unit, onBackToPassword: () -> Unit, server: String, google: Boolean = false, onGoogle: () -> Unit = {}) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Image(painterResource(R.drawable.ic_logo_cube), contentDescription = null, modifier = Modifier.size(56.dp))
            Spacer(Modifier.height(16.dp))
            Column(Modifier.widthIn(max = 420.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                when (state) {
                    is AuthState.Mfa -> MfaStep(state, onVerify, onBackToPassword)
                    is AuthState.SignedOut -> PasswordStep(state, onLogin, server, google, onGoogle)
                    else -> CircularProgressIndicator()
                }
            }
        }
    }
}

@Composable
private fun PasswordStep(state: AuthState.SignedOut, onLogin: (String, String) -> Unit, server: String, google: Boolean, onGoogle: () -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    Text("Selamat datang kembali", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
    Text(server.removePrefix("https://").removePrefix("http://"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(24.dp))
    OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !state.busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(password, { password = it }, label = { Text("Kata sandi") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !state.busy, visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { if (email.isNotBlank() && password.isNotEmpty()) onLogin(email, password) }))
    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) }
    Spacer(Modifier.height(20.dp))
    Button(onClick = { onLogin(email, password) }, enabled = !state.busy && email.isNotBlank() && password.isNotEmpty(), modifier = Modifier.fillMaxWidth().height(52.dp)) {
        if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary) else Text("Masuk")
    }
    if (google) androidx.compose.material3.OutlinedButton(onClick = onGoogle, enabled = !state.busy, modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 0.dp)) { Text("Masuk dengan Google") }
}

@Composable
private fun MfaStep(state: AuthState.Mfa, onVerify: (String, Boolean) -> Unit, onBack: () -> Unit) {
    var code by rememberSaveable { mutableStateOf("") }
    var recovery by rememberSaveable { mutableStateOf(false) }
    Text("Verifikasi dua langkah", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
    Text(if (recovery) "Masukkan salah satu kode pemulihan yang Anda simpan." else "Masukkan kode 6 digit dari aplikasi autentikator Anda.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    Spacer(Modifier.height(24.dp))
    OutlinedTextField(code, { code = it }, label = { Text(if (recovery) "Kode pemulihan" else "Kode verifikasi") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !state.busy,
        keyboardOptions = KeyboardOptions(keyboardType = if (recovery) KeyboardType.Ascii else KeyboardType.NumberPassword, imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { if (code.isNotBlank()) onVerify(code, recovery) }))
    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) }
    Spacer(Modifier.height(20.dp))
    Button(onClick = { onVerify(code, recovery) }, enabled = !state.busy && code.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) {
        if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary) else Text("Verifikasi")
    }
    TextButton(onClick = { recovery = !recovery; code = "" }) { Text(if (recovery) "Pakai kode dari aplikasi" else "Pakai kode pemulihan") }
    TextButton(onClick = onBack) { Text("Kembali") }
}
