package app.superdrive.ui.files

import android.graphics.Bitmap
import android.graphics.Color as AColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.DocKind
import app.superdrive.core.FileEntry
import app.superdrive.core.docKind
import app.superdrive.core.docxForViewer
import app.superdrive.core.parseCsv
import app.superdrive.core.xlsxRows
import app.superdrive.core.zipEntries
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File

private const val TEXT_LIMIT = 2L * 1024 * 1024
private const val DOC_LIMIT = 40L * 1024 * 1024

/** Downloads a file with the signed-in session into the app cache. Refuses anything bigger than [max]. */
private suspend fun fetch(api: Api, f: FileEntry, dir: File, max: Long): File = withContext(Dispatchers.IO) {
    if ((f.size ?: 0) > max) throw ApiException(0, "TOO_BIG", "Berkas terlalu besar untuk dipratinjau di aplikasi. Unduh saja.")
    val out = File(dir, "view_${f.storageId}_${f.id}".replace(Regex("[^A-Za-z0-9_-]"), "_"))
    try {
        api.http.newCall(Request.Builder().url(api.download(f)).build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, "FETCH", "Gagal memuat berkas (HTTP ${res.code}).")
            res.body!!.byteStream().use { i -> out.outputStream().use { o -> i.copyTo(o) } }
        }
    } catch (e: java.io.IOException) { throw ApiException(0, "NETWORK", "Gagal memuat berkas. Periksa koneksi Anda.") }
    out
}

private class PdfDoc(file: File) : AutoCloseable {
    private val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer = try { PdfRenderer(fd) } catch (e: Throwable) { fd.close(); throw e }
    /** Read once: asking a closed renderer for its page count throws. */
    val count: Int = renderer.pageCount
    private var closed = false

    /** Null when the document was closed meanwhile or the page cannot be drawn; never throws. */
    @Synchronized fun render(index: Int, widthPx: Int): Bitmap? {
        if (closed || index !in 0 until count) return null
        return try {
            renderer.openPage(index).use { page ->
                val ratio = page.height.toFloat() / page.width.coerceAtLeast(1)
                // A very tall page must not ask for hundreds of megabytes.
                val w = minOf(widthPx, (6_000_000f / (4f * ratio.coerceAtLeast(0.1f))).let { Math.sqrt(it.toDouble()).toInt() * 2 }.coerceAtLeast(200))
                val h = (w * ratio).toInt().coerceIn(1, 8000)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); bmp.eraseColor(AColor.WHITE)
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bmp
            }
        } catch (e: Throwable) { null }
    }

    @Synchronized override fun close() { if (closed) return; closed = true; try { renderer.close() } catch (_: Throwable) {}; try { fd.close() } catch (_: Throwable) {} }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentViewer(f: FileEntry, api: Api, onClose: () -> Unit, onDownload: () -> Unit) {
    BackHandler(onBack = onClose)
    // Word, Excel and PowerPoint files that live in Google Drive can be opened in Google's editors.
    val context = androidx.compose.ui.platform.LocalContext.current
    var googleUrl by androidx.compose.runtime.remember(f.id) { androidx.compose.runtime.mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(f.id) {
        if (app.superdrive.core.googleEditorLabel(f) != null) googleUrl = try { app.superdrive.core.FileOps(api).driveInfo(f).editUrl } catch (_: Exception) { null }
    }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            app.superdrive.ui.design.PageHeader(f.name, subtitle = listOfNotNull(f.size?.let { android.text.format.Formatter.formatShortFileSize(androidx.compose.ui.platform.LocalContext.current, it) }, f.mimeType).joinToString(" · ").ifEmpty { null },
                leading = { app.superdrive.ui.design.BarIcon(app.superdrive.ui.design.Lu.Back, "Tutup", onClose, tint = MaterialTheme.colorScheme.onSurface) }) {
                googleUrl?.let { u -> app.superdrive.ui.design.BarIcon(app.superdrive.ui.design.Lu.Link, "Buka di ${app.superdrive.core.googleEditorLabel(f) ?: "Google"}", { try { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(u))) } catch (_: Exception) { } }, tint = MaterialTheme.colorScheme.primary) }
                app.superdrive.ui.design.BarIcon(app.superdrive.ui.design.Lu.Download, "Unduh", onDownload, tint = MaterialTheme.colorScheme.primary)
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (val kind = docKind(f.name, f.mimeType)) {
                DocKind.Pdf -> PdfBody(f, api)
                DocKind.Text, DocKind.Csv, DocKind.Docx, DocKind.Xlsx, DocKind.Zip -> TextualBody(f, api, kind)
                else -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Pratinjau untuk jenis berkas ini belum tersedia.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = onDownload, modifier = Modifier.padding(top = 16.dp)) { Text("Unduh") }
                }
            }
        }
    }
}

@Composable
private fun Loading(text: String? = null) = Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { if (text == null) CircularProgressIndicator() else Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant) }

@Composable
private fun PdfBody(f: FileEntry, api: Api) {
    val context = LocalContext.current
    val widthPx = with(LocalDensity.current) { (context.resources.displayMetrics.widthPixels).coerceAtMost(1600) }
    val doc by produceState<Result<PdfDoc>?>(null, f.id) {
        value = try { Result.success(PdfDoc(fetch(api, f, context.cacheDir, DOC_LIMIT))) } catch (e: Throwable) { Result.failure(e) }
    }
    // Close exactly the document this effect was started for. (Reading `doc` inside onDispose would close the newly loaded one.)
    val loaded = doc?.getOrNull()
    DisposableEffect(loaded) { onDispose { loaded?.close() } }
    val d = doc
    when {
        d == null -> Loading()
        d.isFailure -> Loading(d.exceptionOrNull()?.let { if (it is ApiException) it.message else "PDF ini tidak dapat dibuka (rusak atau dilindungi kata sandi)." } ?: "PDF ini tidak dapat dibuka.")
        loaded == null || loaded.count == 0 -> Loading("PDF ini tidak memiliki halaman.")
        else -> {
            val pdf = loaded
            LazyColumn(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                items(pdf.count, key = { it }) { i ->
                    val bmp by produceState<Bitmap?>(null, i) { value = withContext(Dispatchers.Default) { pdf.render(i, widthPx) } }
                    val b = bmp
                    if (b == null) Box(Modifier.fillMaxWidth().aspectRatio(0.707f).background(Color.White), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else Image(b.asImageBitmap(), contentDescription = "Halaman ${i + 1}", contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun TextualBody(f: FileEntry, api: Api, kind: DocKind) {
    val context = LocalContext.current
    val content by produceState<Result<Any>?>(null, f.id) {
        value = try {
            val file = fetch(api, f, context.cacheDir, if (kind == DocKind.Text || kind == DocKind.Csv) TEXT_LIMIT else DOC_LIMIT)
            withContext(Dispatchers.Default) {
                Result.success<Any>(when (kind) {
                    DocKind.Docx -> DocxSource(file, docxForViewer(file.readBytes())); DocKind.Xlsx -> xlsxRows(file.readBytes()); DocKind.Zip -> zipEntries(file.readBytes())
                    DocKind.Csv -> parseCsv(file.readText()); else -> file.readText()
                })
            }
        } catch (e: ApiException) { Result.failure(e) } catch (e: Throwable) { Result.failure(ApiException(0, "PARSE", "Berkas ini tidak dapat dibaca.")) }
    }
    val c = content
    when {
        c == null -> Loading()
        c.isFailure -> Loading(c.exceptionOrNull()?.message ?: "Gagal.")
        else -> when (val v = c.getOrThrow()) {
            is DocxSource -> {
                // The website's engine first; the native reader when it cannot draw the file.
                var native by androidx.compose.runtime.remember(v) { androidx.compose.runtime.mutableStateOf(false) }
                if (native) DocxView(v.blocks) else DocxWebView(v) { native = true }
            }
            is String -> SelectionContainer { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(12.dp)) { Text(v, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall) } }
            is List<*> -> when (kind) {
                DocKind.Zip -> LazyColumn(Modifier.fillMaxSize()) {
                    items(v.filterIsInstance<app.superdrive.core.ZipItem>()) { z ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) { Text(z.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis); if (!z.isDir) Text(android.text.format.Formatter.formatShortFileSize(context, z.size), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                else -> { // CSV and spreadsheets: a grid that scrolls both ways
                    @Suppress("UNCHECKED_CAST") val rows = v as List<List<String>>
                    Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
                        LazyColumn { itemsIndexed(rows) { i, r ->
                            Row(Modifier.background(if (i == 0) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)) { r.forEach { cell -> Text(cell, Modifier.width(140.dp).padding(8.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) } }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        } }
                    }
                }
            }
        }
    }
}
