package app.superdrive.ui.settings

import android.content.Intent
import android.net.Uri
import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.AlbumVault
import app.superdrive.AppLock
import app.superdrive.BackupLive
import app.superdrive.BackupScheduler
import app.superdrive.BackupStore
import app.superdrive.BackupWorker
import app.superdrive.BuildConfig
import app.superdrive.Updater
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.AuditEntry
import app.superdrive.core.Me
import app.superdrive.core.PrivateStatus
import app.superdrive.core.auditLabel
import app.superdrive.ui.design.Avatar
import app.superdrive.ui.design.BarIcon
import app.superdrive.ui.design.BtnKind
import app.superdrive.ui.design.Divider
import app.superdrive.ui.design.EmptyState
import app.superdrive.ui.design.IconTile
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.Notice
import app.superdrive.ui.design.PageHeader
import app.superdrive.ui.design.SdButton
import app.superdrive.ui.design.SdCard
import app.superdrive.ui.design.SdField
import app.superdrive.ui.design.SdProgress
import app.superdrive.ui.design.SdSwitch
import app.superdrive.ui.design.SectionLabel
import app.superdrive.ui.design.SettingRow
import app.superdrive.ui.design.Skeleton
import app.superdrive.ui.design.StatusPill
import app.superdrive.ui.design.pressable
import app.superdrive.ui.design.providerColor
import app.superdrive.ui.design.riseIn
import app.superdrive.ui.design.timeAgo
import app.superdrive.ui.files.ConfirmDialog
import app.superdrive.ui.theme.Motion
import app.superdrive.ui.theme.ThemePref
import app.superdrive.ui.theme.sd
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable private data class MfaStatus(val enabled: Boolean = false, val recoveryLeft: Int = 0)
@Serializable private data class MfaSetup(val secret: String = "", val otpauthUrl: String = "")
@Serializable private data class Recovery(val recoveryCodes: List<String> = emptyList())
@Serializable private data class Member(val userId: String, val name: String, val email: String, val role: String)
@Serializable private data class Invitation(val id: String, val email: String, val role: String = "MEMBER", val expiresAt: String = "")
@Serializable private data class Members(val members: List<Member> = emptyList(), val invitations: List<Invitation> = emptyList())
@Serializable private data class InviteResult(val link: String = "", val emailed: Boolean = false)
@Serializable private data class StorageRow(val id: String, val name: String, val provider: String = "", val status: String = "CONNECTED", val isDefault: Boolean = false, val accountEmail: String? = null, val lastError: String? = null, val quota: app.superdrive.core.Quota? = null)
@Serializable private data class ReconnectResult(val url: String? = null)
@Serializable private data class AuditPage(val items: List<AuditEntry> = emptyList(), val total: Int = 0)

private enum class Sub(val title: String) {
    Hub("Pengaturan"), Profile("Profil"), Security("Keamanan"), Private("Album privat"), Backup("Cadangan foto"), BackupAlbums("Pilih album"), Automations("Otomasi"), App("Aplikasi"),
    Appearance("Tampilan"), Storage("Penyimpanan"), Members("Anggota"), Activity("Log aktivitas"),
}

private fun android.content.Context.activity(): AppCompatActivity? { var c = this; while (c is android.content.ContextWrapper) { if (c is AppCompatActivity) return c; c = c.baseContext }; return null }
private fun roleLabel(r: String) = when (r) { "OWNER" -> "Pemilik"; "ADMIN" -> "Admin"; "MEMBER" -> "Anggota"; "VIEWER" -> "Pembaca"; else -> r }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(api: Api, me: Me, isAdmin: Boolean, onBack: () -> Unit, onLogout: () -> Unit) {
    var sub by remember { mutableStateOf(Sub.Hub) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val c = MaterialTheme.sd
    val say: (String) -> Unit = { m -> scope.launch { snack.showSnackbar(m) } }
    val role = me.workspaces.firstOrNull { it.id == me.activeWorkspaceId }?.role ?: "MEMBER"
    val back: () -> Unit = { if (sub == Sub.Hub) onBack() else sub = if (sub == Sub.BackupAlbums) Sub.Backup else Sub.Hub }
    BackHandler { back() }
    Scaffold(
        containerColor = c.canvas, contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snack) { d -> Snackbar(d, shape = RoundedCornerShape(12.dp), containerColor = c.navy, contentColor = Color.White) } },
        topBar = { PageHeader(sub.title, subtitle = if (sub == Sub.Hub) me.user.email else null, leading = { BarIcon(Lu.Back, "Kembali", { back() }, tint = c.ink) }) },
    ) { pad ->
        AnimatedContent(sub, Modifier.padding(pad).fillMaxSize(), label = "settings", transitionSpec = {
            val deeper = targetState != Sub.Hub
            (fadeIn(tween(220, easing = Motion.EaseOut)) + slideInHorizontally(tween(300, easing = Motion.EaseOut)) { if (deeper) it / 10 else -it / 10 }) togetherWith (fadeOut(tween(120)) + slideOutHorizontally(tween(200)) { if (deeper) -it / 12 else it / 12 })
        }) { page ->
            when (page) {
                Sub.Hub -> Hub(me, isAdmin) { sub = it }
                Sub.Profile -> ProfilePage(api, me, say, onLogout)
                Sub.Security -> SecurityPage(api, say)
                Sub.Private -> PrivatePage(api, me, say)
                Sub.Automations -> AutomationsPage(api, say)
                Sub.Backup -> BackupPage(say) { sub = Sub.BackupAlbums }
                Sub.BackupAlbums -> BackupAlbumsPage(say) { sub = Sub.Backup }
                Sub.App -> AppPage(say)
                Sub.Appearance -> AppearancePage()
                Sub.Storage -> StoragePage(api, say)
                Sub.Members -> MembersPage(api, me, role, say)
                Sub.Activity -> ActivityPage(api)
            }
        }
    }
}

@Composable
private fun Hub(me: Me, isAdmin: Boolean, open: (Sub) -> Unit) {
    val c = MaterialTheme.sd
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        SdCard(Modifier.fillMaxWidth().riseIn(0)) {
            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(me.user.name, size = 52.dp)
                Column(Modifier.padding(start = 14.dp)) { Text(me.user.name, style = MaterialTheme.typography.titleMedium, color = c.ink); Text(me.user.email, style = MaterialTheme.typography.bodySmall, color = c.muted) }
            }
        }
        Group("Akun", 1) {
            SettingRow(Lu.User, "Profil", detail = "Nama dan kata sandi", onClick = { open(Sub.Profile) }); Divider()
            SettingRow(Lu.Shield, "Keamanan", detail = "Verifikasi dua langkah", onClick = { open(Sub.Security) }); Divider()
            SettingRow(Lu.Lock, "Album privat", detail = "Kata sandi dan sidik jari", onClick = { open(Sub.Private) })
        }
        Group("Aplikasi", 2) {
            SettingRow(Lu.Images, "Cadangan foto", detail = "Unggah otomatis dari galeri", onClick = { open(Sub.Backup) }, tone = c.okSoft to c.okInk); Divider()
            SettingRow(Lu.Zap, "Otomasi", detail = "Aturan otomatis, cadangan terjadwal, pembersihan", onClick = { open(Sub.Automations) }, tone = c.primarySoft to c.primaryInk); Divider()
            SettingRow(Lu.Phone, "Aplikasi", detail = "Kunci sidik jari dan pembaruan", onClick = { open(Sub.App) }, tone = c.violetSoft to c.violetInk); Divider()
            SettingRow(Lu.Settings, "Tampilan", detail = "Terang, gelap, atau ikuti sistem", onClick = { open(Sub.Appearance) }, tone = c.warnSoft to c.warnInk)
        }
        Group("Ruang kerja", 3) {
            SettingRow(Lu.HardDrive, "Penyimpanan", detail = "Sumber, kapasitas, hubungkan ulang", onClick = { open(Sub.Storage) }); Divider()
            SettingRow(Lu.Users, "Anggota", detail = if (isAdmin) "Undang dan atur peran" else "Anggota ruang kerja", onClick = { open(Sub.Members) })
            if (isAdmin) { Divider(); SettingRow(Lu.Clock, "Log aktivitas", detail = "Riwayat tindakan di ruang kerja", onClick = { open(Sub.Activity) }, tone = c.surface2 to c.muted) }
        }
        Notice("Pengaturan sistem dan website hanya tersedia di situs web.", c.surface2 to c.muted)
    }
}

@Composable
private fun Group(title: String, index: Int, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(Modifier.riseIn(index), verticalArrangement = Arrangement.spacedBy(8.dp)) { SectionLabel(title); SdCard(Modifier.fillMaxWidth(), content = content) }
}

@Composable
private fun Page(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) =
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)

@Composable
private fun Panel(title: String? = null, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) = SdCard(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { if (title != null) Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.sd.ink); content() }
}

@Composable
private fun ProfilePage(api: Api, me: Me, say: (String) -> Unit, onLogout: () -> Unit) {
    var name by remember { mutableStateOf(me.user.name) }
    var cur by remember { mutableStateOf("") }; var new by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Page {
        Panel("Nama tampilan") {
            SdField(name, { name = it }, "Nama")
            SdButton("Simpan nama", { scope.launch { busy = true; try { api.send("PATCH", "/auth/profile", buildJsonObject { put("name", name.trim()) }); say("Nama disimpan") } catch (e: ApiException) { say(e.message ?: "Gagal") }; busy = false } }, enabled = name.isNotBlank() && name != me.user.name, busy = busy)
        }
        Panel("Ganti kata sandi") {
            SdField(cur, { cur = it }, "Kata sandi saat ini", password = true)
            SdField(new, { new = it }, "Kata sandi baru", password = true, supporting = "Minimal 8 karakter")
            SdButton("Ganti kata sandi", { scope.launch { try { api.send("POST", "/auth/change-password", buildJsonObject { put("currentPassword", cur); put("newPassword", new) }); cur = ""; new = ""; say("Kata sandi diganti") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }, enabled = cur.isNotBlank() && new.length >= 8)
        }
        SdButton("Keluar dari akun", onLogout, kind = BtnKind.Danger, icon = Lu.X)
    }
}

@Composable
private fun SecurityPage(api: Api, say: (String) -> Unit) {
    val c = MaterialTheme.sd
    var st by remember { mutableStateOf<MfaStatus?>(null) }
    var setup by remember { mutableStateOf<MfaSetup?>(null) }
    var code by remember { mutableStateOf("") }; var pw by remember { mutableStateOf("") }
    var codes by remember { mutableStateOf<List<String>?>(null) }
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    LaunchedEffect(Unit) { try { st = api.get("/auth/mfa") } catch (e: ApiException) { say(e.message ?: "Gagal") } }
    Page {
        val s = st
        if (s == null) Skeleton(Modifier.fillMaxWidth().height(96.dp), 14.dp) else {
            SdCard(Modifier.fillMaxWidth()) {
                SettingRow(Lu.Shield, "Verifikasi dua langkah", detail = if (s.enabled) "Aktif · ${s.recoveryLeft} kode pemulihan tersisa" else "Belum aktif", tone = if (s.enabled) c.okSoft to c.okInk else c.warnSoft to c.warnInk,
                    trailing = { StatusPill(if (s.enabled) "Aktif" else "Nonaktif", if (s.enabled) c.okSoft else c.warnSoft, if (s.enabled) c.okInk else c.warnInk) })
            }
            codes?.let { cs ->
                Panel("Simpan kode pemulihan") {
                    Notice("Tiap kode hanya berlaku sekali. Simpan di tempat aman; kode ini tidak akan ditampilkan lagi.", c.warnSoft to c.warnInk)
                    Text(cs.joinToString("\n"), style = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace), color = c.ink)
                    SdButton("Salin semua", { (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Kode pemulihan", cs.joinToString("\n"))); say("Disalin") }, kind = BtnKind.Secondary, icon = Lu.Copy)
                }
            }
            if (!s.enabled && setup == null) SdButton("Aktifkan verifikasi dua langkah", { scope.launch { try { setup = api.post("/auth/mfa/setup") } catch (e: ApiException) { say(e.message ?: "Gagal") } } })
            setup?.let { su ->
                Panel("1. Tambahkan ke aplikasi autentikator") {
                    Text("Buka Google Authenticator, Authy, atau sejenisnya, lalu masukkan kunci ini:", style = MaterialTheme.typography.bodySmall, color = c.muted)
                    Text(su.secret.chunked(4).joinToString(" "), style = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Monospace), color = c.ink)
                    SdButton("Buka di aplikasi autentikator", { try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(su.otpauthUrl))) } catch (e: Exception) { say("Tidak ada aplikasi autentikator.") } }, kind = BtnKind.Secondary, icon = Lu.Link)
                }
                Panel("2. Masukkan kode 6 angka") {
                    SdField(code, { code = it.filter(Char::isDigit).take(6) }, "Kode", keyboard = androidx.compose.ui.text.input.KeyboardType.Number)
                    SdButton("Konfirmasi", { scope.launch { try { val r = api.post<Recovery>("/auth/mfa/enable", buildJsonObject { put("code", code) }); codes = r.recoveryCodes; setup = null; code = ""; st = MfaStatus(true, r.recoveryCodes.size) } catch (e: ApiException) { say(e.message ?: "Kode salah") } } }, enabled = code.length == 6)
                }
            }
            if (s.enabled) Panel("Nonaktifkan") {
                SdField(pw, { pw = it }, "Kata sandi akun", password = true)
                SdButton("Nonaktifkan verifikasi dua langkah", { scope.launch { try { api.send("POST", "/auth/mfa/disable", buildJsonObject { put("password", pw) }); pw = ""; st = MfaStatus(false, 0); say("Dinonaktifkan") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }, enabled = pw.isNotBlank(), kind = BtnKind.Danger)
            }
        }
    }
}

@Composable
private fun PrivatePage(api: Api, me: Me, say: (String) -> Unit) {
    val c = MaterialTheme.sd
    var st by remember { mutableStateOf<PrivateStatus?>(null) }
    var cur by remember { mutableStateOf("") }; var new by remember { mutableStateOf("") }; var fp by remember { mutableStateOf("") }
    var enrolled by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    val vault = remember { context.activity()?.let { AlbumVault(it) } }
    LaunchedEffect(Unit) { try { st = api.get<app.superdrive.core.Albums>("/albums").privateStatus } catch (e: ApiException) { say(e.message ?: "Gagal") }; enrolled = vault?.enrolledFor(me.user.id) == true }
    Page {
        val s = st
        if (s == null) Skeleton(Modifier.fillMaxWidth().height(96.dp), 14.dp) else {
            SdCard(Modifier.fillMaxWidth()) { SettingRow(Lu.Lock, "Album privat", detail = if (s.hasPassword) "${s.count} album · dilindungi kata sandi" else "Belum ada kata sandi", tone = if (s.hasPassword) c.okSoft to c.okInk else c.warnSoft to c.warnInk) }
            Panel(if (s.hasPassword) "Ganti kata sandi album" else "Buat kata sandi album") {
                if (s.hasPassword) SdField(cur, { cur = it }, "Kata sandi saat ini", password = true)
                SdField(new, { new = it }, if (s.hasPassword) "Kata sandi baru" else "Kata sandi", password = true, supporting = "Minimal 6 karakter. Berbeda dari kata sandi akun.")
                SdButton("Simpan kata sandi", { scope.launch { try { api.send("POST", "/albums-private/password", buildJsonObject { put("password", new); if (s.hasPassword) put("currentPassword", cur) }); st = s.copy(hasPassword = true); vault?.clear(); enrolled = false; cur = ""; new = ""; say("Kata sandi disimpan") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }, enabled = new.length >= 6 && (!s.hasPassword || cur.isNotBlank()))
            }
            if (s.hasPassword) {
                if (vault?.available() == true) Panel("Sidik jari") {
                    if (enrolled) {
                        Notice("Sidik jari aktif: album privat bisa dibuka tanpa mengetik kata sandi.", c.okSoft to c.okInk, Lu.Fingerprint)
                        SdButton("Matikan sidik jari", { vault.clear(); enrolled = false }, kind = BtnKind.Secondary)
                    } else {
                        Text("Buka album privat dengan sidik jari. Kata sandi disimpan terenkripsi di Keystore perangkat.", style = MaterialTheme.typography.bodySmall, color = c.muted)
                        SdField(fp, { fp = it }, "Kata sandi album", password = true)
                        SdButton("Aktifkan sidik jari", { scope.launch { try { api.send("POST", "/albums-private/unlock", buildJsonObject { put("password", fp) }); vault.enroll(me.user.id, fp) { ok, _ -> enrolled = ok; fp = ""; say(if (ok) "Sidik jari diaktifkan" else "Dibatalkan") } } catch (e: ApiException) { say(e.message ?: "Kata sandi salah") } } }, enabled = fp.isNotBlank(), icon = Lu.Fingerprint)
                    }
                } else Notice("Perangkat ini belum punya sidik jari yang terdaftar.", c.surface2 to c.muted)
            }
        }
    }
}

@Composable
private fun AppPage(say: (String) -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current; val activity = context.activity()
    val lock = remember { activity?.let { AppLock(it) } }
    var lockOn by remember { mutableStateOf(lock?.enabled == true) }
    var delay by remember { mutableStateOf(lock?.delayMs ?: 60_000L) }
    Page {
        Group("Keamanan", 0) {
            SettingRow(Lu.Fingerprint, "Kunci sidik jari", detail = if (lock?.available() == true) "Minta sidik jari atau kunci layar saat dibuka" else "Daftarkan sidik jari atau kunci layar di pengaturan HP", tone = c.okSoft to c.okInk, trailing = {
                SdSwitch(lockOn, enabled = lock?.available() == true, onChange = { want ->
                    if (want) lock?.authenticate("Aktifkan kunci", null) { ok -> if (ok) { lock.enabled = true; lockOn = true } } else { lock?.enabled = false; lockOn = false }
                })
            })
            if (lockOn) {
                Divider()
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Kunci kembali setelah di latar belakang", style = MaterialTheme.typography.labelLarge, color = c.ink)
                    app.superdrive.ui.design.SlidingTabs(listOf("Langsung", "1 mnt", "5 mnt", "15 mnt"), listOf(0L, 60_000L, 300_000L, 900_000L).indexOf(delay).coerceAtLeast(0), { i -> delay = listOf(0L, 60_000L, 300_000L, 900_000L)[i]; lock?.delayMs = delay })
                }
            }
        }
        Group("Pembaruan", 1) {
            SettingRow(Lu.Download, "Versi ${BuildConfig.VERSION_NAME}", detail = "Periksa rilis terbaru di GitHub", tone = c.violetSoft to c.violetInk, onClick = { if (activity != null) Updater(activity).check(true) })
        }
    }
}

@Composable
private fun BackupPage(say: (String) -> Unit, pickAlbums: () -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current
    var on by remember { mutableStateOf(BackupStore.enabled(context)) }
    var wifi by remember { mutableStateOf(BackupStore.wifiOnly(context)) }
    var videos by remember { mutableStateOf(BackupStore.videos(context)) }
    var existing by remember { mutableStateOf(BackupStore.existing(context)) }
    var parallel by remember { mutableStateOf(BackupStore.parallel(context)) }
    val chosen = remember { BackupStore.albums(context) } // null = every album; changed on its own page
    var pending by remember { mutableStateOf<Int?>(null) }
    var tick by remember { mutableStateOf(0) }
    fun save(o: Boolean = on, w: Boolean = wifi, v: Boolean = videos, e: Boolean = existing) { BackupStore.save(context, o, w, v, e); BackupScheduler.apply(context); tick++ }
    val askPerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        if (BackupStore.hasPermission(context)) { on = true; save(o = true); BackupScheduler.now(context) } else say("Izin akses foto diperlukan.")
    }
    val live = remember(tick) { BackupLive.snapshot() }
    val paused = remember(tick) { BackupStore.paused(context) }
    LaunchedEffect(on, videos, existing, live.running) {
        if (on && BackupStore.hasPermission(context)) withContext(Dispatchers.IO) { pending = try { BackupWorker.pending(context) } catch (e: Exception) { null } }
    }
    val st = remember(tick, on) { BackupStore.state(context) }
    // While a backup runs, refresh often so the bars move.
    LaunchedEffect(on, live.running) { while (on) { kotlinx.coroutines.delay(if (BackupLive.running) 700 else 4000); tick++ } }
    var notifOk by remember(tick) { mutableStateOf(android.os.Build.VERSION.SDK_INT < 33 || androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) }
    val askNotif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { tick++ }
    Page {
        Group("Cadangan otomatis", 0) {
            SettingRow(Lu.Images, "Cadangkan foto dan video", detail = if (on) "Aktif · berjalan saat galeri berubah" else "Nonaktif", tone = c.okSoft to c.okInk, trailing = {
                SdSwitch(on, onChange = { want -> if (want) { if (BackupStore.hasPermission(context)) { on = true; save(o = true); BackupScheduler.now(context) } else askPerms.launch(BackupStore.permissionsToAsk()) } else { on = false; save(o = false) } })
            })
        }
        if (on && !notifOk) Notice("Notifikasi dimatikan, jadi progres pencadangan tidak tampil di bilah notifikasi.", c.warnSoft to c.warnInk, Lu.Bell)
        if (on && !notifOk) SdButton("Izinkan notifikasi", { if (android.os.Build.VERSION.SDK_INT >= 33) askNotif.launch(android.Manifest.permission.POST_NOTIFICATIONS) else context.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)) }, kind = BtnKind.Secondary, icon = Lu.Bell)
        if (on && !live.running && paused) Notice("Pencadangan dijeda. Bagian file yang sudah terkirim disimpan, jadi saat dilanjutkan tidak mengulang dari awal.", c.warnSoft to c.warnInk, Lu.Clock)
        else if (on && !live.running) BackupStore.networkBlocked(context)?.let { Notice(it, c.warnSoft to c.warnInk, Lu.Link) }
        if (live.running) LiveCard(live, onPause = { BackupLive.pause(context); say("Dijeda. Lanjutkan kapan saja."); tick++ }, onSkip = { key -> BackupLive.skip(key); say("File dilewati, dicoba lagi pada pencadangan berikutnya"); tick++ })
        if (on) {
            Group("Pilihan", 1) {
                SettingRow(Lu.Link, "Hanya lewat Wi-Fi", detail = "Hemat kuota seluler", trailing = { SdSwitch(wifi, onChange = { wifi = it; save(w = it) }) }); Divider()
                SettingRow(Lu.FileVideo, "Sertakan video", trailing = { SdSwitch(videos, onChange = { videos = it; save(v = it) }) }); Divider()
                SettingRow(Lu.Clock, "Termasuk foto yang sudah ada", detail = "Mati: hanya foto yang diambil mulai sekarang", trailing = { SdSwitch(existing, onChange = { existing = it; save(e = it) }) }); Divider()
                SettingRow(Lu.Upload, "Unggah bersamaan", detail = "$parallel file sekaligus · berlaku di pencadangan berikutnya", trailing = {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (1..4).forEach { n ->
                            Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(if (parallel == n) c.primary else c.surface2).pressable(onClick = { parallel = n; BackupStore.setParallel(context, n) }), contentAlignment = Alignment.Center) {
                                Text("$n", style = MaterialTheme.typography.labelLarge, color = if (parallel == n) Color.White else c.muted)
                            }
                        }
                    }
                })
            }
            Group("Album galeri", 2) {
                SettingRow(Lu.Images, "Album yang dicadangkan", detail = if (chosen == null) "Semua album" else if (chosen.isEmpty()) "Belum ada album dipilih" else "${chosen.size} album dipilih", onClick = pickAlbums)
            }
            val last = st.optLong("lastRun", 0L); val err = st.optString("error", "").takeIf { it.isNotBlank() && it != "null" }
            Panel("Status") {
                if (!live.running) Text(if (last > 0) "Terakhir berjalan ${timeAgo(java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date(last)))} · ${st.optInt("lastCount")} file terunggah" else "Belum pernah berjalan", style = MaterialTheme.typography.bodyMedium, color = c.muted)
                pending?.let { Text("$it file menunggu dicadangkan", style = MaterialTheme.typography.bodySmall, color = c.faint) }
                err?.let { Notice(it, c.dangerSoft to c.dangerInk) }
                if (live.running) SdButton("Jeda", { BackupLive.pause(context); say("Dijeda. Lanjutkan kapan saja."); tick++ }, kind = BtnKind.Secondary, icon = Lu.Clock)
                else if (paused) SdButton("Lanjutkan", { BackupLive.resume(context); say("Pencadangan dilanjutkan"); tick++ }, icon = Lu.Upload)
                else SdButton("Cadangkan sekarang", { BackupScheduler.now(context); say("Pencadangan dimulai"); tick++ }, kind = BtnKind.Secondary, icon = Lu.Upload)
            }
        }
    }
}

/** The files being sent right now, each with its own bar and a way to leave it for later. */
@Composable
private fun LiveCard(s: BackupLive.Snapshot, onPause: () -> Unit, onSkip: (String) -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current
    fun size(n: Long) = Formatter.formatShortFileSize(context, n)
    SdCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(Lu.Upload, c.primarySoft, c.primaryInk, size = 36.dp, iconSize = 18.dp)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text("Sedang mencadangkan", style = MaterialTheme.typography.titleSmall, color = c.ink)
                    Text("${s.done} dari ${s.total} file" + (if (s.skipped > 0) " · ${s.skipped} dilewati" else "") + (if (s.failed > 0) " · ${s.failed} gagal" else ""), style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
                Text("${s.percent}%", style = MaterialTheme.typography.labelLarge, color = c.primaryInk)
            }
            SdProgress(s.percent / 100f)
            if (s.files.isEmpty()) Text("Menyiapkan file…", style = MaterialTheme.typography.bodySmall, color = c.faint)
            s.files.forEach { f ->
                val frac = if (f.size > 0) (f.sent.toFloat() / f.size).coerceIn(0f, 1f) else 0f
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(f.name, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        TextButton(onClick = { onSkip(f.key) }) { Text("Lewati") }
                    }
                    SdProgress(frac, height = 4.dp)
                    val quiet = f.quiet && !f.finishing
                    Text(
                        when { f.finishing -> "Menyelesaikan di server…"; quiet -> "Tidak ada kemajuan. Ketuk Lewati jika macet."; else -> "${size(f.sent)} dari ${size(f.size)} · ${(frac * 100).toInt()}%" },
                        style = MaterialTheme.typography.labelSmall, color = if (quiet) c.warnInk else c.faint,
                    )
                }
            }
            SdButton("Jeda", onPause, kind = BtnKind.Secondary, icon = Lu.Clock)
        }
    }
}

/** Which gallery albums are backed up. Changes apply only after "Simpan". */
@Composable
private fun BackupAlbumsPage(say: (String) -> Unit, onDone: () -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current
    val saved = remember { BackupStore.albums(context) }
    var all by remember { mutableStateOf(saved == null) }
    var sel by remember { mutableStateOf(saved ?: emptySet()) }
    var albums by remember { mutableStateOf<List<Triple<String, String, Int>>?>(null) }
    LaunchedEffect(Unit) { albums = withContext(Dispatchers.IO) { try { BackupWorker.albums(context) } catch (e: Exception) { emptyList() } } }
    val changed = all != (saved == null) || (!all && sel != saved)
    val canSave = changed && (all || sel.isNotEmpty())
    Page {
        Group("Cakupan", 0) {
            SettingRow(Lu.Images, "Semua album", detail = "Cadangkan seluruh galeri, termasuk album baru", trailing = {
                SdSwitch(all, onChange = { v -> all = v; if (!v && sel.isEmpty()) sel = (albums ?: emptyList()).map { it.first }.toSet() })
            })
        }
        if (!all) {
            val list = albums
            Group("Pilih album", 1) {
                if (list == null) Box(Modifier.padding(14.dp)) { Skeleton(Modifier.fillMaxWidth().height(40.dp), 10.dp) }
                else if (list.isEmpty()) Text("Tidak ada album di galeri.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium, color = c.muted)
                else list.forEachIndexed { i, (id, name, n) ->
                    if (i > 0) Divider(14.dp)
                    Row(Modifier.fillMaxWidth().pressable(onClick = { sel = if (id in sel) sel - id else sel + id }).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(id in sel, { v -> sel = if (v) sel + id else sel - id })
                        Text(name, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("$n", Modifier.padding(end = 12.dp), style = MaterialTheme.typography.bodySmall, color = c.faint)
                    }
                }
            }
            if (list != null && list.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { sel = list.map { it.first }.toSet() }) { Text("Pilih semua") }
                TextButton(onClick = { sel = emptySet() }) { Text("Kosongkan") }
            }
            if (sel.isEmpty()) Notice("Pilih sedikitnya satu album, atau nyalakan “Semua album”.", c.warnSoft to c.warnInk)
        }
        SdButton("Simpan", {
            BackupStore.setAlbums(context, if (all) null else sel)
            say("Pilihan album disimpan")
            onDone()
        }, enabled = canSave, icon = Lu.Check)
    }
}

@Composable
private fun AppearancePage() {
    val c = MaterialTheme.sd; val context = LocalContext.current
    Page {
        Group("Tema", 0) {
            listOf(0 to ("Ikuti sistem" to "Sesuai pengaturan HP"), 1 to ("Terang" to "Latar putih"), 2 to ("Gelap" to "Latar navy gelap")).forEachIndexed { i, (m, t) ->
                if (i > 0) Divider()
                SettingRow(when (m) { 0 -> Lu.Phone; 1 -> Lu.Star; else -> Lu.Clock }, t.first, detail = t.second, onClick = { ThemePref.set(context, m) }, trailing = {
                    if (ThemePref.mode == m) IconTile(Lu.Check, c.primary, Color.White, size = 26.dp, iconSize = 15.dp, radius = 13.dp)
                })
            }
        }
    }
}

@Composable
private fun StoragePage(api: Api, say: (String) -> Unit) {
    val c = MaterialTheme.sd; val context = LocalContext.current; val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<StorageRow>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    var removing by remember { mutableStateOf<StorageRow?>(null) }
    LaunchedEffect(reload) { try { list = api.get("/storages") } catch (e: ApiException) { err = e.message } }
    fun browser(url: String) { try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(if (url.startsWith("http")) url else api.server.trimEnd('/') + url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { say("Tidak ada peramban.") } }
    Page {
        err?.let { EmptyState(Lu.Info, "Tidak dapat memuat", it) }
        val l = list
        if (l == null && err == null) repeat(2) { Skeleton(Modifier.fillMaxWidth().height(110.dp), 14.dp) }
        l?.forEachIndexed { i, st ->
            val ok = st.status == "CONNECTED"
            SdCard(Modifier.fillMaxWidth().riseIn(i)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(androidx.compose.foundation.shape.CircleShape).background(providerColor(st.provider)))
                        Column(Modifier.weight(1f).padding(start = 10.dp)) {
                            Text(st.name, style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(listOfNotNull(st.provider.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }, st.accountEmail).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        StatusPill(if (ok) "Terhubung" else "Perlu perhatian", if (ok) c.okSoft else c.warnSoft, if (ok) c.okInk else c.warnInk)
                    }
                    val q = st.quota
                    if (q?.total != null && q.total > 0 && q.used != null) { SdProgress(q.used.toFloat() / q.total, color = if (q.used.toFloat() / q.total > 0.9f) c.dangerInk else c.primary); Text("${Formatter.formatShortFileSize(context, q.used)} dari ${Formatter.formatShortFileSize(context, q.total)}", style = MaterialTheme.typography.bodySmall, color = c.muted) }
                    st.lastError?.takeIf { !ok && it.isNotBlank() }?.let { Notice(it, c.warnSoft to c.warnInk) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (!ok) Row(Modifier.weight(1f)) { SdButton("Hubungkan ulang", { scope.launch { try { val r = api.post<ReconnectResult>("/storages/${st.id}/reconnect"); if (r.url != null) browser(r.url) else { say("Diperiksa"); reload++ } } catch (e: ApiException) { say(e.message ?: "Gagal") } } }, kind = BtnKind.Secondary) }
                        if (!st.isDefault) Row(Modifier.weight(1f)) { SdButton("Putuskan", { removing = st }, kind = BtnKind.Danger) }
                    }
                }
            }
        }
        if (l != null) Panel("Hubungkan penyimpanan baru") {
            Text("Google Drive, OneDrive, Dropbox, S3, SFTP, WebDAV, dan SMB dihubungkan lewat halaman pengelolaan di situs web, karena butuh masuk ke akun penyedia. Penyimpanan yang baru terhubung langsung muncul di aplikasi ini.", style = MaterialTheme.typography.bodySmall, color = c.muted)
            SdButton("Buka halaman penyimpanan", { browser("/storage") }, kind = BtnKind.Secondary, icon = Lu.Link)
        }
    }
    removing?.let { st -> ConfirmDialog("Putuskan “${st.name}”?", "Hanya sambungannya yang dihapus. File di penyedia tidak disentuh.", "Putuskan", { scope.launch { try { api.send("DELETE", "/storages/${st.id}"); say("Terputus"); reload++ } catch (e: ApiException) { say(e.message ?: "Gagal") } } }) { removing = null } }
}

@Composable
private fun MembersPage(api: Api, me: Me, role: String, say: (String) -> Unit) {
    val c = MaterialTheme.sd; val scope = rememberCoroutineScope(); val context = LocalContext.current
    val admin = role == "OWNER" || role == "ADMIN"
    var data by remember { mutableStateOf<Members?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    var email by remember { mutableStateOf("") }; var inviteRole by remember { mutableStateOf("MEMBER") }
    var link by remember { mutableStateOf<String?>(null) }
    var menuFor by remember { mutableStateOf<Member?>(null) }
    var removing by remember { mutableStateOf<Member?>(null) }
    LaunchedEffect(reload) { try { data = api.get("/workspaces/${me.activeWorkspaceId}/members") } catch (e: ApiException) { err = e.message } }
    fun run(done: String, block: suspend () -> Unit) { scope.launch { try { block(); say(done); reload++ } catch (e: ApiException) { say(e.message ?: "Gagal") } } }
    Page {
        err?.let { EmptyState(Lu.Info, "Tidak dapat memuat", it) }
        val d = data
        if (d == null && err == null) repeat(3) { Skeleton(Modifier.fillMaxWidth().height(64.dp), 14.dp) }
        if (d != null && admin) Panel("Undang anggota") {
            SdField(email, { email = it.trim() }, "Email", keyboard = androidx.compose.ui.text.input.KeyboardType.Email)
            app.superdrive.ui.design.SlidingTabs(listOf("Anggota", "Pembaca", "Admin"), listOf("MEMBER", "VIEWER", "ADMIN").indexOf(inviteRole), { inviteRole = listOf("MEMBER", "VIEWER", "ADMIN")[it] })
            SdButton("Buat undangan", { scope.launch { try { val r = api.post<InviteResult>("/workspaces/${me.activeWorkspaceId}/invitations", buildJsonObject { put("email", email); put("role", inviteRole) }); link = r.link; say(if (r.emailed) "Undangan dikirim lewat email" else "Undangan dibuat"); email = ""; reload++ } catch (e: ApiException) { say(e.message ?: "Gagal") } } }, enabled = email.contains('@'), icon = Lu.Plus)
            link?.let { l ->
                Notice("Bagikan tautan ini ke orang yang diundang. Berlaku 7 hari dan hanya ditampilkan sekali.", c.primarySoft to c.primaryInk, Lu.Link)
                Text(l, style = MaterialTheme.typography.bodySmall, color = c.ink)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.weight(1f)) { SdButton("Salin", { (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Undangan", l)); say("Disalin") }, kind = BtnKind.Secondary, icon = Lu.Copy) }
                    Row(Modifier.weight(1f)) { SdButton("Kirim", { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, l), "Kirim undangan")) }, kind = BtnKind.Secondary, icon = Lu.Share) }
                }
            }
        }
        d?.let {
            SectionLabel("Anggota (${it.members.size})")
            SdCard(Modifier.fillMaxWidth()) {
                it.members.forEachIndexed { i, m ->
                    if (i > 0) Divider(66.dp)
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.name, size = 40.dp)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(m.name + if (m.userId == me.user.id) " (Anda)" else "", style = MaterialTheme.typography.titleSmall, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(m.email, style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        StatusPill(roleLabel(m.role), if (m.role == "OWNER") c.violetSoft else c.primarySoft, if (m.role == "OWNER") c.violetInk else c.primaryInk)
                        if (admin && m.userId != me.user.id) BarIcon(Lu.More, "Atur ${m.name}", { menuFor = m })
                    }
                }
            }
            if (it.invitations.isNotEmpty()) {
                SectionLabel("Undangan tertunda")
                SdCard(Modifier.fillMaxWidth()) {
                    it.invitations.forEachIndexed { i, v ->
                        if (i > 0) Divider(66.dp)
                        SettingRow(Lu.Clock, v.email, detail = "${roleLabel(v.role)} · berlaku sampai ${v.expiresAt.take(10)}", tone = c.warnSoft to c.warnInk, trailing = { if (admin) BarIcon(Lu.X, "Batalkan undangan", { run("Undangan dibatalkan") { api.send("DELETE", "/workspaces/${me.activeWorkspaceId}/invitations/${v.id}") } }, tint = c.dangerInk) })
                    }
                }
            }
        }
        if (!admin && d != null) Notice("Hanya pemilik dan admin yang dapat mengundang atau mengatur anggota.", c.surface2 to c.muted)
    }
    menuFor?.let { m ->
        androidx.compose.material3.AlertDialog(onDismissRequest = { menuFor = null }, containerColor = c.surface, shape = RoundedCornerShape(22.dp), title = { Text(m.name) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Ubah peran", style = MaterialTheme.typography.labelLarge, color = c.muted)
                listOf("OWNER", "ADMIN", "MEMBER", "VIEWER").filter { role == "OWNER" || it != "OWNER" }.forEach { r ->
                    Row(Modifier.fillMaxWidth().pressable(onClick = { menuFor = null; if (r != m.role) run("Peran diubah") { api.send("PATCH", "/workspaces/${me.activeWorkspaceId}/members/${m.userId}", buildJsonObject { put("role", r) }) } }, shape = RoundedCornerShape(12.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(roleLabel(r), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = c.ink); if (r == m.role) Icon(Lu.Check, null, tint = c.primaryInk, modifier = Modifier.size(18.dp))
                    }
                }
            } },
            confirmButton = { TextButton(onClick = { menuFor = null; removing = m }) { Text("Keluarkan dari ruang kerja", color = c.dangerInk) } },
            dismissButton = { TextButton(onClick = { menuFor = null }) { Text("Tutup") } })
    }
    removing?.let { m -> ConfirmDialog("Keluarkan ${m.name}?", "Akses ke ruang kerja dan penyimpanan dicabut. File tidak dihapus.", "Keluarkan", { run("Anggota dikeluarkan") { api.send("DELETE", "/workspaces/${me.activeWorkspaceId}/members/${m.userId}") } }) { removing = null } }
}

@Composable
private fun ActivityPage(api: Api) {
    val c = MaterialTheme.sd
    var items by remember { mutableStateOf<List<AuditEntry>?>(null) }
    var total by remember { mutableStateOf(0) }
    var err by remember { mutableStateOf<String?>(null) }
    var page by remember { mutableStateOf(1) }
    LaunchedEffect(page) { try { val r = api.get<AuditPage>("/audit-logs?page=$page&limit=40"); items = (items ?: emptyList()) + r.items; total = r.total } catch (e: ApiException) { err = e.message } }
    Page {
        err?.let { EmptyState(Lu.Info, "Tidak dapat memuat", it) }
        val l = items
        if (l == null && err == null) repeat(5) { Skeleton(Modifier.fillMaxWidth().height(52.dp), 12.dp) }
        if (l != null) SdCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                l.forEachIndexed { i, a ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.Top) {
                        androidx.compose.foundation.layout.Box(Modifier.padding(top = 6.dp).size(8.dp).clip(androidx.compose.foundation.shape.CircleShape).background(c.primary))
                        Column(Modifier.padding(start = 12.dp)) { Text("${a.userName ?: "Sistem"} ${auditLabel(a.action)}", style = MaterialTheme.typography.bodyMedium, color = c.ink); Text(timeAgo(a.createdAt), style = MaterialTheme.typography.bodySmall, color = c.faint) }
                    }
                    if (i < l.lastIndex) androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                }
            }
        }
        if (l != null && l.size < total) SdButton("Muat lebih banyak", { page++ }, kind = BtnKind.Secondary)
    }
}
