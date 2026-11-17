package app.superdrive

import android.Manifest
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.app.NotificationManager
import org.json.JSONObject
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * The SuperDrive web app in a native shell: file picker for uploads, system download manager for downloads,
 * fullscreen video, JavaScript dialogs, system bars tinted to the app theme, and a retry screen when the server is unreachable.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorBox: View
    private lateinit var errorMessage: TextView
    private lateinit var fullscreenHost: FrameLayout

    private var server = ""
    private var failed = false
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private var pendingDownload: DownloadRequest? = null
    private lateinit var updater: Updater
    private lateinit var lock: AppLock
    private lateinit var lockScreen: View
    private var unlocked = false
    private var leftAt: Long? = null
    /** Set right before a screen that is part of using the app (file picker, permission, settings) so leaving for it does not lock the app. */
    var externalFlow = false
    private var transfersActive = false
    private var lastDone = 0
    private var lastFailed = 0

    private data class DownloadRequest(val url: String, val userAgent: String?, val contentDisposition: String?, val mimeType: String?)

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val picked: Array<Uri>? = if (result.resultCode != RESULT_OK || data == null) null else {
            val clip = data.clipData
            if (clip != null && clip.itemCount > 0) Array(clip.itemCount) { clip.getItemAt(it).uri } else data.data?.let { arrayOf(it) }
        }
        chooser?.onReceiveValue(picked)
        chooser = null
    }

    private val askStorage = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingDownload
        pendingDownload = null
        if (request == null) return@registerForActivityResult
        if (granted) enqueue(request) else Toast.makeText(this, R.string.download_denied, Toast.LENGTH_LONG).show()
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* the notification simply stays hidden when refused */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = ServerStore.url(this)
        if (saved == null) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        server = saved
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        progress = findViewById(R.id.progress)
        errorBox = findViewById(R.id.errorBox)
        errorMessage = findViewById(R.id.errorMessage)
        fullscreenHost = findViewById(R.id.fullscreenHost)
        lockScreen = findViewById(R.id.lockScreen)
        lock = AppLock(this)
        findViewById<Button>(R.id.unlock).setOnClickListener { promptUnlock() }
        if (lock.enabled) setLocked(true) // never flash the app before the lock
        findViewById<Button>(R.id.retry).setOnClickListener { retry() }
        findViewById<Button>(R.id.changeServer).setOnClickListener { changeServer() }

        updater = Updater(this)
        configureWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    lockScreen.visibility == View.VISIBLE -> finish()
                    customView != null -> hideCustomView()
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else if (!handleLoginLink(intent)) web.loadUrl(server)
        if (savedInstanceState == null) updater.check(manual = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (::web.isInitialized) handleLoginLink(intent)
    }

    // ---- Sign in with Google ----
    // Google refuses to sign people in inside an embedded WebView, so the page is opened in the phone's browser. The browser comes back with
    // app.superdrive://login?code=...; the code only works together with the secret verifier generated here, which never leaves the app.
    private fun startGoogle(start: Uri) {
        val raw = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val flags = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        val verifier = Base64.encodeToString(raw, flags)
        getSharedPreferences("superdrive", Context.MODE_PRIVATE).edit().putString("google_verifier", verifier).apply()
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), flags)
        val target = start.buildUpon().appendQueryParameter("app", "1").appendQueryParameter("cc", challenge).build()
        externalFlow = true
        try { startActivity(Intent(Intent.ACTION_VIEW, target)) } catch (e: ActivityNotFoundException) { Toast.makeText(this, R.string.google_no_browser, Toast.LENGTH_LONG).show() }
    }

    /** True when [intent] was the browser returning from Google, and the page was pointed at the right place. */
    private fun handleLoginLink(intent: Intent?): Boolean {
        val d = intent?.data ?: return false
        if (d.scheme != "app.superdrive" || d.host != "login") return false
        val prefs = getSharedPreferences("superdrive", Context.MODE_PRIVATE)
        val code = d.getQueryParameter("code")
        val challenge = d.getQueryParameter("challenge")
        val error = d.getQueryParameter("error")
        val verifier = prefs.getString("google_verifier", null)
        val url = when {
            code != null && verifier != null -> "$server/api/v1/auth/google/exchange?code=${Uri.encode(code)}&verifier=${Uri.encode(verifier)}"
            challenge != null -> "$server/login?challenge=${Uri.encode(challenge)}"
            else -> "$server/login?error=${Uri.encode(error ?: "google_failed")}"
        }
        prefs.edit().remove("google_verifier").apply()
        failed = false
        web.loadUrl(url)
        return true
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) applySystemBars()
        if (::lock.isInitialized) ensureUnlocked()
        externalFlow = false
    }

    override fun onPause() {
        // Covers the app before Android takes the recent-apps snapshot.
        if (::lock.isInitialized && lock.enabled && !externalFlow) setLocked(true)
        super.onPause()
    }

    override fun onStop() {
        if (::lock.isInitialized && lock.enabled && !externalFlow) leftAt = System.currentTimeMillis()
        super.onStop()
    }

    private fun setLocked(on: Boolean) {
        lockScreen.visibility = if (on) View.VISIBLE else View.GONE
        // Screen readers must not read the page hidden underneath.
        web.importantForAccessibility = if (on) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    }

    private fun ensureUnlocked() {
        if (!lock.enabled) { setLocked(false); return }
        if (lock.unusable()) {
            lock.enabled = false
            setLocked(false)
            Toast.makeText(this, R.string.lock_auto_off, Toast.LENGTH_LONG).show()
            notifyLockChanged()
            return
        }
        val away = leftAt
        val needed = !unlocked || (away != null && System.currentTimeMillis() - away >= lock.delayMs)
        leftAt = null
        if (!needed) { setLocked(false); return }
        unlocked = false
        setLocked(true)
        promptUnlock()
    }

    private fun promptUnlock() {
        lock.authenticate(getString(R.string.lock_prompt_title), getString(R.string.lock_prompt_subtitle).takeIf { Build.VERSION.SDK_INT >= Build.VERSION_CODES.R }) { ok ->
            if (ok) { unlocked = true; leftAt = null; setLocked(false) }
        }
    }

    private fun notifyLockChanged() {
        web.evaluateJavascript("window.dispatchEvent(new Event('sd-lock-changed'))", null)
    }

    /** Turn the lock on/off or change its delay from the web app's settings. Any change has to be confirmed with the fingerprint first. */
    private fun changeLock(enable: Boolean, delayMs: Long) {
        if (enable && !lock.available()) {
            Toast.makeText(this, R.string.lock_unavailable, Toast.LENGTH_LONG).show()
            notifyLockChanged()
            return
        }
        if (!enable && !lock.enabled) { lock.delayMs = delayMs; notifyLockChanged(); return }
        lock.authenticate(getString(R.string.lock_confirm_title), null) { ok ->
            if (ok) {
                lock.enabled = enable
                lock.delayMs = delayMs
                unlocked = true
                leftAt = null
            }
            notifyLockChanged()
        }
    }

    override fun onDestroy() {
        if (isFinishing && transfersActive) {
            stopService(Intent(this, TransferService::class.java))
            getSystemService(NotificationManager::class.java).cancel(Notifier.PROGRESS_ID)
        }
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    private fun showProgress(json: String) {
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        val active = o.optInt("active")
        val done = o.optInt("done")
        val failed = o.optInt("failed")
        val nm = getSystemService(NotificationManager::class.java)
        if (active > 0) {
            if (!transfersActive && Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
                !getSharedPreferences("superdrive", Context.MODE_PRIVATE).getBoolean("notif_asked", false)
            ) {
                getSharedPreferences("superdrive", Context.MODE_PRIVATE).edit().putBoolean("notif_asked", true).apply()
                externalFlow = true
                askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            transfersActive = true
            lastDone = done
            lastFailed = failed
            nm.cancel(Notifier.DONE_ID)
            val percent = o.optInt("percent", -1)
            val title = o.optString("title", getString(R.string.app_name))
            val text = getString(R.string.notif_progress_text, percent, done)
            val service = Intent(this, TransferService::class.java).putExtra("title", title).putExtra("text", text).putExtra("percent", percent)
            try {
                ContextCompat.startForegroundService(this, service)
            } catch (e: Exception) {
                // Not allowed to start a service right now: a plain notification still reports progress.
                nm.notify(Notifier.PROGRESS_ID, Notifier.progress(this, title, text, percent))
            }
        } else if (transfersActive) {
            transfersActive = false
            stopService(Intent(this, TransferService::class.java))
            nm.cancel(Notifier.PROGRESS_ID)
            val total = maxOf(done, lastDone) + maxOf(failed, lastFailed)
            if (total > 0) {
                val text = if (failed > 0) getString(R.string.notif_done_failed, done, failed) else getString(R.string.notif_done_text, done)
                nm.notify(Notifier.DONE_ID, Notifier.done(this, getString(R.string.notif_done_title), text))
            }
        }
    }

    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgentString + " SuperDriveAndroid/" + BuildConfig.VERSION_NAME
        }
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.addJavascriptInterface(Bridge(), "SuperDriveAndroid")
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(DownloadRequest(url, userAgent, contentDisposition, mimeType))
        }
    }

    private fun retry() {
        errorBox.visibility = View.GONE
        failed = false
        if (web.url == null || web.url == "about:blank") web.loadUrl(server) else web.reload()
    }

    private fun changeServer() {
        ServerStore.clear(this)
        startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    /** Called from the web app. */
    private inner class Bridge {
        @JavascriptInterface
        fun isApp(): Boolean = true

        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        /** {enabled, delay (ms), available (this phone has a fingerprint or screen lock)} */
        @JavascriptInterface
        fun lockState(): String = JSONObject().put("enabled", lock.enabled).put("delay", lock.delayMs).put("available", lock.available()).toString()

        @JavascriptInterface
        fun setLock(enabled: Boolean, delayMs: Long) {
            runOnUiThread { changeLock(enabled, delayMs) }
        }

        /** The "Periksa pembaruan" button in the web app's settings. */
        @JavascriptInterface
        fun checkForUpdate() {
            runOnUiThread { updater.check(manual = true) }
        }

        /** Upload/transfer progress from the web app: {active, done, failed, percent, title}. */
        @JavascriptInterface
        fun progress(json: String) {
            runOnUiThread { showProgress(json) }
        }

        @JavascriptInterface
        fun themeChanged() {
            runOnUiThread { applySystemBars() }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme ?: return false
            if (scheme == "blob" || scheme == "data" || scheme == "about") return false
            if ((scheme == "http" || scheme == "https") && ServerStore.origin(uri.toString()) == ServerStore.origin(server)) {
                if (uri.path == "/api/v1/auth/google/start") { startGoogle(uri); return true }
                return false
            }
            // Anything else (another website, mailto:, tel:) opens in the app the phone chooses.
            externalFlow = true
            try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (e: ActivityNotFoundException) { /* nothing can open it */ }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            failed = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (!failed) errorBox.visibility = View.GONE
            applySystemBars()
            // The web app applies its theme a moment after load.
            view.postDelayed({ applySystemBars() }, 600)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            failed = true
            errorMessage.text = error.description?.toString() ?: ""
            errorBox.visibility = View.VISIBLE
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
        }

        override fun onShowFileChooser(webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            chooser?.onReceiveValue(null)
            chooser = callback
            return try {
                // Built by hand: createIntent() does not reliably allow picking several files.
                val intent = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                val types = params.acceptTypes.flatMap { it.split(",") }.map { it.trim() }.filter { it.contains("/") }
                if (types.isNotEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                externalFlow = true
                pickFiles.launch(Intent.createChooser(intent, null))
                true
            } catch (e: Exception) {
                chooser = null
                false
            }
        }

        // Without these, alert()/confirm()/prompt() in a WebView silently answer "cancel".
        override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity).setMessage(message)
                .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity).setMessage(message)
                .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                .setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
            val field = EditText(this@MainActivity)
            field.setText(defaultValue ?: "")
            AlertDialog.Builder(this@MainActivity).setMessage(message).setView(field)
                .setPositiveButton(R.string.ok) { _, _ -> result.confirm(field.text.toString()) }
                .setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }

        // The video player's fullscreen button.
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            customView = view
            customCallback = callback
            fullscreenHost.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            fullscreenHost.visibility = View.VISIBLE
            web.visibility = View.INVISIBLE
            setFullscreenBars(true)
        }

        override fun onHideCustomView() {
            hideCustomView()
        }
    }

    private fun hideCustomView() {
        fullscreenHost.removeAllViews()
        fullscreenHost.visibility = View.GONE
        web.visibility = View.VISIBLE
        customCallback?.onCustomViewHidden()
        customView = null
        customCallback = null
        setFullscreenBars(false)
    }

    private fun setFullscreenBars(on: Boolean) {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (on) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    /** Paint the status and navigation bars in the app's own surface colour, with icons that stay readable on it. */
    private fun applySystemBars() {
        web.evaluateJavascript("(function(){return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()})()") { raw ->
            val hex = raw?.trim('"') ?: return@evaluateJavascript
            val color = try { Color.parseColor(hex) } catch (e: Exception) { return@evaluateJavascript }
            window.statusBarColor = color
            window.navigationBarColor = color
            val light = ColorUtils.calculateLuminance(color) > 0.5
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.isAppearanceLightStatusBars = light
            controller.isAppearanceLightNavigationBars = light
        }
    }

    private fun startDownload(request: DownloadRequest) {
        // Android 9 and older need a runtime permission to write into the public Downloads folder.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownload = request
            externalFlow = true
            askStorage.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        enqueue(request)
    }

    private fun enqueue(request: DownloadRequest) {
        val name = URLUtil.guessFileName(request.url, request.contentDisposition, request.mimeType)
        try {
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val job = DownloadManager.Request(Uri.parse(request.url))
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            request.mimeType?.let { job.setMimeType(it) }
            request.userAgent?.let { job.addRequestHeader("User-Agent", it) }
            // The session cookie is what authorises the download; the download manager does not share the WebView's cookie jar.
            CookieManager.getInstance().getCookie(request.url)?.let { job.addRequestHeader("Cookie", it) }
            dm.enqueue(job)
            Toast.makeText(this, getString(R.string.download_started, name), Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, e.message ?: "Gagal mengunduh", Toast.LENGTH_LONG).show()
        }
    }
}
