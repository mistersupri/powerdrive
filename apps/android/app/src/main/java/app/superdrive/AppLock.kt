package app.superdrive

import android.content.Context
import android.os.Build
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat

/** Optional app lock: fingerprint (or the phone's screen lock) before the app shows anything. The setting lives on this phone only. */
class AppLock(private val activity: AppCompatActivity) {
    private val prefs = activity.getSharedPreferences("superdrive", Context.MODE_PRIVATE)

    var enabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(v) { prefs.edit().putBoolean(KEY_ENABLED, v).apply() }

    /** How long the app may stay in the background before it asks again. 0 = every time. */
    var delayMs: Long
        get() = prefs.getLong(KEY_DELAY, 60_000L)
        set(v) { prefs.edit().putLong(KEY_DELAY, v).apply() }

    // Fingerprint or screen lock together need Android 11; older versions can only offer the biometric itself.
    private val authenticators get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK

    fun status(): Int = BiometricManager.from(activity).canAuthenticate(authenticators)
    fun available(): Boolean = status() == BiometricManager.BIOMETRIC_SUCCESS

    /** True when this phone can never satisfy the lock any more (fingerprints and screen lock removed). */
    fun unusable(): Boolean = status().let { it == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED || it == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE }

    @Volatile var prompting = false
        private set

    fun authenticate(title: String, subtitle: String?, onResult: (Boolean) -> Unit) {
        if (prompting) return
        prompting = true
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { prompting = false; onResult(true) }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { prompting = false; onResult(false) }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(authenticators).apply {
            if (subtitle != null) setSubtitle(subtitle)
            // A cancel button is only allowed when the screen lock is not one of the choices.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) setNegativeButtonText(activity.getString(R.string.lock_cancel))
        }.build()
        try { prompt.authenticate(info) } catch (e: Exception) { prompting = false; onResult(false) }
    }

    companion object {
        private const val KEY_ENABLED = "lock_enabled"
        private const val KEY_DELAY = "lock_delay"
    }
}
