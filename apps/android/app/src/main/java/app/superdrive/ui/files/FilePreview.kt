package app.superdrive.ui.files

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import app.superdrive.core.Api
import app.superdrive.core.DocKind
import app.superdrive.core.FileEntry
import app.superdrive.core.docKind
import app.superdrive.ui.media.MediaViewer
import coil3.ImageLoader

/** Opens a file in the right previewer: the gallery viewer for photos and videos, the document viewer for the rest. */
@Composable
fun FilePreview(f: FileEntry, siblings: List<FileEntry>, api: Api, imageLoader: ImageLoader, onClose: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val kind = docKind(f.name, f.mimeType)
    if (kind == DocKind.Image || kind == DocKind.Video) {
        val media = remember(f.id, siblings) { siblings.filter { docKind(it.name, it.mimeType).let { k -> k == DocKind.Image || k == DocKind.Video } }.ifEmpty { listOf(f) } }
        MediaViewer(media, media.indexOfFirst { it.id == f.id && it.storageId == f.storageId }.coerceAtLeast(0), api, imageLoader, onClose)
    } else DocumentViewer(f, api, onClose = onClose, onDownload = { enqueueDownload(context, api.download(f), f.name, f.mimeType) })
}
