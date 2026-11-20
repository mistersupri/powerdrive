package app.superdrive.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.superdrive.R
import app.superdrive.core.Session
import app.superdrive.ui.auth.AuthState
import app.superdrive.ui.auth.AuthViewModel
import app.superdrive.ui.auth.LoginScreen
import app.superdrive.ui.files.FilesScreen
import app.superdrive.ui.files.FilesViewModel
import app.superdrive.ui.media.MediaScreen
import app.superdrive.ui.media.MediaViewModel
import app.superdrive.ui.theme.Motion
import app.superdrive.ui.design.Lu
import app.superdrive.ui.design.NavItem
import app.superdrive.ui.design.SdBottomBar
import coil3.ImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory

private val TAB_LABELS = listOf("Beranda", "File", "Media", "Berbagi", "Transfer")
private val TAB_ICONS by lazy { listOf(Lu.Dashboard, Lu.Folder, Lu.Images, Lu.Users, Lu.Transfer) }

/** The whole native interface: sign-in, then five tabs. Tabs that are not native yet show the website's page. */
@Composable
fun NativeApp(session: Session, loginLink: android.net.Uri?, onLoginLinkHandled: () -> Unit) {
    val api = session.api ?: return
    val auth: AuthViewModel = viewModel(factory = viewModelFactory { initializer { AuthViewModel(api) { session.workspaceId = it } } })
    val state by auth.state.collectAsStateWithLifecycle()
    val google by auth.google.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(loginLink) { loginLink?.let { auth.onLoginLink(context, it); onLoginLinkHandled() } }
    when (val s = state) {
        AuthState.Checking -> app.superdrive.ui.auth.Splash()
        is AuthState.SignedOut, is AuthState.Mfa -> LoginScreen(s, onLogin = auth::login, onVerify = auth::verify, onBackToPassword = auth::check, server = api.server, google = google, onGoogle = { auth.startGoogle(context) })
        is AuthState.SignedIn -> Shell(session, s.me, onLogout = auth::logout)
    }
}

@Composable
private fun Shell(session: Session, me: app.superdrive.core.Me, onLogout: () -> Unit) {
    val api = session.api!!
    var tab by rememberSaveable { mutableIntStateOf(1) }
    val context = LocalContext.current
    val imageLoader = remember { ImageLoader.Builder(context).components { add(OkHttpNetworkFetcherFactory(callFactory = { api.http })) }.build() }
    val files: FilesViewModel = viewModel(factory = viewModelFactory { initializer { FilesViewModel(api, uploader = app.superdrive.core.Uploader(context.applicationContext, api)) } })
    val media: MediaViewModel = viewModel(factory = viewModelFactory { initializer { MediaViewModel(api) } })
    val home: app.superdrive.ui.home.HomeViewModel = viewModel(factory = viewModelFactory { initializer { app.superdrive.ui.home.HomeViewModel(api) } })
    val transfers: app.superdrive.ui.transfers.TransfersViewModel = viewModel(factory = viewModelFactory { initializer { app.superdrive.ui.transfers.TransfersViewModel(api) } })
    val shared: app.superdrive.ui.shared.SharedViewModel = viewModel(factory = viewModelFactory { initializer { app.superdrive.ui.shared.SharedViewModel(api) } })
    val homeState by home.state.collectAsStateWithLifecycle()
    var settings by remember { mutableStateOf(false) }
    var fullscreen by remember { mutableStateOf(false) } // the media viewer covers the bottom bar

    if (settings) { app.superdrive.ui.settings.SettingsScreen(api, me, isAdmin = me.workspaces.firstOrNull { it.id == me.activeWorkspaceId }?.role in listOf("OWNER", "ADMIN"), onBack = { settings = false }, onLogout = onLogout); return }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            AnimatedVisibility(visible = !fullscreen, enter = expandVertically(tween(220, easing = Motion.Drawer)) + fadeIn(tween(200)), exit = shrinkVertically(tween(160)) + fadeOut(tween(120))) {
                val active = homeState.dashboard?.transfers?.active ?: 0
                SdBottomBar(TAB_LABELS.mapIndexed { i, l -> NavItem(l, TAB_ICONS[i], if (i == 4) active else 0) }, tab, onSelect = { tab = it })
            }
        },
    ) { pad ->
        // A tab change slides the new screen in from the side its tab is on, like the website's bar did.
        AnimatedContent(
            targetState = tab, modifier = Modifier.fillMaxSize().then(Modifier), label = "tabs",
            transitionSpec = {
                val dir = if (targetState > initialState) 1 else -1
                (slideInHorizontally(tween(300, easing = Motion.EaseOut)) { dir * it / 8 } + fadeIn(tween(220, easing = Motion.EaseOut))) togetherWith
                    (slideOutHorizontally(tween(220, easing = Motion.EaseOut)) { -dir * it / 10 } + fadeOut(tween(140)))
            },
        ) { i ->
            Box(Modifier.fillMaxSize().then(Modifier).padding(pad)) {
                if (i == 0) app.superdrive.ui.home.HomeScreen(home, me.user.name, onOpenFiles = { tab = 1 }, onOpenTransfers = { tab = 4 }, onSettings = { settings = true })
                else if (i == 3) app.superdrive.ui.shared.SharedScreen(shared, session.server!!)
                else if (i == 4) app.superdrive.ui.transfers.TransfersScreen(transfers)
                else if (i == 1) FilesScreen(files, api, imageLoader, isAdmin = me.workspaces.firstOrNull { it.id == me.activeWorkspaceId }?.role in listOf("OWNER", "ADMIN"), onLogout = onLogout, onFullscreen = { fullscreen = it })
                else if (i == 2) MediaScreen(media, api, imageLoader, me.user.id, onFullscreen = { fullscreen = it })
            }
        }
    }
}
