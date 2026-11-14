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

    private data class DownloadRequest(val url: String, val userAgent: String?, val contentDisposition: String?, val mimeType: String?)

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        chooser = null
    }

    private val askStorage = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingDownload
        pendingDownload = null
        if (request == null) return@registerForActivityResult
        if (granted) enqueue(request) else Toast.makeText(this, R.string.download_denied, Toast.LENGTH_LONG).show()
    }

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
        findViewById<Button>(R.id.retry).setOnClickListener { retry() }
        findViewById<Button>(R.id.changeServer).setOnClickListener { changeServer() }

        configureWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    customView != null -> hideCustomView()
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(server)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) applySystemBars()
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
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
        fun themeChanged() {
            runOnUiThread { applySystemBars() }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme ?: return false
            if (scheme == "blob" || scheme == "data" || scheme == "about") return false
            if ((scheme == "http" || scheme == "https") && ServerStore.origin(uri.toString()) == ServerStore.origin(server)) return false
            // Anything else (another website, mailto:, tel:) opens in the app the phone chooses.
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
                pickFiles.launch(params.createIntent())
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
            setImmersive(true)
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
        setImmersive(false)
    }

    private fun setImmersive(on: Boolean) {
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
