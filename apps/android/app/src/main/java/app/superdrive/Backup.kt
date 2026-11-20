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

    /** Paused by the person: nothing starts by itself until they resume. */
    fun paused(c: Context) = p(c).getBoolean("bk_paused", false)
    fun setPaused(c: Context, on: Boolean) { p(c).edit().putBoolean("bk_paused", on).apply() }
    /** How many files are sent at the same time. */
    fun parallel(c: Context) = p(c).getInt("bk_parallel", 3).coerceIn(1, 5)
    fun setParallel(c: Context, n: Int) { p(c).edit().putInt("bk_parallel", n.coerceIn(1, 5)).apply() }
    /** The server-side upload of a file that was cut off, so the next pass continues it instead of starting over. */
    private fun ups(c: Context) = c.getSharedPreferences("superdrive_backup_uploads", Context.MODE_PRIVATE)
    fun savedUpload(c: Context, key: String): String? = ups(c).getString(key, null)
    fun saveUpload(c: Context, key: String, id: String) { ups(c).edit().putString(key, id).apply() }
    fun forgetUpload(c: Context, key: String) { ups(c).edit().remove(key).apply() }

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
        .put("paused", paused(c)).put("permission", hasPermission(c)).put("running", p(c).getBoolean("bk_running", false))
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
        if (BackupStore.paused(c)) return
        try { ContextCompat.startForegroundService(c, android.content.Intent(c, BackupService::class.java)); return } catch (e: Exception) { /* fall back to the scheduler */ }
        val req = OneTimeWorkRequest.Builder(BackupWorker::class.java).setConstraints(base(c)).setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST).build()
        WorkManager.getInstance(c).enqueueUniqueWork("backup-now", ExistingWorkPolicy.KEEP, req)
    }
}

/** What the running backup is doing right now, shared with the settings page (same process as the service and the worker). */
object BackupLive {
    class Slot(val key: String, val name: String, val size: Long) {
        val started = System.nanoTime()
        @Volatile var sent = 0L
        @Volatile var finishing = false
        @Volatile var skip = false
        @Volatile var stalled = false
        @Volatile var activity = System.currentTimeMillis()
        @Volatile var call: okhttp3.Call? = null
        fun touch() { activity = System.currentTimeMillis() }
        fun cancelCall() { try { call?.cancel() } catch (_: Exception) {} }
    }
    class FileRow(val key: String, val name: String, val size: Long, val sent: Long, val finishing: Boolean, val quiet: Boolean)
    class Snapshot(val running: Boolean, val done: Int, val total: Int, val failed: Int, val skipped: Int, val percent: Int, val files: List<FileRow>)

    private val slots = java.util.concurrent.ConcurrentHashMap<String, Slot>()
    @Volatile var running = false
    @Volatile var done = 0
    @Volatile var total = 0
    @Volatile var failed = 0
    @Volatile var skipped = 0

    fun start(total: Int) { slots.clear(); done = 0; failed = 0; skipped = 0; this.total = total; running = true }
    fun stop() { running = false; slots.clear() }
    @Synchronized fun count(failed: Boolean = false, skipped: Boolean = false) { done++; if (failed) this.failed++; if (skipped) this.skipped++ }
    /** The person paused it: stop what is in flight now and start nothing until they resume. */
    fun pause(c: Context) { BackupStore.setPaused(c, true); cutAll() }
    fun resume(c: Context) { BackupStore.setPaused(c, false); BackupScheduler.now(c) }
    fun begin(key: String, name: String, size: Long): Slot = Slot(key, name, size).also { slots[key] = it }
    fun end(slot: Slot) { slots.remove(slot.key) }

    /** Leave this file for later: the upload is cut now and the file stays on the waiting list. */
    fun skip(key: String) { slots[key]?.let { it.skip = true; it.cancelCall() } }
    /** Stop everything that is in flight right away; the sent part of each file is kept for the next pass. */
    fun cutAll() { slots.values.forEach { it.cancelCall() } }
    /** Gives up on files that have not moved for a long time. */
    fun sweep() {
        val now = System.currentTimeMillis()
        for (s in slots.values) if (!s.skip && now - s.activity > 180_000) { s.stalled = true; s.skip = true; s.cancelCall() }
    }

    fun snapshot(): Snapshot {
        val now = System.currentTimeMillis()
        val list = slots.values.sortedBy { it.started }
        val t = total
        val partial = list.sumOf { if (it.size > 0) (it.sent.toDouble() / it.size).coerceIn(0.0, 1.0) else 0.0 }
        val pct = if (t > 0) (((done + partial) * 100) / t).toInt().coerceIn(0, 100) else 0
        return Snapshot(running, done, t, failed, skipped, pct, list.map { FileRow(it.key, it.name, it.size, it.sent, it.finishing, now - it.activity > 20_000) })
    }
}

class Item(val kind: String, val id: Long, val uri: Uri, val name: String, val size: Long, val mime: String, val bucket: String, val taken: Long)
internal const val BACKUP_NOTIF_ID = 1003
internal const val BACKUP_DONE_ID = 1004

/** The backup itself. Both the background worker and the "Cadangkan sekarang" button run this same code. */
class BackupRun(private val ctx: Context, private val stopped: () -> Boolean, private val report: (title: String, text: String, percent: Int) -> Unit) {
    private class SessionExpired : Exception()
    /** The file was left alone on purpose (skipped, paused, or stuck): it stays on the waiting list. */
    private class Interrupted : Exception()

    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(5, TimeUnit.MINUTES).writeTimeout(5, TimeUnit.MINUTES).build()
    private val json = "application/json".toMediaType()
    private var base = ""; private var cookie = ""; private var workspace = ""
    private fun halt() = stopped() || BackupStore.paused(ctx)

    private var lastPublish = 0L
    private fun publish(force: Boolean = false) {
        val now = System.currentTimeMillis()
        synchronized(this) { if (!force && now - lastPublish < 700) return; lastPublish = now }
        val s = BackupLive.snapshot()
        BackupStore.setProgress(ctx, s.done, s.total, s.files.firstOrNull()?.name ?: "", s.percent)
        val detail = if (s.files.size > 1) " · ${s.files.size} file sekaligus" else s.files.firstOrNull()?.let { " · " + it.name } ?: ""
        report(ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_progress, s.done, s.total) + detail, s.percent)
    }

    /** Runs one backup pass. True when it is finished (nothing to retry), false when it should be tried again later. */
    fun run(): Boolean {
        if (!BackupStore.enabled(ctx)) return true
        if (BackupStore.paused(ctx)) return true
        if (!BackupStore.hasPermission(ctx)) { BackupStore.record(ctx, 0, "Izin akses foto belum diberikan."); return true }
        BackupStore.networkBlocked(ctx)?.let { BackupStore.record(ctx, 0, it); return true }
        BackupStore.running(ctx, true)
        val uploaded = java.util.concurrent.atomic.AtomicInteger()
        // Show the notification straight away: scanning a big gallery can take a while.
        report(ctx.getString(R.string.backup_title), "Memeriksa galeri…", -1)
        var watchdog: Thread? = null
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
            BackupLive.start(todo.size)
            BackupStore.setProgress(ctx, 0, todo.size, "", 0)
            publish(true)
            val db = BackupDb(ctx); val folders = HashMap<String, String>()
            val root = ensureFolder(storageId, "root", "Cadangan Foto", folders)
            val device = ensureFolder(storageId, root, Build.MODEL.replace(Regex("[/\\\\]"), "_").trim().ifEmpty { "Perangkat" }.take(60), folders)

            val next = java.util.concurrent.atomic.AtomicInteger(0)
            val consecutive = java.util.concurrent.atomic.AtomicInteger(0)
            val abort = java.util.concurrent.atomic.AtomicBoolean(false)
            val expired = java.util.concurrent.atomic.AtomicBoolean(false)
            val lastError = java.util.concurrent.atomic.AtomicReference("")
            // Gives up on a file that has not moved for minutes, so one stuck file never holds the others back.
            watchdog = Thread { try { while (true) { Thread.sleep(5000); BackupLive.sweep() } } catch (_: InterruptedException) {} }.apply { isDaemon = true; start() }

            val workers = (0 until BackupStore.parallel(ctx)).map {
                Thread {
                    while (!halt() && !abort.get()) {
                        val i = next.getAndIncrement(); if (i >= todo.size) break
                        val item = todo[i]
                        val key = "${item.kind}:${item.id}"
                        val slot = BackupLive.begin(key, item.name, item.size)
                        try {
                            val bucket = item.bucket.replace(Regex("[/\\\\]"), "_").trim().ifEmpty { "Lainnya" }.take(80)
                            val parent = ensureFolder(storageId, device, bucket, folders)
                            if (send(storageId, parent, item, slot)) { db.mark(item.kind, item.id); BackupStore.forgetUpload(ctx, key); uploaded.incrementAndGet(); consecutive.set(0); BackupLive.count() }
                            else { BackupLive.count(failed = true); lastError.set("File tidak bisa dibaca"); if (consecutive.incrementAndGet() >= 3) abort.set(true) }
                        } catch (e: SessionExpired) { expired.set(true); abort.set(true) }
                        catch (e: Exception) {
                            when {
                                slot.skip -> BackupLive.count(skipped = true)
                                halt() -> {} // paused: the file goes back on the list
                                else -> {
                                    BackupLive.count(failed = true); lastError.set(e.message ?: e.javaClass.simpleName)
                                    if (consecutive.incrementAndGet() >= 3) abort.set(true) // probably the connection or the server: stop and try again later
                                }
                            }
                        } finally { BackupLive.end(slot) }
                        publish()
                    }
                }.apply { start() }
            }
            workers.forEach { w -> w.join() }
            publish(true)
            if (expired.get()) throw SessionExpired()

            val failed = BackupLive.failed; val skipped = BackupLive.skipped
            val paused = BackupStore.paused(ctx)
            val parts = ArrayList<String>()
            if (failed > 0) parts.add("$failed file gagal diunggah (${lastError.get()})")
            if (skipped > 0) parts.add("$skipped file dilewati")
            val problem = if (parts.isEmpty()) null else parts.joinToString(", ") + ". Ketuk “Cadangkan sekarang” untuk mencoba lagi."
            BackupStore.record(ctx, uploaded.get(), if (paused) null else problem)
            val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
            if (paused) nm.notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), "Dijeda · ${uploaded.get()} file tercadangkan. Lanjutkan dari Pengaturan."))
            else if (uploaded.get() > 0) nm.notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_done_title), ctx.getString(R.string.backup_done_text, uploaded.get()) + if (failed + skipped > 0) " · ${failed + skipped} belum" else ""))
            else if (problem != null) nm.notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), problem))
            return consecutive.get() < 3
        } catch (e: SessionExpired) {
            BackupStore.record(ctx, uploaded.get(), ctx.getString(R.string.backup_signed_out))
            ctx.getSystemService(android.app.NotificationManager::class.java).notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), ctx.getString(R.string.backup_signed_out)))
            return true
        } catch (e: Exception) {
            BackupStore.record(ctx, uploaded.get(), e.message ?: e.javaClass.simpleName)
            if (uploaded.get() > 0) ctx.getSystemService(android.app.NotificationManager::class.java).notify(BACKUP_DONE_ID, Notifier.done(ctx, ctx.getString(R.string.backup_title), "${uploaded.get()} file tercadangkan, sisanya dilanjutkan nanti (${e.message ?: "koneksi terputus"})"))
            return false // the next attempt continues where this one stopped: sent photos are remembered
        } finally {
            watchdog?.interrupt()
            BackupLive.stop()
            BackupStore.running(ctx, false)
        }
    }

    /* ---- the server ---- */
    private fun req(path: String) = Request.Builder().url(base + path).header("Cookie", cookie).header("x-requested-with", "superdrive").apply { if (workspace.isNotEmpty()) header("x-workspace-id", workspace) }
    private fun call(r: Request, slot: BackupLive.Slot? = null): JSONObject {
        val c = http.newCall(r)
        if (slot != null) { slot.call = c; if (slot.skip || halt()) throw Interrupted(); slot.touch() }
        c.execute().use { res ->
            if (res.code == 401) throw SessionExpired()
            val text = res.body?.string() ?: "{}"
            val j = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (!res.isSuccessful && res.code != 409) throw IllegalStateException(j.optJSONObject("error")?.optString("message")?.ifEmpty { null } ?: "HTTP ${res.code}")
            slot?.touch()
            return j.put("_status", res.code)
        }
    }
    private fun get(path: String, slot: BackupLive.Slot? = null) = call(req(path).get().build(), slot)
    private fun post(path: String, body: JSONObject, slot: BackupLive.Slot? = null) = call(req(path).post(body.toString().toRequestBody(json)).build(), slot)

    @Synchronized
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
    private fun send(storageId: String, parent: String, it: Item, slot: BackupLive.Slot): Boolean {
        val key = slot.key
        // A file cut off earlier (paused, skipped, dropped connection) carries on from where the server stopped.
        var created: JSONObject? = null
        BackupStore.savedUpload(ctx, key)?.let { saved ->
            try {
                val d = get("/api/v1/uploads/$saved", slot).getJSONObject("data")
                if (d.optLong("size", -1) == it.size && d.optString("status") in setOf("RECEIVING", "FINALIZING", "DONE")) created = d
            } catch (e: SessionExpired) { throw e } catch (e: Interrupted) { throw e } catch (e: Exception) { BackupStore.forgetUpload(ctx, key) }
        }
        val c0 = created ?: post("/api/v1/uploads", JSONObject().put("storageId", storageId).put("parentId", parent).put("name", it.name).put("size", it.size).put("mimeType", it.mime).put("conflictPolicy", "SKIP").apply { if (it.taken > 0) put("lastModified", it.taken) }, slot).getJSONObject("data")
        if (c0.optString("status") == "DONE") return true // the same name was already there
        val id = c0.getString("id")
        BackupStore.saveUpload(ctx, key, id)
        // Sent in pieces, like the website does: a proxy in front of the server may refuse one huge request (HTTP 413).
        val piece = minOf(c0.optLong("chunkSize", 8L * 1024 * 1024).takeIf { s -> s > 0 } ?: (8L * 1024 * 1024), 8L * 1024 * 1024).coerceAtLeast(256L * 1024)
        var offset = c0.optLong("offset", 0L)
        slot.sent = offset
        var done = c0
        while (offset < it.size) {
            if (slot.skip || halt()) throw Interrupted()
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
                            while (left > 0) {
                                val n = src.read(buf, minOf(128L * 1024, left)); if (n < 0) throw java.io.EOFException("File berubah saat dibaca")
                                sink.write(buf, n); left -= n
                                slot.sent = from + len - left; slot.touch()
                            }
                        }
                    }
                    done = call(req("/api/v1/uploads/$id").header("Upload-Offset", from.toString()).patch(body).build(), slot).getJSONObject("data")
                    break
                } catch (e: java.io.IOException) {
                    if (slot.skip || halt() || ++attempt >= 3) throw e
                    slot.sent = from
                    Thread.sleep(1500L * attempt)
                }
                finally { try { src.close() } catch (_: Exception) {}; try { stream.close() } catch (_: Exception) {} }
            }
            offset = from + len
            slot.sent = offset
        }
        var status = done.optString("status")
        // Handing the bytes on to the storage can take a moment for cloud storages.
        slot.finishing = true
        var waited = 0
        while (status == "FINALIZING" && waited < 120) {
            if (slot.skip || halt()) throw Interrupted()
            Thread.sleep(1000); waited++; slot.touch()
            status = get("/api/v1/uploads/$id", slot).getJSONObject("data").optString("status")
        }
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
