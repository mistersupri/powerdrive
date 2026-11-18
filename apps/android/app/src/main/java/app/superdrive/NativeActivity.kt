package app.superdrive

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.superdrive.core.Session
import app.superdrive.ui.NativeApp
import app.superdrive.ui.theme.SuperDriveTheme

/**
 * The native interface (Jetpack Compose), opt-in while it grows to match the classic one. See docs/ANDROID-NATIVE.md.
 */
class NativeActivity : androidx.appcompat.app.AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val session = Session(this)
        if (session.server == null) { startActivity(Intent(this, SetupActivity::class.java)); finish(); return }
        setContent { SuperDriveTheme { NativeApp(session, onClassic = { goClassic() }) } }
    }

    private fun goClassic() {
        ServerStore.setNativeUi(this, false)
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }
}
