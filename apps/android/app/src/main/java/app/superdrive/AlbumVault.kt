package app.superdrive

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Lets the fingerprint stand in for typing the private-album password.
 * The password is encrypted with a key that lives in the Android Keystore and can only be used right after a fingerprint
 * (a new fingerprint on the phone voids the key). The server still checks the password itself: nothing is unlocked by the app alone.
 */
class AlbumVault(private val activity: AppCompatActivity) {
    private val prefs = activity.getSharedPreferences("superdrive", Context.MODE_PRIVATE)
    private val alias = "album_vault"
    @Volatile private var busy = false

    fun available() = BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
    fun enrolledFor(userId: String) = prefs.getString("vault_user", null) == userId && prefs.getString("vault_ct", null) != null

    fun clear() {
        prefs.edit().remove("vault_ct").remove("vault_iv").remove("vault_user").apply()
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias) } catch (e: Exception) { /* nothing stored */ }
    }

    private fun key(create: Boolean): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { if (!create) return it }
        if (!create) return null
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256)
            .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true)
            .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG) }.build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    private fun prompt(title: String, cipher: Cipher, onOk: (Cipher) -> Unit, onFail: (String) -> Unit) {
        if (busy) return
        busy = true
        val p = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                busy = false
                val c = result.cryptoObject?.cipher
                if (c == null) onFail("cancelled") else try { onOk(c) } catch (e: Exception) { onFail("failed") }
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { busy = false; onFail("cancelled") }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(activity.getString(R.string.lock_cancel)).build()
        try { p.authenticate(info, BiometricPrompt.CryptoObject(cipher)) } catch (e: Exception) { busy = false; onFail("failed") }
    }

    /** Fingerprint, then remember [password] (for [userId]) behind it. */
    fun enroll(userId: String, password: String, done: (Boolean, String?) -> Unit) {
        try {
            clear()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key(true)) }
            prompt(activity.getString(R.string.vault_enroll_title), cipher, { c ->
                val ct = c.doFinal(password.toByteArray(Charsets.UTF_8))
                prefs.edit().putString("vault_ct", Base64.encodeToString(ct, Base64.NO_WRAP)).putString("vault_iv", Base64.encodeToString(c.iv, Base64.NO_WRAP)).putString("vault_user", userId).apply()
                done(true, null)
            }, { why -> clear(); done(false, why) })
        } catch (e: Exception) { clear(); done(false, "failed") }
    }

    /** Fingerprint, then hand back the stored password. */
    fun unlock(userId: String, done: (String?, String?) -> Unit) {
        if (!enrolledFor(userId)) { done(null, "not_enrolled"); return }
        try {
            val iv = Base64.decode(prefs.getString("vault_iv", "")!!, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(false) ?: throw IllegalStateException(), GCMParameterSpec(128, iv)) }
            prompt(activity.getString(R.string.vault_unlock_title), cipher, { c ->
                done(String(c.doFinal(Base64.decode(prefs.getString("vault_ct", "")!!, Base64.NO_WRAP)), Charsets.UTF_8), null)
            }, { why -> done(null, why) })
        } catch (e: KeyPermanentlyInvalidatedException) { clear(); done(null, "invalidated") }
        catch (e: Exception) { clear(); done(null, "failed") }
    }
}
