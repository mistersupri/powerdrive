package app.superdrive.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.superdrive.data.Api
import app.superdrive.data.ApiException
import app.superdrive.data.LoginResult
import app.superdrive.data.Me
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
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

    init { check() }

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
