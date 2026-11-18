package app.superdrive

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.superdrive.core.Session
import app.superdrive.ui.NativeApp
import app.superdrive.ui.theme.SuperDriveTheme

/**
 * The whole app: a Jetpack Compose interface, no WebView. It also owns the fingerprint lock, the Google sign-in return link,
 * update checks and the photo backup schedule.
 */
class NativeActivity : AppCompatActivity() {
    private lateinit var lock: AppLock
    private var loginLink by mutableStateOf<Uri?>(null)
    private var covered by mutableStateOf(false)
    private var unlocked = false
    private var leftAt: Long? = null
    /** Set right before a screen that is part of using the app (permission, system settings) so leaving for it does not lock the app. */
    @Volatile var externalFlow = false

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val session = Session(this)
        if (session.server == null) { startActivity(Intent(this, SetupActivity::class.java)); finish(); return }
        lock = AppLock(this)
        if (lock.enabled) covered = true // never flash the app before the lock
        loginLink = loginLinkOf(intent)
        BackupScheduler.apply(this)
        Updater(this).check(false)
        askNotificationsOnce()
        setContent {
            SuperDriveTheme {
                Box(Modifier.fillMaxSize()) {
                    NativeApp(session, loginLink = loginLink, onLoginLinkHandled = { loginLink = null })
                    if (covered) LockCover(onUnlock = { promptUnlock() })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loginLinkOf(intent)?.let { loginLink = it }
    }

    private fun loginLinkOf(intent: Intent?): Uri? = intent?.data?.takeIf { it.scheme == "app.superdrive" && it.host == "login" }

    private fun askNotificationsOnce() {
        val prefs = getSharedPreferences("superdrive", MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("notif_asked", false) && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean("notif_asked", true).apply()
            externalFlow = true
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::lock.isInitialized) ensureUnlocked()
        externalFlow = false
    }

    override fun onPause() {
        // Covers the app before Android takes the recent-apps snapshot.
        if (::lock.isInitialized && lock.enabled && !externalFlow) covered = true
        super.onPause()
    }

    override fun onStop() {
        if (::lock.isInitialized && lock.enabled && !externalFlow) leftAt = System.currentTimeMillis()
        super.onStop()
    }

    private fun ensureUnlocked() {
        if (!lock.enabled) { covered = false; return }
        if (lock.unusable()) { lock.enabled = false; covered = false; Toast.makeText(this, R.string.lock_auto_off, Toast.LENGTH_LONG).show(); return }
        val away = leftAt
        val needed = !unlocked || (away != null && System.currentTimeMillis() - away >= lock.delayMs)
        if (!needed) { covered = false; return }
        unlocked = false
        covered = true
        promptUnlock()
    }

    private fun promptUnlock() {
        lock.authenticate(getString(R.string.lock_prompt_title), getString(R.string.lock_prompt_subtitle).takeIf { Build.VERSION.SDK_INT >= Build.VERSION_CODES.R }) { ok ->
            if (ok) { unlocked = true; leftAt = null; covered = false }
        }
    }
}

@androidx.compose.runtime.Composable
private fun LockCover(onUnlock: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Aplikasi terkunci", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = onUnlock, modifier = Modifier.padding(top = 20.dp)) { Text("Buka kunci") }
        }
    }
}
