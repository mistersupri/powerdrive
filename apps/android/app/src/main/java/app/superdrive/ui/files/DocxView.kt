package app.superdrive.ui.files

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.superdrive.core.DocBlock
import app.superdrive.core.DocImage
import app.superdrive.core.DocPara
import app.superdrive.core.DocRun
import app.superdrive.core.DocTable
import app.superdrive.ui.theme.sd
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A Word document, drawn from [docxBlocks]: headings, formatted text, lists, tables and pictures, in a column that scrolls and can be selected. */
@Composable
fun DocxView(blocks: List<DocBlock>) {
    // No SelectionContainer around the list: selection inside a lazy list is unreliable on some devices, and a crash here would close the previewer.
    run {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)) {
            // Several empty paragraphs in a row are one gap, as they are on a printed page once margins are trimmed.
            val shown = blocks.filterIndexed { i, b -> !(b is DocPara && b.runs.isEmpty() && b.label == null && (i == 0 || (blocks[i - 1] as? DocPara)?.let { it.runs.isEmpty() && it.label == null } == true)) }
            if (shown.isEmpty()) item { Text("Dokumen kosong.", Modifier.padding(4.dp), color = MaterialTheme.sd.muted) }
            items(shown) { b ->
                when (b) {
                    is DocPara -> ParaView(b)
                    is DocTable -> TableView(b)
                    is DocImage -> PictureView(b)
                }
            }
        }
    }
}

private fun readable(c: Int?): Color? {
    if (c == null) return null
    val r = (c shr 16 and 0xFF) / 255f; val g = (c shr 8 and 0xFF) / 255f; val b = (c and 0xFF) / 255f
    val lum = 0.2126f * r + 0.7152f * g + 0.0722f * b
    // Plain black or white text chosen for paper would vanish on the app's own background: leave those to the theme.
    return if (lum < 0.18f || lum > 0.9f) null else Color(0xFF000000.toInt() or c)
}

private fun styled(p: DocPara, base: Float?, defaultBold: Boolean): AnnotatedString = buildAnnotatedString {
    p.runs.forEach { r: DocRun ->
        val deco = buildList { if (r.underline) add(TextDecoration.Underline); if (r.strike) add(TextDecoration.LineThrough) }.let { if (it.isEmpty()) null else TextDecoration.combine(it) }
        withStyle(SpanStyle(
            fontWeight = if (r.bold || defaultBold) FontWeight.Bold else null, fontStyle = if (r.italic) FontStyle.Italic else null, textDecoration = deco,
            color = readable(r.color) ?: Color.Unspecified, fontSize = (r.sizePt ?: base)?.coerceIn(9f, 40f)?.sp ?: androidx.compose.ui.unit.TextUnit.Unspecified,
        )) { append(r.text) }
    }
}

@Composable
private fun ParaView(p: DocPara, inCell: Boolean = false) {
    val c = MaterialTheme.sd
    if (p.runs.isEmpty() && p.label == null) { Spacer(Modifier.height(if (inCell) 2.dp else 8.dp)); return }
    val (size, bold) = when (p.heading) { 7 -> 26f to true; 1 -> 22f to true; 2 -> 19f to true; 3 -> 17f to true; in 4..6 -> 15f to true; else -> null to false }
    val align = when (p.align) { "center" -> TextAlign.Center; "right" -> TextAlign.End; "justify" -> TextAlign.Justify; else -> TextAlign.Start }
    val text = remember(p) { styled(p, size, bold) }
    val top = if (p.heading > 0 && !inCell) 10.dp else 0.dp
    Row(Modifier.fillMaxWidth().padding(top = top, bottom = if (inCell) 0.dp else 6.dp, start = (p.level * 20 + (if (p.label == null) p.indentPt.coerceAtMost(80f) else 0f)).dp)) {
        if (p.label != null) Text(p.label, Modifier.width(26.dp), style = MaterialTheme.typography.bodyLarge, color = c.muted)
        Text(text, Modifier.weight(1f), style = if (p.heading > 0) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyLarge, textAlign = align, color = if (p.heading > 0) c.ink else Color.Unspecified)
    }
}

@Composable
private fun TableView(t: DocTable) {
    val c = MaterialTheme.sd
    val cols = t.rows.maxOfOrNull { it.size } ?: 0
    if (cols == 0) return
    val wide = cols > 3
    Column(Modifier.padding(vertical = 8.dp).then(if (wide) Modifier.horizontalScroll(rememberScrollState()) else Modifier).border(1.dp, c.lineStrong)) {
        t.rows.forEach { row ->
            Row {
                for (i in 0 until cols) {
                    val cell = row.getOrNull(i).orEmpty()
                    Column(Modifier.then(if (wide) Modifier.width(130.dp) else Modifier.weight(1f)).border(0.5.dp, c.line).padding(6.dp), verticalArrangement = Arrangement.Top) { cell.forEach { ParaView(it, inCell = true) } }
                }
            }
        }
    }
}

@Composable
private fun PictureView(img: DocImage) {
    // Decoded down to roughly screen size so a large photo in the document cannot exhaust memory.
    val bmp by produceState<android.graphics.Bitmap?>(null, img) {
        value = withContext(Dispatchers.Default) {
            runCatching {
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(img.bytes, 0, img.bytes.size, o)
                var s = 1; while (o.outWidth / s > 1600) s *= 2
                BitmapFactory.decodeByteArray(img.bytes, 0, img.bytes.size, BitmapFactory.Options().apply { inSampleSize = s })
            }.getOrNull()
        }
    }
    bmp?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxWidth().padding(vertical = 8.dp), contentScale = ContentScale.FillWidth) }
}

/** A Word file ready to show: the file itself (for the web view) and what the native reader made of it (the fallback). */
class DocxSource(val file: java.io.File, val blocks: List<DocBlock>)

private const val DOCX_HOST = "appassets.local"

/**
 * Word documents are drawn by the same engine as the website (docx-preview, shipped inside the app), so they look the same on both. It runs in a web view that
 * can only see the app's own files: every request is answered from the app's assets or the document itself, anything else is refused, links do not open,
 * and there is no bridge to the app. If the page cannot draw the file, or nothing happens for a while, [onFail] switches to the native reader.
 */
@android.annotation.SuppressLint("SetJavaScriptEnabled")
@Composable
fun DocxWebView(source: DocxSource, onFail: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var ready by androidx.compose.runtime.remember(source) { androidx.compose.runtime.mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(source) { kotlinx.coroutines.delay(20_000); if (!ready) onFail() }
    Box(Modifier.fillMaxSize()) {
        androidx.compose.ui.viewinterop.AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                try {
                    android.webkit.WebView(ctx).apply {
                        setBackgroundColor(0xFFE4E8EF.toInt())
                        settings.javaScriptEnabled = true
                        settings.allowFileAccess = false; settings.allowContentAccess = false; settings.domStorageEnabled = false; settings.databaseEnabled = false
                        settings.setGeolocationEnabled(false); settings.javaScriptCanOpenWindowsAutomatically = false; settings.setSupportMultipleWindows(false)
                        settings.setSupportZoom(true); settings.builtInZoomControls = true; settings.displayZoomControls = false
                        // Layout width = screen width, so the page can be scaled to fit it exactly (a "wide viewport" would make the layout wider than the screen).
                        settings.useWideViewPort = false; settings.loadWithOverviewMode = false
                        webViewClient = object : android.webkit.WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: android.webkit.WebView, request: android.webkit.WebResourceRequest) = true
                            override fun shouldInterceptRequest(view: android.webkit.WebView, request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
                                val u = request.url
                                val name = u.lastPathSegment.orEmpty()
                                if (u.host == DOCX_HOST && u.scheme == "https") {
                                    if (name == "doc.docx") return android.webkit.WebResourceResponse("application/octet-stream", null, 200, "OK", mapOf("Cache-Control" to "no-store"), java.io.FileInputStream(source.file))
                                    if (name == "viewer.html" || name == "jszip.min.js" || name == "docx-preview.min.js") {
                                        val type = if (name.endsWith(".html")) "text/html" else "text/javascript"
                                        return android.webkit.WebResourceResponse(type, "utf-8", ctx.assets.open("docx/$name"))
                                    }
                                }
                                // Everything else, including any attempt to reach the network, is refused.
                                return android.webkit.WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
                            }
                        }
                        webChromeClient = object : android.webkit.WebChromeClient() {
                            override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                                val text = m.message().orEmpty()
                                if (text == "DOCX_OK") post { ready = true } else if (text.startsWith("DOCX_FAIL")) post { onFail() }
                                return true
                            }
                        }
                        loadUrl("https://$DOCX_HOST/docx/viewer.html")
                    }
                } catch (e: Throwable) {
                    // No usable web view on this device: the native reader takes over.
                    android.view.View(ctx).also { it.post { onFail() } }
                }
            },
            onRelease = { (it as? android.webkit.WebView)?.apply { stopLoading(); loadUrl("about:blank"); destroy() } },
        )
        if (!ready) Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) { androidx.compose.material3.CircularProgressIndicator() }
    }
}
