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

    fun now(c: Context) {
        val req = OneTimeWorkRequest.Builder(BackupWorker::class.java).setConstraints(base(c)).setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST).build()
        WorkManager.getInstance(c).enqueueUniqueWork("backup-now", ExistingWorkPolicy.KEEP, req)
    }
}

class BackupWorker(private val ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    class Item(val kind: String, val id: Long, val uri: Uri, val name: String, val size: Long, val mime: String, val bucket: String, val taken: Long)
    private class SessionExpired : Exception()

    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(5, TimeUnit.MINUTES).writeTimeout(5, TimeUnit.MINUTES).build()
    private val json = "application/json".toMediaType()
    private var base = ""; private var cookie = ""; private var workspace = ""

    override fun getForegroundInfo(): ForegroundInfo = foreground(ctx.getString(R.string.backup_title), "", -1)

    private fun foreground(title: String, text: String, percent: Int): ForegroundInfo {
        val n = Notifier.progress(ctx, title, text, percent)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ForegroundInfo(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(NOTIF_ID, n)
    }

    override fun doWork(): Result {
        val rearm = inputData.getBoolean("trigger", false)
        if (!BackupStore.enabled(ctx) || !BackupStore.hasPermission(ctx)) return Result.success()
        BackupStore.running(ctx, true)
        var uploaded = 0
        // Show the notification straight away: scanning a big gallery can take a while.
        setForegroundAsync(foreground(ctx.getString(R.string.backup_title), "Memeriksa galeri…", -1))
        try {
            base = ServerStore.url(ctx) ?: return Result.success()
            cookie = app.superdrive.core.PrefsCookies(ctx).get(base) ?: throw SessionExpired()
            val me = get("/api/v1/auth/me"); workspace = me.getJSONObject("data").optString("activeWorkspaceId")
            val storages = get("/api/v1/storages").getJSONArray("data")
            var storageId = ""
            for (i in 0 until storages.length()) { val s = storages.getJSONObject(i); if (s.optBoolean("isDefault")) storageId = s.getString("id") }
            if (storageId.isEmpty()) throw IllegalStateException("Penyimpanan bawaan tidak ditemukan")

            val todo = pendingItems(ctx)
            if (todo.isEmpty()) { BackupStore.record(ctx, 0, null); return Result.success() }
            BackupStore.setProgress(ctx, 0, todo.size, "", 0)
            setForegroundAsync(foreground(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, 0, todo.size), 0))
            val db = BackupDb(ctx); val folders = HashMap<String, String>()
            val root = ensureFolder(storageId, "root", "Cadangan Foto", folders)
            val device = ensureFolder(storageId, root, Build.MODEL.replace(Regex("[/\\\\]"), "_").trim().ifEmpty { "Perangkat" }.take(60), folders)
            for ((i, it) in todo.withIndex()) {
                if (isStopped) break
                val bucket = it.bucket.replace(Regex("[/\\\\]"), "_").trim().ifEmpty { "Lainnya" }.take(80)
                val parent = ensureFolder(storageId, device, bucket, folders)
                var lastTick = 0L
                val ok = send(storageId, parent, it) { sent ->
                    val now = System.currentTimeMillis()
                    if (now - lastTick > 800) {
                        lastTick = now
                        val pct = (((i + (if (it.size > 0) sent.toDouble() / it.size else 1.0)) * 100) / todo.size).toInt().coerceIn(0, 100)
                        BackupStore.setProgress(ctx, i, todo.size, it.name, pct)
                        setForegroundAsync(foreground(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, i + 1, todo.size) + " · " + it.name, pct))
                    }
                }
                if (ok) { db.mark(it.kind, it.id); uploaded++ }
                val pctDone = ((i + 1) * 100) / todo.size
                BackupStore.setProgress(ctx, i + 1, todo.size, it.name, pctDone)
                setForegroundAsync(foreground(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, i + 1, todo.size), pctDone))
            }
            BackupStore.record(ctx, uploaded, null)
            if (uploaded > 0) ctx.getSystemService(android.app.NotificationManager::class.java).notify(DONE_NOTIF_ID, Notifier.done(ctx, ctx.getString(R.string.backup_done_title), ctx.getString(R.string.backup_done_text, uploaded)))
            return Result.success()
        } catch (e: SessionExpired) {
            BackupStore.record(ctx, uploaded, ctx.getString(R.string.backup_signed_out))
            ctx.getSystemService(android.app.NotificationManager::class.java).notify(DONE_NOTIF_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_signed_out)))
            return Result.success()
        } catch (e: Exception) {
            BackupStore.record(ctx, uploaded, e.message ?: e.javaClass.simpleName)
            if (uploaded > 0) ctx.getSystemService(android.app.NotificationManager::class.java).notify(DONE_NOTIF_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), "$uploaded file tercadangkan, sisanya dilanjutkan nanti (${e.message ?: "koneksi terputus"})"))
            return Result.retry() // the next attempt continues where this one stopped: sent photos are remembered
        } finally {
            BackupStore.running(ctx, false)
            if (rearm && BackupStore.enabled(ctx)) BackupScheduler.arm(ctx, ExistingWorkPolicy.APPEND_OR_REPLACE)
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
        val stream = ctx.contentResolver.openInputStream(it.uri) ?: return false
        val body = object : RequestBody() {
            override fun contentType() = "application/octet-stream".toMediaType()
            override fun contentLength() = it.size
            override fun writeTo(sink: BufferedSink) { var total = 0L; val buf = okio.Buffer(); stream.source().use { s -> while (true) { val n = s.read(buf, 128 * 1024); if (n < 0) break; sink.write(buf, n); total += n; onSent(total) } } }
        }
        val done = try { call(req("/api/v1/uploads/$id").header("Upload-Offset", "0").patch(body).build()).getJSONObject("data") } finally { stream.close() }
        var status = done.optString("status")
        // Handing the bytes on to the storage can take a moment for cloud storages.
        var waited = 0
        while (status == "FINALIZING" && waited < 120 && !isStopped) { Thread.sleep(1000); waited++; status = get("/api/v1/uploads/$id").getJSONObject("data").optString("status") }
        return status == "DONE"
    }

    companion object {
        private const val NOTIF_ID = 1003
        private const val DONE_NOTIF_ID = 1004

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
