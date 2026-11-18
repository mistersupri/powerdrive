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
import okio.source

data class UploadProgress(val done: Int, val total: Int, val name: String, val percent: Int)
@Serializable private data class UploadDto(val id: String = "", val status: String = "", val errorMessage: String? = null)

/** Sends files picked from the phone to the server with the same resumable upload API the website uses. */
class Uploader(private val context: Context, private val api: Api) {
    private class Source(val uri: Uri, val name: String, val size: Long)

    private fun describe(uri: Uri): Source {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "berkas"; var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst()) { c.getString(0)?.let { name = it }; size = c.getLong(1) } }
        return Source(uri, name, size)
    }

    /** Returns how many files went up. A failure stops the batch and is thrown with a message for the person. */
    suspend fun upload(storageId: String, parentId: String, uris: List<Uri>, onProgress: (UploadProgress) -> Unit): Int = withContext(Dispatchers.IO) {
        var done = 0
        for ((i, uri) in uris.withIndex()) {
            val src = describe(uri)
            if (src.size < 0) throw ApiException(0, "UNKNOWN_SIZE", "Ukuran “${src.name}” tidak diketahui.")
            onProgress(UploadProgress(done, uris.size, src.name, 0))
            val created = api.post<UploadDto>("/uploads", buildJsonObject { put("storageId", storageId); put("parentId", parentId); put("name", src.name); put("size", src.size); put("conflictPolicy", "RENAME") })
            if (src.size > 0) send(created.id, src) { sent -> onProgress(UploadProgress(done, uris.size, src.name, if (src.size > 0) (sent * 100 / src.size).toInt() else 100)) }
            // handing the bytes on to the storage can take a moment for cloud storages
            var status = if (src.size == 0L) "FINALIZING" else api.get<UploadDto>("/uploads/${created.id}").status
            var waited = 0
            while (status == "FINALIZING" && waited < 120) { delay(1000); waited++; status = api.get<UploadDto>("/uploads/${created.id}").status }
            if (status == "FAILED") throw ApiException(0, "UPLOAD_FAILED", "Gagal mengunggah “${src.name}”.")
            done = i + 1
            onProgress(UploadProgress(done, uris.size, src.name, 100))
        }
        done
    }

    private fun send(id: String, src: Source, onSent: (Long) -> Unit) {
        val stream = context.contentResolver.openInputStream(src.uri) ?: throw ApiException(0, "UNREADABLE", "Tidak dapat membaca “${src.name}”.")
        val body = object : RequestBody() {
            override fun contentType() = "application/octet-stream".toMediaType()
            override fun contentLength() = src.size
            override fun writeTo(sink: BufferedSink) {
                var total = 0L; val buf = okio.Buffer(); val s = stream.source()
                while (true) { val n = s.read(buf, 256 * 1024); if (n < 0) break; sink.write(buf, n); total += n; onSent(total) }
            }
        }
        try {
            api.http.newCall(Request.Builder().url(api.url("/uploads/$id")).header("Upload-Offset", "0").patch(body).build()).execute().use { res -> if (!res.isSuccessful) throw ApiException(res.code, "UPLOAD_FAILED", "Server menolak unggahan (HTTP ${res.code}).") }
        } catch (e: java.io.IOException) { throw ApiException(0, "NETWORK", "Unggahan terputus. Periksa koneksi Anda.") } finally { stream.close() }
    }
}
