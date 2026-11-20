package app.superdrive.core

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.buffer
import okio.source

data class UploadProgress(val done: Int, val total: Int, val name: String, val percent: Int)
@Serializable private data class UploadDto(val id: String = "", val status: String = "", val errorMessage: String? = null, val offset: Long = 0, val chunkSize: Long = 0)

/** Sends files picked from the phone to the server with the same resumable upload API the website uses. */
class Uploader(private val context: Context, private val api: Api) {
    private class Source(val uri: Uri, val name: String, val size: Long, val parentId: String)

    private fun describe(uri: Uri, parentId: String): Source {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "berkas"; var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) { c.getString(0)?.let { name = it }; size = c.getLong(1) } }
        return Source(uri, name, size, parentId)
    }

    /** Returns how many files went up. A failure stops the batch and is thrown with a message for the person. */
    suspend fun upload(storageId: String, parentId: String, uris: List<Uri>, onProgress: (UploadProgress) -> Unit): Int =
        track(onProgress) { cb -> run(storageId, withContext(Dispatchers.IO) { uris.map { describe(it, parentId) } }, cb) }

    /** Sends a whole folder picked with the system folder picker, keeping its structure of subfolders. */
    suspend fun uploadFolder(storageId: String, parentId: String, tree: Uri, onProgress: (UploadProgress) -> Unit): Int =
        track(onProgress) { cb ->
            folderCache.clear()
            val jobs = withContext(Dispatchers.IO) { collect(storageId, parentId, tree) }
            if (jobs.isEmpty()) throw ApiException(0, "EMPTY", "Folder ini tidak berisi file.")
            run(storageId, jobs, cb)
        }

    private suspend fun track(onProgress: (UploadProgress) -> Unit, block: suspend ((UploadProgress) -> Unit) -> Int): Int {
        // A foreground service keeps the app alive and shows progress in the notification shade while files go up.
        try { androidx.core.content.ContextCompat.startForegroundService(context, android.content.Intent(context, app.superdrive.TransferService::class.java).putExtra("title", "Mengunggah").putExtra("text", "").putExtra("percent", -1)) } catch (_: Exception) {}
        var last = -1
        val nm = context.getSystemService(android.app.NotificationManager::class.java)
        try {
            val n = block { p ->
                onProgress(p)
                val shown = p.done * 100 + p.percent
                if (shown != last) { last = shown; try { nm.notify(app.superdrive.Notifier.PROGRESS_ID, app.superdrive.Notifier.progress(context, "Mengunggah ${p.done + 1}/${p.total}", p.name, p.percent)) } catch (_: Exception) {} }
            }
            try { nm.notify(app.superdrive.Notifier.DONE_ID, app.superdrive.Notifier.done(context, "Unggahan selesai", if (n == 1) "1 file terunggah" else "$n file terunggah")) } catch (_: Exception) {}
            return n
        } finally { context.stopService(android.content.Intent(context, app.superdrive.TransferService::class.java)) }
    }

    private val folderCache = HashMap<String, String>()
    private suspend fun ensureFolder(storageId: String, parentId: String, name: String): String {
        folderCache["$parentId/$name"]?.let { return it }
        val id = try {
            api.post<FileEntry>("/files/folders", buildJsonObject { put("storageId", storageId); put("parentId", parentId); put("name", name) }).id
        } catch (e: ApiException) {
            if (e.status != 409) throw e
            var token: String? = null; var found: String? = null
            do {
                val page = api.get<FileListing>("/files?storageId=$storageId&folderId=${java.net.URLEncoder.encode(parentId, "UTF-8")}&limit=1000" + (token?.let { "&pageToken=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""))
                found = page.items.firstOrNull { it.isFolder && it.name == name }?.id; token = page.nextPageToken
            } while (found == null && token != null)
            found ?: throw e
        }
        folderCache["$parentId/$name"] = id; return id
    }

    /** Walks the picked folder, creating the matching folders on the server, and lists every file to send. */
    private suspend fun collect(storageId: String, parentId: String, tree: Uri): List<Source> {
        val cr = context.contentResolver
        val rootId = android.provider.DocumentsContract.getTreeDocumentId(tree)
        val rootName = cr.query(android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, rootId), arrayOf(android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "Folder"
        val out = ArrayList<Source>()
        suspend fun walk(docId: String, folderId: String) {
            class Row(val id: String, val name: String, val mime: String, val size: Long)
            val rows = ArrayList<Row>()
            val cols = arrayOf(android.provider.DocumentsContract.Document.COLUMN_DOCUMENT_ID, android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME, android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE, android.provider.DocumentsContract.Document.COLUMN_SIZE)
            cr.query(android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId), cols, null, null, null)?.use { c ->
                while (c.moveToNext()) rows.add(Row(c.getString(0), c.getString(1) ?: "berkas", c.getString(2) ?: "", if (c.isNull(3)) -1L else c.getLong(3)))
            }
            for (r in rows) {
                if (r.mime == android.provider.DocumentsContract.Document.MIME_TYPE_DIR) walk(r.id, ensureFolder(storageId, folderId, r.name))
                else out.add(Source(android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, r.id), r.name, r.size, folderId))
            }
        }
        walk(rootId, ensureFolder(storageId, parentId, rootName))
        return out
    }

    private suspend fun run(storageId: String, sources: List<Source>, onProgress: (UploadProgress) -> Unit): Int = withContext(Dispatchers.IO) {
        var done = 0
        for ((i, s0) in sources.withIndex()) {
            val size = if (s0.size >= 0) s0.size else try { context.contentResolver.openFileDescriptor(s0.uri, "r")?.use { it.statSize } ?: -1L } catch (e: Exception) { -1L }
            if (size < 0) throw ApiException(0, "UNKNOWN_SIZE", "Ukuran “${s0.name}” tidak diketahui.")
            val src = Source(s0.uri, s0.name, size, s0.parentId)
            onProgress(UploadProgress(done, sources.size, src.name, 0))
            val created = api.post<UploadDto>("/uploads", buildJsonObject { put("storageId", storageId); put("parentId", src.parentId); put("name", src.name); put("size", src.size); put("conflictPolicy", "RENAME") })
            if (src.size > 0) send(created.id, src, created.offset, created.chunkSize) { sent -> onProgress(UploadProgress(done, sources.size, src.name, if (src.size > 0) (sent * 100 / src.size).toInt() else 100)) }
            // handing the bytes on to the storage can take a moment for cloud storages
            var status = if (src.size == 0L) "FINALIZING" else api.get<UploadDto>("/uploads/${created.id}").status
            var waited = 0
            while (status == "FINALIZING" && waited < 120) { delay(1000); waited++; status = api.get<UploadDto>("/uploads/${created.id}").status }
            if (status == "FAILED") throw ApiException(0, "UPLOAD_FAILED", "Gagal mengunggah “${src.name}”.")
            done = i + 1
            onProgress(UploadProgress(done, sources.size, src.name, 100))
        }
        done
    }

    /** Sends the file in pieces (a proxy may refuse one huge request), retrying a piece when the connection drops. */
    private fun send(id: String, src: Source, start: Long, chunk: Long, onSent: (Long) -> Unit) {
        val piece = (if (chunk > 0) minOf(chunk, 8L * 1024 * 1024) else 8L * 1024 * 1024).coerceAtLeast(256L * 1024)
        var offset = start
        while (offset < src.size) {
            val from = offset; val len = minOf(piece, src.size - from)
            var attempt = 0
            while (true) {
                val stream = context.contentResolver.openInputStream(src.uri) ?: throw ApiException(0, "UNREADABLE", "Tidak dapat membaca “${src.name}”.")
                val source = stream.source().buffer()
                try {
                    source.skip(from)
                    val body = object : RequestBody() {
                        override fun contentType() = "application/octet-stream".toMediaType()
                        override fun contentLength() = len
                        override fun writeTo(sink: BufferedSink) {
                            var left = len; val buf = okio.Buffer()
                            while (left > 0) { val n = source.read(buf, minOf(256L * 1024, left)); if (n < 0) throw java.io.EOFException("File berubah saat dibaca"); sink.write(buf, n); left -= n; onSent(from + len - left) }
                        }
                    }
                    api.http.newCall(Request.Builder().url(api.url("/uploads/$id")).header("Upload-Offset", from.toString()).patch(body).build()).execute().use { res ->
                        if (!res.isSuccessful) throw ApiException(res.code, "UPLOAD_FAILED", if (res.code == 413) "Server menolak ukuran unggahan (HTTP 413)." else "Server menolak unggahan (HTTP ${res.code}).")
                    }
                    break
                } catch (e: java.io.IOException) {
                    if (++attempt >= 3) throw ApiException(0, "NETWORK", "Unggahan terputus. Periksa koneksi Anda.")
                    Thread.sleep(1500L * attempt)
                } finally { try { source.close() } catch (_: Exception) {}; try { stream.close() } catch (_: Exception) {} }
            }
            offset = from + len
        }
    }
}
