package app.superdrive.ui.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.superdrive.core.Api
import app.superdrive.core.FileEntry
import app.superdrive.core.FolderPeek
import app.superdrive.ui.design.kindStyle
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade

private class FolderTone(val back: Color, val top: Color, val bottom: Color)
private val TONES = listOf(
    FolderTone(Color(0xFF3B78D8), Color(0xFF72A8F6), Color(0xFF2F6CD0)),
    FolderTone(Color(0xFFEC7A38), Color(0xFFFFA86E), Color(0xFFEE7B3A)),
    FolderTone(Color(0xFF2B9D77), Color(0xFF58CBA3), Color(0xFF23916C)),
    FolderTone(Color(0xFF7A59D4), Color(0xFFA690F1), Color(0xFF6A49C8)),
)

/** (x, y, rotation) of each peeking file, as fractions of the folder's width. */
private val SLOTS = mapOf(
    1 to listOf(Triple(0.31f, 0.1f, 0f)),
    2 to listOf(Triple(0.17f, 0.14f, -6f), Triple(0.45f, 0.1f, 5f)),
    3 to listOf(Triple(0.1f, 0.16f, -8f), Triple(0.31f, 0.08f, 0f), Triple(0.52f, 0.16f, 8f)),
)

/** A folder drawn like a real one: a back panel, a few of its files peeking out, and a front panel with the item count. */
@Composable
fun FolderArt(f: FileEntry, peek: FolderPeek?, api: Api, imageLoader: ImageLoader, modifier: Modifier = Modifier) {
    val tone = TONES[(f.id.hashCode() and 0x7fffffff) % TONES.size]
    val files = peek?.files.orEmpty().take(3); val slots = SLOTS[files.size].orEmpty()
    val context = LocalContext.current
    BoxWithConstraints(modifier.fillMaxSize()) {
        val w = if (maxWidth < maxHeight) maxWidth else maxHeight
        Box(Modifier.align(Alignment.TopStart).offset(x = w * 0.08f, y = w * 0.12f).width(w * 0.36f).height(w * 0.14f).clip(RoundedCornerShape(topStart = w * 0.04f, topEnd = w * 0.04f)).background(tone.back))
        Box(Modifier.align(Alignment.TopStart).offset(x = w * 0.08f, y = w * 0.2f).width(w * 0.84f).height(w * 0.72f).clip(RoundedCornerShape(w * 0.06f)).background(tone.back))
        files.forEachIndexed { i, file ->
            val (x, y, rot) = slots[i]
            Box(
                Modifier.align(Alignment.TopStart).offset(x = w * x, y = w * y).size(width = w * 0.38f, height = w * 0.5f)
                    .graphicsLayer { rotationZ = rot }.shadow(3.dp, RoundedCornerShape(6.dp)).clip(RoundedCornerShape(6.dp)).background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                val k = kindStyle(file)
                if (file.hasThumbnail) AsyncImage(model = ImageRequest.Builder(context).data(api.thumbnail(file, 128)).crossfade(true).build(), imageLoader = imageLoader, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Box(Modifier.fillMaxSize().background(k.bg), contentAlignment = Alignment.Center) { Icon(k.icon, null, tint = k.fg, modifier = Modifier.size(w * 0.14f)) }
            }
        }
        Box(
            Modifier.align(Alignment.TopStart).offset(x = w * 0.08f, y = w * 0.44f).width(w * 0.84f).height(w * 0.48f)
                .shadow(4.dp, RoundedCornerShape(w * 0.06f)).clip(RoundedCornerShape(w * 0.06f)).background(Brush.verticalGradient(listOf(tone.top, tone.bottom))),
        ) {
            if (peek != null && peek.count > 0) Text("${peek.count} item", Modifier.align(Alignment.BottomStart).padding(start = w * 0.05f, bottom = w * 0.04f), style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.92f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
