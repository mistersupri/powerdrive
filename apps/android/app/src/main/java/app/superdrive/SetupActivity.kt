package app.superdrive

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** First run: ask for the server address and check that a SuperDrive really answers there. */
class SetupActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var connect: Button
    private lateinit var error: TextView
    private lateinit var warning: TextView
    private lateinit var busy: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        input = findViewById(R.id.server)
        connect = findViewById(R.id.connect)
        error = findViewById(R.id.error)
        warning = findViewById(R.id.warning)
        busy = findViewById(R.id.busy)

        ServerStore.url(this)?.let { input.setText(it) }
        connect.setOnClickListener { tryConnect() }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) { tryConnect(); true } else false
        }
    }

    private fun tryConnect() {
        val url = ServerStore.normalize(input.text.toString())
        if (url == null) { showError(getString(R.string.err_invalid)); return }
        warning.visibility = if (url.startsWith("http://")) View.VISIBLE else View.GONE
        error.visibility = View.GONE
        busy.visibility = View.VISIBLE
        connect.isEnabled = false
        Thread {
            val problem = probe(url)
            runOnUiThread {
                busy.visibility = View.GONE
                connect.isEnabled = true
                if (problem != null) {
                    showError(problem)
                } else {
                    ServerStore.save(this, url)
                    startActivity(Intent(this, NativeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                    finish()
                }
            }
        }.start()
    }

    private fun showError(message: String) {
        error.text = message
        error.visibility = View.VISIBLE
    }

    /** Returns null when a SuperDrive answers at [base], otherwise a message for the person. */
    private fun probe(base: String): String? {
        return try {
            // Newer servers publish their branding; older ones still answer the sign-in check with the same JSON envelope.
            if (looksLikeSuperDrive("$base/api/v1/branding") || looksLikeSuperDrive("$base/api/v1/auth/me")) null
            else getString(R.string.err_not_superdrive)
        } catch (e: UnknownHostException) {
            getString(R.string.err_unreachable)
        } catch (e: SocketTimeoutException) {
            getString(R.string.err_unreachable)
        } catch (e: SSLException) {
            getString(R.string.err_tls)
        } catch (e: Exception) {
            getString(R.string.err_unreachable)
        }
    }

    private fun looksLikeSuperDrive(address: String): Boolean {
        val c = URL(address).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 8000
            c.readTimeout = 8000
            c.instanceFollowRedirects = true
            c.setRequestProperty("Accept", "application/json")
            val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream ?: return false
            val body = stream.bufferedReader().use { it.readText() }
            // Every SuperDrive API reply is { "success": true|false, ... }, including the 401 for a signed-out caller.
            return JSONObject(body).has("success")
        } catch (e: org.json.JSONException) {
            return false
        } finally {
            c.disconnect()
        }
    }
}
