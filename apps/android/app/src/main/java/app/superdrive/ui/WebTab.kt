package app.superdrive.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import app.superdrive.BuildConfig
import app.superdrive.ServerStore
import app.superdrive.ui.files.enqueueDownload

/**
 * A screen that has not been rewritten natively yet: the website's page for it, inside the native shell.
 * It shares the session with the native screens, and disappears screen by screen as they are ported.
 * Each tab keeps its own page alive, so switching tabs does not reload or lose the scroll position.
 */
@SuppressLint("SetJavaScriptEnabled")
private fun createWeb(context: android.content.Context, server: String, path: String): WebView = WebView(context).apply {
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
    with(settings) {
        javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false; allowFileAccess = false
        cacheMode = WebSettings.LOAD_DEFAULT
        // The page recognises the app by this suffix and adapts: no web bottom bar, full-screen viewer, no admin settings.
        userAgentString = userAgentString + " SuperDriveAndroid/" + BuildConfig.VERSION_NAME
    }
    overScrollMode = android.view.View.OVER_SCROLL_NEVER
    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {
            val u = request.url
            if ((u.scheme == "http" || u.scheme == "https") && ServerStore.origin(u.toString()) == ServerStore.origin(server)) return false
            if (u.scheme == "blob" || u.scheme == "data" || u.scheme == "about") return false
            try { view.context.startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { /* nothing can open it */ }
            return true
        }
    }
    webChromeClient = WebChromeClient()
    setDownloadListener { url, ua, disposition, mime, _ -> enqueueDownload(context, url, android.webkit.URLUtil.guessFileName(url, disposition, mime), mime, ua) }
    loadUrl(server.trimEnd('/') + path)
}

@Composable
fun WebTab(path: String, server: String, cache: MutableMap<String, WebView>, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier.fillMaxSize().statusBarsPadding(),
        factory = { ctx -> cache.getOrPut(path) { createWeb(ctx, server, path) }.also { (it.parent as? ViewGroup)?.removeView(it) } },
        onRelease = { (it.parent as? ViewGroup)?.removeView(it) },
    )
}
