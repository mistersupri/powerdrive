package app.superdrive.ui.media

import android.text.format.Formatter
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitVerticalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.verticalDrag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.verticalScroll
import app.superdrive.ui.theme.sd
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import kotlinx.coroutines.Job
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.MediaItem
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import app.superdrive.core.Api
import app.superdrive.core.FileEntry
import app.superdrive.ui.files.enqueueDownload
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import kotlinx.coroutines.launch

/**
 * Full-screen viewer, like a phone's gallery: swipe sideways between items, pinch or double-tap to zoom,
 * drag down to close, tap to hide the bars (and the system bars with them). Videos play in Media3's player.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaViewer(items: List<FileEntry>, startIndex: Int, api: Api, imageLoader: ImageLoader, onClose: () -> Unit) {
    val context = LocalContext.current; val view = LocalView.current; val scope = rememberCoroutineScope()
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0))) { items.size }
    var chrome by remember { mutableStateOf(true) }
    var zoomed by remember { mutableStateOf(false) }
    var dragY by remember { mutableFloatStateOf(0f) }
    // The details drawer: `reveal` is how many pixels of it are showing, following the finger while swiping up.
    var reveal by remember { mutableFloatStateOf(0f) }
    var rootH by remember { mutableFloatStateOf(0f) }
    val panelH = rootH * 0.62f
    var anim by remember { mutableStateOf<Job?>(null) }
    fun moveReveal(target: Float, velocity: Float = 0f) {
        anim?.cancel()
        anim = scope.launch { Animatable(reveal).animateTo(target, spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow), initialVelocity = -velocity) { reveal = value.coerceIn(0f, panelH) } }
    }
    BackHandler { if (reveal > 0f) moveReveal(0f) else onClose() }

    // One vertical gesture for the photo and the drawer's handle: up pulls the drawer out under the finger, down pushes it back or closes the viewer.
    val gestures = Modifier.pointerInput(zoomed, panelH) {
        if (zoomed || panelH <= 0f) return@pointerInput
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val tracker = VelocityTracker(); tracker.addPosition(down.uptimeMillis, down.position)
            var drawerMode = false
            val first = awaitVerticalTouchSlopOrCancellation(down.id) { change, over ->
                drawerMode = over < 0f || reveal > 0f
                anim?.cancel()
                change.consume()
                if (drawerMode) reveal = (reveal - over).coerceIn(0f, panelH) else dragY = (dragY + over).coerceAtLeast(0f)
            } ?: return@awaitEachGesture
            tracker.addPosition(first.uptimeMillis, first.position)
            verticalDrag(first.id) { change ->
                tracker.addPosition(change.uptimeMillis, change.position)
                val dy = change.positionChange().y
                if (drawerMode) reveal = (reveal - dy).coerceIn(0f, panelH) else dragY = (dragY + dy).coerceAtLeast(0f)
                change.consume()
            }
            val v = tracker.calculateVelocity().y
            if (drawerMode) {
                // A quick flick decides by itself; a slow drag settles on whichever side is nearer.
                moveReveal(when { v < -700f -> panelH; v > 700f -> 0f; reveal > panelH / 2f -> panelH; else -> 0f }, v)
            } else if (dragY > 260f || (v > 1500f && dragY > 40f)) onClose()
            else if (dragY > 0f) scope.launch { val a = Animatable(dragY); a.animateTo(0f, tween(220)) { dragY = value } }
        }
    }

    // The system bars go with the viewer's own bars, so the picture really is full screen.
    val window = (context as? ComponentActivity)?.window
    LaunchedEffect(chrome) {
        if (window == null) return@LaunchedEffect
        val c = WindowCompat.getInsetsController(window, view)
        if (chrome) c.show(WindowInsetsCompat.Type.systemBars()) else { c.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; c.hide(WindowInsetsCompat.Type.systemBars()) }
    }
    DisposableEffect(Unit) { onDispose { window?.let { WindowCompat.getInsetsController(it, view).show(WindowInsetsCompat.Type.systemBars()) } } }
    LaunchedEffect(pager.currentPage) { zoomed = false }

    Box(Modifier.fillMaxSize().onSizeChanged { rootH = it.height.toFloat() }.background(Color.Black.copy(alpha = (1f - dragY / 900f).coerceIn(0f, 1f)))) {
        Box(
            Modifier.fillMaxSize()
                .then(gestures)
                .graphicsLayer {
                    val frac = if (panelH > 0f) reveal / panelH else 0f
                    translationY = dragY - reveal * 0.3f
                    val sc = (1f - (dragY / 2400f).coerceIn(0f, 0.25f)) * (1f - 0.12f * frac); scaleX = sc; scaleY = sc
                },
        ) {
            HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, beyondViewportPageCount = 1, key = { items[it].id }) { page ->
                val f = items[page]
                if (f.mimeType?.startsWith("video/") == true) VideoPage(f, api, imageLoader, active = page == pager.settledPage)
                else ZoomableImage(f, api, imageLoader, onZoom = { zoomed = it }, onTap = { if (reveal > 0f) moveReveal(0f) else chrome = !chrome })
            }
        }

        val current = items.getOrNull(pager.currentPage)
        AnimatedVisibility(chrome && dragY == 0f && reveal == 0f, Modifier.align(Alignment.TopCenter), enter = fadeIn(tween(160)), exit = fadeOut(tween(120))) {
            Row(Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Kembali", tint = Color.White) }
                Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    Text(current?.name ?: "", color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                    Text(listOfNotNull(app.superdrive.ui.design.formatDateTime(current?.modifiedAt), "${pager.currentPage + 1} dari ${items.size}").joinToString(" · "), color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { moveReveal(panelH) }) { Icon(Icons.Default.Info, contentDescription = "Detail", tint = Color.White) }
            }
        }
        AnimatedVisibility(chrome && dragY == 0f && reveal == 0f, Modifier.align(Alignment.BottomCenter), enter = fadeIn(tween(160)), exit = fadeOut(tween(120))) {
            Column(Modifier.fillMaxWidth().background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)))).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(app.superdrive.ui.design.Lu.ChevronDown, null, tint = Color.White.copy(alpha = 0.8f), modifier = Modifier.size(22.dp).graphicsLayer { rotationZ = 180f })
                Text("Geser ke atas untuk detail", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelMedium)
                Text(listOfNotNull(current?.let { app.superdrive.ui.design.typeLabel(it) }, current?.size?.let { Formatter.formatShortFileSize(context, it) }, app.superdrive.ui.design.formatDateTime(current?.modifiedAt)).joinToString(" · "), color = Color.White, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 6.dp))
            }
        }

        if (reveal > 0.5f) items.getOrNull(pager.currentPage)?.let { f ->
            val c = MaterialTheme.sd
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(with(LocalDensity.current) { panelH.toDp() })
                    .graphicsLayer { translationY = panelH - reveal }
                    .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)).background(c.surface)
                    .pointerInput(Unit) { detectTapGestures { } },
            ) {
                Column(Modifier.fillMaxWidth().then(gestures).padding(top = 10.dp, bottom = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(width = 40.dp, height = 4.dp).clip(RoundedCornerShape(50)).background(c.lineStrong))
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Detail", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, color = c.ink)
                        TextButton(onClick = { enqueueDownload(context, api.download(f), f.name, f.mimeType) }) { Text("Unduh") }
                    }
                }
                Column(Modifier.weight(1f).verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding().padding(bottom = 16.dp)) {
                    app.superdrive.ui.files.MetadataView(f, remember { app.superdrive.core.FileOps(api) })
                }
            }
        }
    }
}

@Composable
private fun ZoomableImage(f: FileEntry, api: Api, imageLoader: ImageLoader, onZoom: (Boolean) -> Unit, onTap: () -> Unit) {
    val context = LocalContext.current
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var box by remember { mutableStateOf(IntSize.Zero) }
    // The quick 2048 px rendition first; the original once zoomed in.
    val url = if (scale > 1.5f || !f.hasThumbnail) api.preview(f) else api.thumbnail(f, 2048)
    fun limit(o: Offset, s: Float) = Offset(o.x.coerceIn(-box.width * (s - 1) / 2f, box.width * (s - 1) / 2f), o.y.coerceIn(-box.height * (s - 1) / 2f, box.height * (s - 1) / 2f))

    Box(
        Modifier.fillMaxSize().onSizeChanged { box = it }
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onTap() },
                    onDoubleTap = { p ->
                        if (scale > 1.05f) { scale = 1f; offset = Offset.Zero } else {
                            scale = 2.6f; offset = limit(Offset((box.width / 2f - p.x) * (scale - 1f), (box.height / 2f - p.y) * (scale - 1f)), scale)
                        }
                        onZoom(scale > 1.05f)
                    },
                )
            }
            .pointerInput(Unit) {
                // Only claims the touch when pinching or already zoomed in, so a single finger still swipes the pager.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        if (event.changes.size > 1 || scale > 1.01f) {
                            val s = (scale * event.calculateZoom()).coerceIn(1f, 6f)
                            offset = limit(offset + event.calculatePan(), s); scale = s
                            onZoom(scale > 1.01f)
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                    if (scale < 1.02f) { scale = 1f; offset = Offset.Zero; onZoom(false) }
                }
            },
    ) {
        AsyncImage(
            model = ImageRequest.Builder(context).data(url).build(), imageLoader = imageLoader, contentDescription = f.name, contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y },
        )
    }
}

@Composable
private fun VideoPage(f: FileEntry, api: Api, imageLoader: ImageLoader, active: Boolean) {
    val context = LocalContext.current
    if (!active) {
        // Neighbouring pages only show a still, so just one player runs at a time.
        AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(f, 1024)).build(), imageLoader = imageLoader, contentDescription = f.name, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        return
    }
    val player = remember(f.id) {
        ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(api.http))).build().apply {
            setMediaItem(MediaItem.fromUri(api.preview(f))); playWhenReady = true; prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = true; controllerShowTimeoutMs = 2500; setBackgroundColor(android.graphics.Color.BLACK) } }, modifier = Modifier.fillMaxSize())
}
