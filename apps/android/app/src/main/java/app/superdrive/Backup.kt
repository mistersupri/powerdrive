package app.superdrive

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.buffer
import okio.source
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Settings and progress of the automatic photo backup. Lives on this phone only. */
object BackupStore {
    private fun p(c: Context) = c.getSharedPreferences("superdrive", Context.MODE_PRIVATE)
    fun enabled(c: Context) = p(c).getBoolean("bk_enabled", false)
    fun wifiOnly(c: Context) = p(c).getBoolean("bk_wifi", true)
    fun videos(c: Context) = p(c).getBoolean("bk_videos", true)
    /** Include what is already on the phone, not only photos taken from now on. */
    fun existing(c: Context) = p(c).getBoolean("bk_existing", true)
    fun since(c: Context) = p(c).getLong("bk_since", 0L)
    /** Gallery albums (device folders) chosen for backup; null means every album. */
    fun albums(c: Context): Set<String>? = p(c).getString("bk_albums", null)?.let { raw -> org.json.JSONArray(raw).let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } }
    fun setAlbums(c: Context, ids: Collection<String>?) { p(c).edit().apply { if (ids == null) remove("bk_albums") else putString("bk_albums", org.json.JSONArray(ids.toList()).toString()) }.apply() }

    fun save(c: Context, enabled: Boolean, wifiOnly: Boolean, videos: Boolean, existing: Boolean) {
        val was = enabled(c)
        p(c).edit().putBoolean("bk_enabled", enabled).putBoolean("bk_wifi", wifiOnly).putBoolean("bk_videos", videos).putBoolean("bk_existing", existing)
            .apply { if (enabled && !was) putLong("bk_since", System.currentTimeMillis() / 1000).remove("bk_error") }.apply()
    }
    fun record(c: Context, uploaded: Int, error: String?) {
        p(c).edit().putLong("bk_last_run", System.currentTimeMillis()).putInt("bk_last_count", uploaded).apply { if (error == null) remove("bk_error") else putString("bk_error", error) }.apply()
    }
    fun running(c: Context, on: Boolean) { p(c).edit().putBoolean("bk_running", on).apply(); if (!on) p(c).edit().remove("bk_p_done").remove("bk_p_total").remove("bk_p_name").remove("bk_p_pct").apply() }
    /** What the running backup is doing right now, for the settings page. */
    fun setProgress(c: Context, done: Int, total: Int, name: String, percent: Int) { p(c).edit().putInt("bk_p_done", done).putInt("bk_p_total", total).putString("bk_p_name", name).putInt("bk_p_pct", percent).apply() }
    class Progress(val done: Int, val total: Int, val name: String, val percent: Int)
    fun progress(c: Context): Progress? = p(c).takeIf { it.getBoolean("bk_running", false) && it.getInt("bk_p_total", 0) > 0 }?.let { Progress(it.getInt("bk_p_done", 0), it.getInt("bk_p_total", 0), it.getString("bk_p_name", "") ?: "", it.getInt("bk_p_pct", 0)) }

    /** Why a backup cannot start right now (no network, or Wi-Fi only on mobile data); null when it can. */
    fun networkBlocked(c: Context): String? {
        val cm = c.getSystemService(android.net.ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "Tidak ada koneksi internet."
        if (!caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)) return "Tidak ada koneksi internet."
        if (wifiOnly(c) && !caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return "Menunggu Wi-Fi. Matikan “Hanya lewat Wi-Fi” untuk mencadangkan lewat data seluler."
        return null
    }

    fun hasPermission(c: Context): Boolean {
        fun ok(perm: String) = ContextCompat.checkSelfPermission(c, perm) == PackageManager.PERMISSION_GRANTED
        return when {
            Build.VERSION.SDK_INT >= 34 -> ok(Manifest.permission.READ_MEDIA_IMAGES) || ok(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            Build.VERSION.SDK_INT >= 33 -> ok(Manifest.permission.READ_MEDIA_IMAGES)
            else -> ok(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }
    fun permissionsToAsk(): Array<String> = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED, Manifest.permission.POST_NOTIFICATIONS)
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.POST_NOTIFICATIONS)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    fun state(c: Context): JSONObject = JSONObject()
        .put("enabled", enabled(c)).put("allAlbums", albums(c) == null).put("albumCount", albums(c)?.size ?: 0).put("wifiOnly", wifiOnly(c)).put("videos", videos(c)).put("existing", existing(c))
        .put("permission", hasPermission(c)).put("running", p(c).getBoolean("bk_running", false))
        .put("lastRun", p(c).getLong("bk_last_run", 0L)).put("lastCount", p(c).getInt("bk_last_count", 0)).put("error", p(c).getString("bk_error", null) ?: JSONObject.NULL)
        .put("pending", if (enabled(c) && hasPermission(c)) try { BackupWorker.pending(c) } catch (e: Exception) { 0 } else 0)
}

/** Remembers which photos are already safe on the server, so nothing is sent twice. */
class BackupDb(context: Context) : SQLiteOpenHelper(context, "backup.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) { db.execSQL("CREATE TABLE done (kind TEXT NOT NULL, id INTEGER NOT NULL, PRIMARY KEY (kind, id))") }
    override fun onUpgrade(db: SQLiteDatabase, o: Int, n: Int) {}
    fun all(): HashSet<String> {
        val out = HashSet<String>()
        readableDatabase.rawQuery("SELECT kind, id FROM done", null).use { while (it.moveToNext()) out.add("${it.getString(0)}:${it.getLong(1)}") }
        return out
    }
    fun mark(kind: String, id: Long) { writableDatabase.insertWithOnConflict("done", null, ContentValues().apply { put("kind", kind); put("id", id) }, SQLiteDatabase.CONFLICT_IGNORE) }
}

object BackupScheduler {
    private fun net(c: Context) = if (BackupStore.wifiOnly(c)) NetworkType.UNMETERED else NetworkType.CONNECTED
    private fun base(c: Context) = Constraints.Builder().setRequiredNetworkType(net(c)).build()

    /** Applies the settings: schedule while on, cancel everything while off. */
    fun apply(c: Context) {
        val wm = WorkManager.getInstance(c)
        if (!BackupStore.enabled(c)) { wm.cancelUniqueWork("backup-periodic"); wm.cancelUniqueWork("backup-trigger"); wm.cancelUniqueWork("backup-now"); return }
        wm.enqueueUniquePeriodicWork("backup-periodic", ExistingPeriodicWorkPolicy.UPDATE, PeriodicWorkRequest.Builder(BackupWorker::class.java, 12, TimeUnit.HOURS).setConstraints(base(c)).build())
        arm(c, ExistingWorkPolicy.KEEP)
    }

    /** Runs when the gallery changes (a new photo), a few seconds after the last change. */
    fun arm(c: Context, policy: ExistingWorkPolicy) {
        val cons = Constraints.Builder().setRequiredNetworkType(net(c))
            .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true).addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
            .setTriggerContentUpdateDelay(15, TimeUnit.SECONDS).setTriggerContentMaxDelay(2, TimeUnit.MINUTES).build()
        val req = OneTimeWorkRequest.Builder(BackupWorker::class.java).setConstraints(cons).setInputData(Data.Builder().putBoolean("trigger", true).build()).build()
        WorkManager.getInstance(c).enqueueUniqueWork("backup-trigger", policy, req)
    }

    /** Starts a backup right now in a foreground service (the person just asked for it, so the app is on screen). */
    fun now(c: Context) {
        try { ContextCompat.startForegroundService(c, android.content.Intent(c, BackupService::class.java)); return } catch (e: Exception) { /* fall back to the scheduler */ }
        val req = OneTimeWorkRequest.Builder(BackupWorker::class.java).setConstraints(base(c)).setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST).build()
        WorkManager.getInstance(c).enqueueUniqueWork("backup-now", ExistingWorkPolicy.KEEP, req)
    }
}

class Item(val kind: String, val id: Long, val uri: Uri, val name: String, val size: Long, val mime: String, val bucket: String, val taken: Long)
internal const val BACKUP_NOTIF_ID = 1003
internal const val BACKUP_DONE_ID = 1004

/** The backup itself. Both the background worker and the "Cadangkan sekarang" button run this same code. */
class BackupRun(private val ctx: Context, private val stopped: () -> Boolean, private val report: (title: String, text: String, percent: Int) -> Unit) {
    private class SessionExpired : Exception()

    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(5, TimeUnit.MINUTES).writeTimeout(5, TimeUnit.MINUTES).build()
    private val json = "application/json".toMediaType()
    private var base = ""; private var cookie = ""; private var workspace = ""

    /** Runs one backup pass. True when it is finished (nothing to retry), false when it should be tried again later. */
    fun run(): Boolean {
        if (!BackupStore.enabled(ctx)) return true
        if (!BackupStore.hasPermission(ctx)) { BackupStore.record(ctx, 0, "Izin akses foto belum diberikan."); return true }
        BackupStore.networkBlocked(ctx)?.let { BackupStore.record(ctx, 0, it); return true }
        BackupStore.running(ctx, true)
        var uploaded = 0
        // Show the notification straight away: scanning a big gallery can take a while.
        report(ctx.getString(R.string.backup_title), "Memeriksa galeri…", -1)
        try {
            base = ServerStore.url(ctx) ?: return true
            cookie = app.superdrive.core.PrefsCookies(ctx).get(base) ?: throw SessionExpired()
            val me = get("/api/v1/auth/me"); workspace = me.getJSONObject("data").optString("activeWorkspaceId")
            val storages = get("/api/v1/storages").getJSONArray("data")
            var storageId = ""
            for (i in 0 until storages.length()) { val s = storages.getJSONObject(i); if (s.optBoolean("isDefault")) storageId = s.getString("id") }
            if (storageId.isEmpty()) throw IllegalStateException("Penyimpanan bawaan tidak ditemukan")

            val todo = BackupWorker.pendingItems(ctx)
            if (todo.isEmpty()) { BackupStore.record(ctx, 0, null); return true }
            BackupStore.setProgress(ctx, 0, todo.size, "", 0)
            report(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, 0, todo.size), 0)
            val db = BackupDb(ctx); val folders = HashMap<String, String>()
            val root = ensureFolder(storageId, "root", "Cadangan Foto", folders)
            val device = ensureFolder(storageId, root, Build.MODEL.replace(Regex("[/\\\\]"), "_").trim().ifEmpty { "Perangkat" }.take(60), folders)
            var failed = 0; var consecutive = 0; var lastError = ""
            for ((i, it) in todo.withIndex()) {
                if (stopped()) break
                val bucket = it.bucket.replace(Regex("[/\\\\]"), "_").trim().ifEmpty { "Lainnya" }.take(80)
                val parent = ensureFolder(storageId, device, bucket, folders)
                var lastTick = 0L
                val ok = try { send(storageId, parent, it) { sent ->
                    val now = System.currentTimeMillis()
                    if (now - lastTick > 800) {
                        lastTick = now
                        val pct = (((i + (if (it.size > 0) sent.toDouble() / it.size else 1.0)) * 100) / todo.size).toInt().coerceIn(0, 100)
                        BackupStore.setProgress(ctx, i, todo.size, it.name, pct)
                        report(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, i + 1, todo.size) + " · " + it.name, pct)
                    }
                } } catch (e: SessionExpired) { throw e } catch (e: Exception) {
                    failed++; consecutive++; lastError = e.message ?: e.javaClass.simpleName
                    if (consecutive >= 3) break // probably the connection or the server: stop and try again later instead of waiting on every file
                    false
                }
                if (ok) { db.mark(it.kind, it.id); uploaded++; consecutive = 0 }
                val pctDone = ((i + 1) * 100) / todo.size
                BackupStore.setProgress(ctx, i + 1, todo.size, it.name, pctDone)
                report(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, i + 1, todo.size), pctDone)
            }
            val problem = if (failed > 0) "$failed file gagal diunggah ($lastError). Ketuk “Cadangkan sekarang” untuk mencoba lagi." else null
            BackupStore.record(ctx, uploaded, problem)
            if (uploaded > 0) ctx.getSystemService(android.app.NotificationManager::class.java).notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_done_title), ctx.getString(R.string.backup_done_text, uploaded) + if (failed > 0) " · $failed gagal" else ""))
            else if (failed > 0) ctx.getSystemService(android.app.NotificationManager::class.java).notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), problem!!))
            return consecutive < 3
        } catch (e: SessionExpired) {
            BackupStore.record(ctx, uploaded, ctx.getString(R.string.backup_signed_out))
            ctx.getSystemService(android.app.NotificationManager::class.java).notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_signed_out)))
            return true
        } catch (e: Exception) {
            BackupStore.record(ctx, uploaded, e.message ?: e.javaClass.simpleName)
            if (uploaded > 0) ctx.getSystemService(android.app.NotificationManager::class.java).notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), "$uploaded file tercadangkan, sisanya dilanjutkan nanti (${e.message ?: "koneksi terputus"})"))
            return false // the next attempt continues where this one stopped: sent photos are remembered
        } finally {
            BackupStore.running(ctx, false)
        }
    }

    /* ---- the server ---- */
    private fun req(path: String) = Request.Builder().url(base + path).header("Cookie", cookie).header("x-requested-with", "superdrive").apply { if (workspace.isNotEmpty()) header("x-workspace-id", workspace) }
    private fun call(r: Request): JSONObject {
        http.newCall(r).execute().use { res ->
            if (res.code == 401) throw SessionExpired()
            val text = res.body?.string() ?: "{}"
            val j = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (!res.isSuccessful && res.code != 409) throw IllegalStateException(j.optJSONObject("error")?.optString("message")?.ifEmpty { null } ?: "HTTP ${res.code}")
            return j.put("_status", res.code)
        }
    }
    private fun get(path: String) = call(req(path).get().build())
    private fun post(path: String, body: JSONObject) = call(req(path).post(body.toString().toRequestBody(json)).build())

    private fun ensureFolder(storageId: String, parent: String, name: String, cache: HashMap<String, String>): String {
        val key = "$parent/$name"; cache[key]?.let { return it }
        val r = post("/api/v1/files/folders", JSONObject().put("storageId", storageId).put("parentId", parent).put("name", name))
        val id = if (r.getInt("_status") == 409) {
            // it exists: find it
            var token: String? = null; var found: String? = null
            do {
                val page = get("/api/v1/files?storageId=$storageId&folderId=${Uri.encode(parent)}&limit=1000${token?.let { "&pageToken=${Uri.encode(it)}" } ?: ""}").getJSONObject("data")
                val items = page.getJSONArray("items")
                for (i in 0 until items.length()) { val it = items.getJSONObject(i); if (it.optBoolean("isFolder") && it.getString("name") == name) found = it.getString("id") }
                token = if (page.isNull("nextPageToken")) null else page.getString("nextPageToken")
            } while (found == null && token != null)
            found ?: throw IllegalStateException("Folder $name tidak ditemukan")
        } else r.getJSONObject("data").getString("id")
        cache[key] = id; return id
    }

    /** Sends one photo or video. True when it is on the server (or was already). */
    private fun send(storageId: String, parent: String, it: Item, onSent: (Long) -> Unit = {}): Boolean {
        val created = post("/api/v1/uploads", JSONObject().put("storageId", storageId).put("parentId", parent).put("name", it.name).put("size", it.size).put("mimeType", it.mime).put("conflictPolicy", "SKIP").apply { if (it.taken > 0) put("lastModified", it.taken) }).getJSONObject("data")
        if (created.optString("status") == "DONE") return true // the same name was already there
        val id = created.getString("id")
        // Sent in pieces, like the website does: a proxy in front of the server may refuse one huge request (HTTP 413).
        val piece = minOf(created.optLong("chunkSize", 8L * 1024 * 1024).takeIf { s -> s > 0 } ?: (8L * 1024 * 1024), 8L * 1024 * 1024).coerceAtLeast(256L * 1024)
        var offset = created.optLong("offset", 0L)
        var done = created
        while (offset < it.size && !stopped()) {
            val len = minOf(piece, it.size - offset); val from = offset
            var attempt = 0
            while (true) {
                val stream = ctx.contentResolver.openInputStream(it.uri) ?: return false
                val src = stream.source().buffer()
                try {
                    src.skip(from)
                    val body = object : RequestBody() {
                        override fun contentType() = "application/octet-stream".toMediaType()
                        override fun contentLength() = len
                        override fun writeTo(sink: BufferedSink) {
                            var left = len; val buf = okio.Buffer()
                            while (left > 0) { val n = src.read(buf, minOf(128L * 1024, left)); if (n < 0) throw java.io.EOFException("File berubah saat dibaca"); sink.write(buf, n); left -= n; onSent(from + len - left) }
                        }
                    }
                    done = call(req("/api/v1/uploads/$id").header("Upload-Offset", from.toString()).patch(body).build()).getJSONObject("data")
                    break
                } catch (e: java.io.IOException) { if (++attempt >= 3) throw e; Thread.sleep(1500L * attempt) }
                finally { try { src.close() } catch (_: Exception) {}; try { stream.close() } catch (_: Exception) {} }
            }
            offset = from + len
        }
        var status = done.optString("status")
        // Handing the bytes on to the storage can take a moment for cloud storages.
        var waited = 0
        while (status == "FINALIZING" && waited < 120 && !stopped()) { Thread.sleep(1000); waited++; status = get("/api/v1/uploads/$id").getJSONObject("data").optString("status") }
        return status == "DONE"
    }
}

class BackupWorker(private val ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun getForegroundInfo(): ForegroundInfo = foreground(ctx.getString(R.string.backup_title), "", -1)

    private fun foreground(title: String, text: String, percent: Int): ForegroundInfo {
        val n = Notifier.progress(ctx, title, text, percent)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ForegroundInfo(BACKUP_NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(BACKUP_NOTIF_ID, n)
    }

    override fun doWork(): Result {
        val rearm = inputData.getBoolean("trigger", false)
        try {
            return if (BackupRun(ctx, { isStopped }) { t, x, p -> setForegroundAsync(foreground(t, x, p)) }.run()) Result.success() else Result.retry()
        } finally {
            if (rearm && BackupStore.enabled(ctx)) BackupScheduler.arm(ctx, ExistingWorkPolicy.APPEND_OR_REPLACE)
        }
    }

    companion object {

        private fun scan(c: Context, uri: Uri, kind: String): List<Item> {
            val since = if (BackupStore.existing(c)) 0L else BackupStore.since(c)
            val cols = arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.MIME_TYPE, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME, "datetaken", MediaStore.MediaColumns.DATE_MODIFIED)
            val where = StringBuilder("${MediaStore.MediaColumns.SIZE} > 0"); val args = ArrayList<String>()
            if (Build.VERSION.SDK_INT >= 29) where.append(" AND ${MediaStore.MediaColumns.IS_PENDING} = 0")
            if (since > 0) { where.append(" AND ${MediaStore.MediaColumns.DATE_ADDED} >= ?"); args.add(since.toString()) }
            val chosen = BackupStore.albums(c)
            if (chosen != null) {
                if (chosen.isEmpty()) return emptyList()
                where.append(" AND ${MediaStore.MediaColumns.BUCKET_ID} IN (${chosen.joinToString(",") { "?" }})"); args.addAll(chosen)
            }
            val out = ArrayList<Item>()
            c.contentResolver.query(uri, cols, where.toString(), args.toTypedArray(), "${MediaStore.MediaColumns.DATE_ADDED} DESC")?.use { cur ->
                while (cur.moveToNext()) {
                    val id = cur.getLong(0)
                    out.add(Item(kind, id, ContentUris.withAppendedId(uri, id), cur.getString(1) ?: "$kind-$id", cur.getLong(2), cur.getString(3) ?: "application/octet-stream", cur.getString(4) ?: "",
                        // when the picture was taken; the file's own change date if the gallery does not know
                        cur.getLong(5).takeIf { it > 0 } ?: (cur.getLong(6) * 1000)))
                }
            }
            return out
        }

        /** Photos (and videos, if wanted) that are not on the server yet, newest first. */
        fun pendingItems(c: Context): List<Item> {
            val done = BackupDb(c).all()
            val all = ArrayList<Item>(scan(c, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image"))
            if (BackupStore.videos(c)) all.addAll(scan(c, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video"))
            return all.filter { "${it.kind}:${it.id}" !in done }
        }
        fun pending(c: Context): Int = pendingItems(c).size

        /** The albums (device folders) that hold photos or videos, with how many items each has. */
        fun albums(c: Context): List<Triple<String, String, Int>> {
            val names = LinkedHashMap<String, String>(); val counts = HashMap<String, Int>()
            val cols = arrayOf(MediaStore.MediaColumns.BUCKET_ID, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME)
            val sources = ArrayList<Uri>().apply { add(MediaStore.Images.Media.EXTERNAL_CONTENT_URI); if (BackupStore.videos(c)) add(MediaStore.Video.Media.EXTERNAL_CONTENT_URI) }
            for (uri in sources) c.contentResolver.query(uri, cols, "${MediaStore.MediaColumns.SIZE} > 0", null, null)?.use { cur ->
                while (cur.moveToNext()) { val id = cur.getString(0) ?: continue; names.putIfAbsent(id, cur.getString(1) ?: "Lainnya"); counts[id] = (counts[id] ?: 0) + 1 }
            }
            return names.map { Triple(it.key, it.value, counts[it.key] ?: 0) }.sortedByDescending { it.third }
        }
    }
}
