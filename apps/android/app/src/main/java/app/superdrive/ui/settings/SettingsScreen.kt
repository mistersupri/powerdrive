package app.superdrive.ui.settings

import android.Manifest
import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.superdrive.AlbumVault
import app.superdrive.AppLock
import app.superdrive.BackupScheduler
import app.superdrive.BackupStore
import app.superdrive.BuildConfig
import app.superdrive.Updater
import app.superdrive.core.Api
import app.superdrive.core.ApiException
import app.superdrive.core.Me
import app.superdrive.core.PrivateStatus
import app.superdrive.core.StorageInfo
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable private data class MfaStatus(val enabled: Boolean = false, val recoveryLeft: Int = 0)
@Serializable private data class MfaSetup(val secret: String = "", val otpauthUrl: String = "")
@Serializable private data class Recovery(val recoveryCodes: List<String> = emptyList())
@Serializable private data class Member(val userId: String, val name: String, val email: String, val role: String)
@Serializable private data class Members(val members: List<Member> = emptyList())
@Serializable private data class Dash(val storageList: List<StorageInfo> = emptyList())

private enum class Sub(val title: String) { Hub("Pengaturan"), Profile("Profil"), Security("Keamanan"), Private("Album privat"), App("Aplikasi"), Storage("Penyimpanan"), Members("Anggota") }

private fun android.content.Context.activity(): AppCompatActivity? { var c = this; while (c is android.content.ContextWrapper) { if (c is AppCompatActivity) return c; c = c.baseContext }; return null }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(api: Api, me: Me, onBack: () -> Unit, onLogout: () -> Unit) {
    var sub by remember { mutableStateOf(Sub.Hub) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val say: (String) -> Unit = { m -> scope.launch { snack.showSnackbar(m) } }
    BackHandler { if (sub == Sub.Hub) onBack() else sub = Sub.Hub }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background, contentWindowInsets = WindowInsets(0, 0, 0, 0), snackbarHost = { SnackbarHost(snack) },
        topBar = { TopAppBar(title = { Text(sub.title, style = MaterialTheme.typography.titleLarge) }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            navigationIcon = { IconButton(onClick = { if (sub == Sub.Hub) onBack() else sub = Sub.Hub }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali") } }) },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (sub) {
                Sub.Hub -> Column(Modifier.verticalScroll(rememberScrollState())) {
                    Sub.entries.filter { it != Sub.Hub }.forEach { s ->
                        ListItem(headlineContent = { Text(s.title) }, supportingContent = { Text(when (s) { Sub.Profile -> me.user.name + " · " + me.user.email; Sub.Security -> "Kata sandi dan verifikasi dua langkah"; Sub.Private -> "Kata sandi dan sidik jari"; Sub.App -> "Kunci, cadangan foto, pembaruan"; Sub.Storage -> "Kapasitas tiap penyimpanan"; Sub.Members -> "Anggota ruang kerja"; Sub.Hub -> "" }) },
                            modifier = Modifier.clickable { sub = s }, colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    Text("Pengaturan sistem dan website hanya tersedia di situs web.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Sub.Profile -> ProfilePage(api, me, say, onLogout)
                Sub.Security -> SecurityPage(api, say)
                Sub.Private -> PrivatePage(api, me, say)
                Sub.App -> AppPage(say)
                Sub.Storage -> StoragePage(api)
                Sub.Members -> MembersPage(api, me)
            }
        }
    }
}

@Composable private fun Page(content: @Composable () -> Unit) = Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
@Composable private fun Pw(label: String, value: String, set: (String) -> Unit) = OutlinedTextField(value, set, label = { Text(label) }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())

@Composable
private fun ProfilePage(api: Api, me: Me, say: (String) -> Unit, onLogout: () -> Unit) {
    var name by remember { mutableStateOf(me.user.name) }
    var cur by remember { mutableStateOf("") }; var new by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Page {
        Text(me.user.email, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(name, { name = it }, label = { Text("Nama") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Button(enabled = name.isNotBlank() && name != me.user.name, onClick = { scope.launch { try { api.send("PATCH", "/auth/profile", buildJsonObject { put("name", name.trim()) }); say("Nama disimpan") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }) { Text("Simpan nama") }
        HorizontalDivider()
        Text("Ganti kata sandi", style = MaterialTheme.typography.titleSmall)
        Pw("Kata sandi saat ini", cur) { cur = it }; Pw("Kata sandi baru (min. 8 karakter)", new) { new = it }
        Button(enabled = cur.isNotBlank() && new.length >= 8, onClick = { scope.launch { try { api.send("POST", "/auth/change-password", buildJsonObject { put("currentPassword", cur); put("newPassword", new) }); cur = ""; new = ""; say("Kata sandi diganti") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }) { Text("Ganti kata sandi") }
        HorizontalDivider()
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text("Keluar") }
    }
}

@Composable
private fun SecurityPage(api: Api, say: (String) -> Unit) {
    var st by remember { mutableStateOf<MfaStatus?>(null) }
    var setup by remember { mutableStateOf<MfaSetup?>(null) }
    var code by remember { mutableStateOf("") }; var pw by remember { mutableStateOf("") }
    var codes by remember { mutableStateOf<List<String>?>(null) }
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    LaunchedEffect(Unit) { try { st = api.get("/auth/mfa") } catch (e: ApiException) { say(e.message ?: "Gagal") } }
    Page {
        val s = st
        if (s == null) LinearProgressIndicator(Modifier.fillMaxWidth()) else {
            Text(if (s.enabled) "Verifikasi dua langkah aktif · ${s.recoveryLeft} kode pemulihan tersisa" else "Verifikasi dua langkah belum aktif", style = MaterialTheme.typography.titleSmall)
            codes?.let { cs -> Text("Simpan kode pemulihan ini. Tiap kode hanya berlaku sekali:", style = MaterialTheme.typography.bodyMedium); Text(cs.joinToString("\n"), style = MaterialTheme.typography.bodyLarge) }
            if (!s.enabled && setup == null) Button(onClick = { scope.launch { try { setup = api.post("/auth/mfa/setup") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }) { Text("Aktifkan") }
            setup?.let { su ->
                Text("Buka aplikasi autentikator, tambahkan akun dengan kunci ini, lalu masukkan kode 6 angka.", style = MaterialTheme.typography.bodyMedium)
                Text(su.secret, style = MaterialTheme.typography.titleMedium)
                OutlinedButton(onClick = { try { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(su.otpauthUrl))) } catch (e: Exception) { say("Tidak ada aplikasi autentikator.") } }) { Text("Buka di aplikasi autentikator") }
                OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, label = { Text("Kode") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(enabled = code.length == 6, onClick = { scope.launch { try { val r = api.post<Recovery>("/auth/mfa/enable", buildJsonObject { put("code", code) }); codes = r.recoveryCodes; setup = null; code = ""; st = MfaStatus(true, r.recoveryCodes.size) } catch (e: ApiException) { say(e.message ?: "Kode salah") } } }) { Text("Konfirmasi") }
            }
            if (s.enabled) {
                Pw("Kata sandi untuk menonaktifkan", pw) { pw = it }
                OutlinedButton(enabled = pw.isNotBlank(), onClick = { scope.launch { try { api.send("POST", "/auth/mfa/disable", buildJsonObject { put("password", pw) }); pw = ""; st = MfaStatus(false, 0); say("Dinonaktifkan") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }) { Text("Nonaktifkan") }
            }
        }
    }
}

@Composable
private fun PrivatePage(api: Api, me: Me, say: (String) -> Unit) {
    var st by remember { mutableStateOf<PrivateStatus?>(null) }
    var cur by remember { mutableStateOf("") }; var new by remember { mutableStateOf("") }
    var enrolled by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    val vault = remember { context.activity()?.let { AlbumVault(it) } }
    LaunchedEffect(Unit) { try { st = api.get<app.superdrive.core.Albums>("/albums").privateStatus } catch (e: ApiException) { say(e.message ?: "Gagal") }; enrolled = vault?.enrolledFor(me.user.id) == true }
    Page {
        val s = st
        if (s == null) LinearProgressIndicator(Modifier.fillMaxWidth()) else {
            Text(if (s.hasPassword) "Kata sandi album privat sudah dibuat · ${s.count} album" else "Belum ada kata sandi album privat", style = MaterialTheme.typography.titleSmall)
            if (s.hasPassword) Pw("Kata sandi saat ini", cur) { cur = it }
            Pw(if (s.hasPassword) "Kata sandi baru (min. 6 karakter)" else "Buat kata sandi (min. 6 karakter)", new) { new = it }
            Button(enabled = new.length >= 6 && (!s.hasPassword || cur.isNotBlank()), onClick = { scope.launch {
                try { api.send("POST", "/albums-private/password", buildJsonObject { put("password", new); if (s.hasPassword) put("currentPassword", cur) }); st = s.copy(hasPassword = true); vault?.clear(); enrolled = false; cur = ""; new = ""; say("Kata sandi disimpan") } catch (e: ApiException) { say(e.message ?: "Gagal") } } }) { Text("Simpan kata sandi") }
            if (s.hasPassword && vault?.available() == true) {
                HorizontalDivider()
                Text(if (enrolled) "Sidik jari aktif untuk membuka album privat" else "Buka album privat dengan sidik jari", style = MaterialTheme.typography.titleSmall)
                if (enrolled) OutlinedButton(onClick = { vault.clear(); enrolled = false }) { Text("Matikan sidik jari") }
                else { Pw("Kata sandi album privat", cur) { cur = it }
                    Button(enabled = cur.isNotBlank(), onClick = { scope.launch {
                        try { api.send("POST", "/albums-private/unlock", buildJsonObject { put("password", cur) }); vault.enroll(me.user.id, cur) { ok, _ -> enrolled = ok; cur = ""; say(if (ok) "Sidik jari diaktifkan" else "Dibatalkan") } } catch (e: ApiException) { say(e.message ?: "Kata sandi salah") } } }) { Text("Aktifkan sidik jari") } }
            }
        }
    }
}

@Composable
private fun AppPage(say: (String) -> Unit) {
    val context = LocalContext.current; val activity = context.activity()
    val lock = remember { activity?.let { AppLock(it) } }
    var lockOn by remember { mutableStateOf(lock?.enabled == true) }
    var backupOn by remember { mutableStateOf(BackupStore.enabled(context)) }
    var wifi by remember { mutableStateOf(BackupStore.wifiOnly(context)) }
    var videos by remember { mutableStateOf(BackupStore.videos(context)) }
    val askPerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { _ ->
        if (BackupStore.hasPermission(context)) { BackupStore.save(context, true, wifi, videos, BackupStore.existing(context)); BackupScheduler.apply(context); backupOn = true } else say("Izin akses foto diperlukan.")
    }
    fun saveBackup(on: Boolean, w: Boolean, v: Boolean) { BackupStore.save(context, on, w, v, BackupStore.existing(context)); BackupScheduler.apply(context) }
    Page {
        if (lock != null) {
            SwitchRow("Kunci sidik jari", lockOn, enabled = lock.available()) { want ->
                if (want) lock.authenticate("Aktifkan kunci", null) { ok -> if (ok) { lock.enabled = true; lockOn = true } } else { lock.enabled = false; lockOn = false }
            }
            if (!lock.available()) Text("Perangkat ini belum punya sidik jari atau kunci layar.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        HorizontalDivider()
        SwitchRow("Cadangkan foto dan video otomatis", backupOn) { want ->
            if (want) { if (BackupStore.hasPermission(context)) { saveBackup(true, wifi, videos); backupOn = true } else askPerms.launch(BackupStore.permissionsToAsk()) } else { saveBackup(false, wifi, videos); backupOn = false }
        }
        if (backupOn) {
            SwitchRow("Hanya lewat Wi-Fi", wifi) { wifi = it; saveBackup(true, it, videos) }
            SwitchRow("Sertakan video", videos) { videos = it; saveBackup(true, wifi, it) }
        }
        HorizontalDivider()
        Text("Versi ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium)
        if (activity != null) OutlinedButton(onClick = { Updater(activity).check(true) }, modifier = Modifier.fillMaxWidth()) { Text("Periksa pembaruan") }
    }
}

@Composable private fun SwitchRow(label: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) =
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text(label, Modifier.weight(1f)); Switch(checked = checked, enabled = enabled, onCheckedChange = onChange) }

@Composable
private fun StoragePage(api: Api) {
    var list by remember { mutableStateOf<List<StorageInfo>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    LaunchedEffect(Unit) { try { list = api.get<Dash>("/dashboard").storageList } catch (e: ApiException) { err = e.message } }
    Page {
        err?.let { Text(it) }
        val l = list
        if (l == null && err == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        l?.forEach { st ->
            Text(st.name, style = MaterialTheme.typography.titleSmall); Text(st.provider + " · " + st.status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val q = st.quota
            if (q?.total != null && q.total > 0 && q.used != null) { LinearProgressIndicator(progress = { (q.used.toFloat() / q.total).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth()); Text("${Formatter.formatShortFileSize(context, q.used)} / ${Formatter.formatShortFileSize(context, q.total)}", style = MaterialTheme.typography.bodySmall) }
            HorizontalDivider()
        }
    }
}

@Composable
private fun MembersPage(api: Api, me: Me) {
    var list by remember { mutableStateOf<List<Member>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { try { list = api.get<Members>("/workspaces/${me.activeWorkspaceId}/members").members } catch (e: ApiException) { err = e.message } }
    Page {
        err?.let { Text(it) }
        if (list == null && err == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        list?.forEach { m -> Text(m.name, style = MaterialTheme.typography.titleSmall); Text(m.email + " · " + m.role, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant); HorizontalDivider() }
        Text("Mengundang atau mengubah peran anggota dilakukan di situs web.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
