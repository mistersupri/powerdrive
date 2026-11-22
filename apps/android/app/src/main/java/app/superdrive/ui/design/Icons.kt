package app.superdrive.ui.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** The website's icon set (Lucide, stroke style) as vectors, so both interfaces draw the same shapes. Tint comes from the Icon. */
object Lu {
    private fun icon(name: String, width: Float = 1.8f, vararg paths: String): ImageVector =
        ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f).apply {
            paths.forEach { d -> addPath(pathData = addPathNodes(d), stroke = SolidColor(Color.Black), strokeLineWidth = width, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) }
        }.build()

    private const val FILE = "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
    private const val FOLD = "M14 2v4a2 2 0 0 0 2 2h4"

    val Folder by lazy { icon("folder", 1.8f, "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z") }
    val FolderPlus by lazy { icon("folder-plus", 1.8f, "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z", "M12 10v6", "M9 13h6") }
    val File by lazy { icon("file", 1.8f, FILE, FOLD) }
    val FileText by lazy { icon("file-text", 1.8f, FILE, FOLD, "M10 9H8", "M16 13H8", "M16 17H8") }
    val FileImage by lazy { icon("file-image", 1.8f, FILE, FOLD, "M11 11.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0", "m20 17-1.3-1.3a2.4 2.4 0 0 0-3.4 0L9 22") }
    val FileVideo by lazy { icon("file-video", 1.8f, FILE, FOLD, "m10 11 5 3-5 3Z") }
    val FileAudio by lazy { icon("file-audio", 1.8f, FILE, FOLD, "M11 17v-6l4-1v6", "M11 17a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0", "M15 16a1.5 1.5 0 1 1-3 0") }
    val FileSheet by lazy { icon("file-sheet", 1.8f, FILE, FOLD, "M8 13h2", "M14 13h2", "M8 17h2", "M14 17h2") }
    val FileArchive by lazy { icon("file-archive", 1.8f, FILE, FOLD, "M11 8h2", "M11 12h2", "M11 16h2") }
    val FileCode by lazy { icon("file-code", 1.8f, FILE, FOLD, "m10 13-2 2 2 2", "m14 17 2-2-2-2") }
    val Slides by lazy { icon("presentation", 1.8f, "M2 3h20", "M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3", "m7 21 5-5 5 5") }
    val HardDrive by lazy { icon("hard-drive", 1.8f, "M22 12H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z", "M6 16h.01", "M10 16h.01") }
    val Database by lazy { icon("database", 1.8f, "M3 5c0 1.66 4.03 3 9 3s9-1.34 9-3-4.03-3-9-3-9 1.34-9 3Z", "M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5", "M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3") }
    val Transfer by lazy { icon("arrow-right-left", 1.8f, "m16 3 4 4-4 4", "M20 7H4", "m8 21-4-4 4-4", "M4 17h16") }
    val Link by lazy { icon("link", 1.8f, "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71") }
    val Bell by lazy { icon("bell", 1.8f, "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0") }
    val Search by lazy { icon("search", 2f, "m21 21-4.3-4.3", "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z") }
    val Settings by lazy { icon("settings", 1.8f, "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z") }
    val ChevronRight by lazy { icon("chevron-right", 2f, "m9 18 6-6-6-6") }
    val ChevronDown by lazy { icon("chevron-down", 2f, "m6 9 6 6 6-6") }
    val Check by lazy { icon("check", 2.4f, "M20 6 9 17l-5-5") }
    val Plus by lazy { icon("plus", 2.2f, "M5 12h14", "M12 5v14") }
    val X by lazy { icon("x", 2f, "M18 6 6 18", "m6 6 12 12") }
    val Back by lazy { icon("arrow-left", 2f, "m12 19-7-7 7-7", "M19 12H5") }
    val Star by lazy { icon("star", 1.8f, "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z") }
    val Upload by lazy { icon("upload", 2f, "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12") }
    val Download by lazy { icon("download", 2f, "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3") }
    val Users by lazy { icon("users", 1.8f, "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75") }
    val User by lazy { icon("user", 1.8f, "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z") }
    val Shield by lazy { icon("shield", 1.8f, "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z") }
    val Lock by lazy { icon("lock", 1.8f, "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 10 0v4") }
    val Phone by lazy { icon("smartphone", 1.8f, "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z", "M12 18h.01") }
    val Trash by lazy { icon("trash", 1.8f, "M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2") }
    val Pencil by lazy { icon("pencil", 1.8f, "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z") }
    val Copy by lazy { icon("copy", 1.8f, "M20 8H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2") }
    val Move by lazy { icon("move", 1.8f, "m5 9-3 3 3 3", "m9 5 3-3 3 3", "m15 19-3 3-3-3", "m19 9 3 3-3 3", "M2 12h20", "M12 2v20") }
    val Share by lazy { icon("share", 1.8f, "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "m16 6-4-4-4 4", "M12 2v13") }
    val Info by lazy { icon("info", 1.8f, "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z", "M12 16v-4", "M12 8h.01") }
    val More by lazy { icon("more-vertical", 2.6f, "M12 5h.01", "M12 12h.01", "M12 19h.01") }
    val Clock by lazy { icon("clock", 1.8f, "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z", "M12 6v6l4 2") }
    val Pause by lazy { icon("pause", 2f, "M6 4h4v16H6Z", "M14 4h4v16h-4Z") }
    val Play by lazy { icon("play", 2f, "M6 3l14 9-14 9Z") }
    val Retry by lazy { icon("rotate-ccw", 2f, "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5") }
    val Fingerprint by lazy { icon("fingerprint", 1.8f, "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4", "M14 13.12c0 2.38 0 6.38-1 8.88", "M17.29 21.02c.12-.6.43-2.3.5-3.02", "M2 12a10 10 0 0 1 18-6", "M2 16h.01", "M21.8 16c.2-2 .131-5.354 0-6", "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2", "M8.65 22c.21-.66.45-1.32.57-2", "M9 6.8a6 6 0 0 1 9 5.2v2") }
    val Dashboard by lazy { icon("layout-dashboard", 1.8f, "M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z", "M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z") }
    val Grid by lazy { icon("layout-grid", 1.8f, "M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z", "M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z") }
    val List by lazy { icon("list", 2f, "M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01") }
    val UploadFolder by lazy { icon("folder-up", 1.8f, "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z", "M12 10v6", "m9 13 3-3 3 3") }
    val Filter by lazy { icon("filter", 1.8f, "M22 3H2l8 9.46V19l4 2v-8.54L22 3Z") }
    val MapPin by lazy { icon("map-pin", 1.8f, "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z") }
    val Palette by lazy { icon("palette", 1.8f, "M12 22a10 10 0 1 1 0-20c5.5 0 10 3.6 10 8 0 3-2.2 4-4 4h-2.2a2 2 0 0 0-1.5 3.3 2 2 0 0 1-.6 3.2c-.5.3-1 .5-1.7.5Z", "M7.5 11a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z", "M12 7.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z", "M16.5 11a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z") }
    val Images by lazy { icon("images", 1.8f, "M18 22H4a2 2 0 0 1-2-2V6", "m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18", "M15 8a1 1 0 1 0 2 0 1 1 0 0 0-2 0", "M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z") }
}
