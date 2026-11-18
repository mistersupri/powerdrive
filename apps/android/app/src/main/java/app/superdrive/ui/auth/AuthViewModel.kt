package app.superdrive.ui.auth

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.LoginResult
import app.superdrive.core.Me
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.security.SecureRandom
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

sealed interface AuthState {
    data object Checking : AuthState
    data class SignedOut(val error: String? = null, val busy: Boolean = false) : AuthState
    /** Password accepted, waiting for the code from the authenticator app (or a recovery code). */
    data class Mfa(val challenge: String, val error: String? = null, val busy: Boolean = false) : AuthState
    data class SignedIn(val me: Me) : AuthState
}

class AuthViewModel(private val api: Api, private val onWorkspace: (String) -> Unit) : ViewModel() {
    private val _state = MutableStateFlow<AuthState>(AuthState.Checking)
    val state: StateFlow<AuthState> = _state

    /** Whether the server has Google sign-in switched on. */
    private val _google = MutableStateFlow(false)
    val google: StateFlow<Boolean> = _google

    init {
        check()
        viewModelScope.launch { try { _google.value = api.get<kotlinx.serialization.json.JsonObject>("/branding")["google"]?.toString() == "true" } catch (_: Exception) {} }
    }

    // Google refuses to sign people in inside an embedded WebView, so the phone's browser does it and comes back with app.superdrive://login?code=...
    // The code only works together with the secret verifier made here, which never leaves the app.
    fun startGoogle(context: Context) {
        val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val flags = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        val verifier = Base64.encodeToString(raw, flags)
        context.getSharedPreferences("superdrive", Context.MODE_PRIVATE).edit().putString("google_verifier", verifier).apply()
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), flags)
        val target = Uri.parse(api.url("/auth/google/start")).buildUpon().appendQueryParameter("app", "1").appendQueryParameter("cc", challenge).build()
        try { context.startActivity(Intent(Intent.ACTION_VIEW, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (e: ActivityNotFoundException) { _state.value = AuthState.SignedOut("Tidak ada peramban untuk masuk dengan Google.") }
    }

    /** The browser came back from Google. */
    fun onLoginLink(context: Context, link: Uri) {
        val prefs = context.getSharedPreferences("superdrive", Context.MODE_PRIVATE)
        val code = link.getQueryParameter("code"); val challenge = link.getQueryParameter("challenge"); val error = link.getQueryParameter("error")
        val verifier = prefs.getString("google_verifier", null)
        prefs.edit().remove("google_verifier").apply()
        when {
            code != null && verifier != null -> { _state.value = AuthState.Checking; viewModelScope.launch {
                try { if (api.redeem("/auth/google/exchange?code=${Uri.encode(code)}&verifier=${Uri.encode(verifier)}")) check() else _state.value = AuthState.SignedOut("Sesi masuk Google sudah berakhir. Coba lagi.") }
                catch (e: ApiException) { _state.value = AuthState.SignedOut(e.message) } } }
            challenge != null -> _state.value = AuthState.Mfa(challenge)
            else -> _state.value = AuthState.SignedOut(when (error) {
                "google_disabled" -> "Masuk dengan Google belum diaktifkan."; "email_unverified" -> "Email akun Google ini belum terverifikasi."; "domain_not_allowed" -> "Domain email ini tidak diizinkan untuk masuk."
                else -> "Tidak dapat menyelesaikan masuk dengan Google. Coba lagi." })
        }
    }

    /** Is there already a session (from an earlier sign-in here, or in the classic interface)? */
    fun check() {
        _state.value = AuthState.Checking
        viewModelScope.launch {
            _state.value = try { signedIn(api.get<Me>("/auth/me")) } catch (e: ApiException) { if (e.status == 401 || e.status == 403) AuthState.SignedOut() else AuthState.SignedOut(e.message) }
        }
    }

    fun login(email: String, password: String) {
        _state.value = AuthState.SignedOut(busy = true)
        viewModelScope.launch {
            try {
                val r = api.post<LoginResult>("/auth/login", buildJsonObject { put("email", email.trim()); put("password", password) })
                if (r.mfaRequired && r.challenge != null) _state.value = AuthState.Mfa(r.challenge) else check()
            } catch (e: ApiException) { _state.value = AuthState.SignedOut(e.message) }
        }
    }

    fun verify(code: String, recovery: Boolean = false) {
        val s = _state.value as? AuthState.Mfa ?: return
        _state.value = s.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                api.post<LoginResult>("/auth/mfa/verify", buildJsonObject { put("challenge", s.challenge); put(if (recovery) "recoveryCode" else "code", code.trim()) })
                check()
            } catch (e: ApiException) {
                // after five wrong tries the challenge is gone: start over
                _state.value = if (e.status == 401 && e.message?.contains("berakhir", ignoreCase = true) == true) AuthState.SignedOut(e.message) else s.copy(busy = false, error = e.message)
            }
        }
    }

    fun logout() {
        viewModelScope.launch { try { api.send("POST", "/auth/logout") } catch (_: ApiException) { /* the session is gone either way */ }; _state.value = AuthState.SignedOut() }
    }

    private fun signedIn(me: Me): AuthState { onWorkspace(me.activeWorkspaceId); return AuthState.SignedIn(me) }
}
