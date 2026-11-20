package app.superdrive.ui.design

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.superdrive.core.FileEntry
import app.superdrive.ui.theme.Motion
import app.superdrive.ui.theme.sd
import kotlinx.coroutines.delay

// ---- surfaces ----

/** White card with the website's hairline border and soft shadow. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SdCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, radius: Dp = 14.dp, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(radius)
    Surface(modifier = modifier.then(if (onClick != null) Modifier.pressable(onClick = onClick, shape = shape) else Modifier), shape = shape, color = MaterialTheme.sd.surface, border = BorderStroke(1.dp, MaterialTheme.sd.line), shadowElevation = 1.dp) {
        Column(content = content)
    }
}

/** A rounded square tinted tile holding an icon: how the website marks stats, file kinds and settings rows. */
@Composable
fun IconTile(icon: ImageVector, bg: Color, fg: Color, modifier: Modifier = Modifier, size: Dp = 40.dp, iconSize: Dp = 20.dp, radius: Dp = 10.dp) {
    Box(modifier.size(size).clip(RoundedCornerShape(radius)).background(bg), contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(iconSize)) }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(), modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.8.sp), color = MaterialTheme.sd.muted)

@Composable
fun StatusPill(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier) =
    Text(text, modifier.clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 9.dp, vertical = 3.dp), style = MaterialTheme.typography.labelMedium, color = fg, maxLines = 1)

@Composable
fun Avatar(name: String, modifier: Modifier = Modifier, size: Dp = 36.dp) =
    Box(modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(MaterialTheme.sd.primary, MaterialTheme.sd.navy))), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = Color.White, style = MaterialTheme.typography.titleSmall)
    }

// ---- file kinds (same mapping and tones as the website's fileType.ts) ----

class KindStyle(val icon: ImageVector, val fg: Color, val bg: Color)

@Composable
fun kindStyle(f: FileEntry): KindStyle {
    val c = MaterialTheme.sd
    if (f.isFolder) return KindStyle(Lu.Folder, c.primaryInk, c.primarySoft)
    val m = f.mimeType.orEmpty(); val ext = f.name.substringAfterLast('.', "").lowercase()
    return when {
        m.startsWith("image/") -> KindStyle(Lu.FileImage, c.violetInk, c.violetSoft)
        m.startsWith("video/") -> KindStyle(Lu.FileVideo, c.dangerInk, c.dangerSoft)
        m.startsWith("audio/") -> KindStyle(Lu.FileAudio, c.warnInk, c.warnSoft)
        ext == "pdf" || m == "application/pdf" -> KindStyle(Lu.FileText, c.dangerInk, c.dangerSoft)
        ext in setOf("xls", "xlsx", "ods", "csv") -> KindStyle(Lu.FileSheet, c.okInk, c.okSoft)
        ext in setOf("ppt", "pptx", "odp") -> KindStyle(Lu.Slides, c.warnInk, c.warnSoft)
        ext in setOf("doc", "docx", "odt", "rtf") -> KindStyle(Lu.FileText, c.primaryInk, c.primarySoft)
        ext in setOf("zip", "rar", "7z", "tar", "gz", "tgz") -> KindStyle(Lu.FileArchive, c.muted, c.surface2)
        ext in setOf("js", "ts", "json", "html", "css", "py", "sh", "xml", "yml", "yaml", "kt", "java") -> KindStyle(Lu.FileCode, c.muted, c.surface2)
        ext in setOf("txt", "md", "log") || m.startsWith("text/") -> KindStyle(Lu.FileText, c.muted, c.surface2)
        else -> KindStyle(Lu.File, c.muted, c.surface2)
    }
}

// ---- motion ----

/** Presses shrink a touch, like the website's `press` utility, and the ripple is replaced by that scale. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Modifier.pressable(onClick: () -> Unit, onLongClick: (() -> Unit)? = null, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(0.dp), scaleTo: Float = 0.985f, enabled: Boolean = true): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) scaleTo else 1f, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow), label = "press")
    val haptic = LocalHapticFeedback.current
    return this.scale(s).clip(shape).combinedClickable(interactionSource = source, indication = androidx.compose.material3.ripple(), enabled = enabled, onClick = onClick,
        onLongClick = onLongClick?.let { l -> { haptic.performHapticFeedback(HapticFeedbackType.LongPress); l() } })
}

/** First items of a screen rise in one after the other; later ones appear plainly so scrolling never replays it. */
fun Modifier.riseIn(index: Int, enabled: Boolean = index < 9): Modifier = if (!enabled) this else composed {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { delay((index * 32L).coerceAtMost(260)); a.animateTo(1f, tween(340, easing = Motion.EaseOut)) }
    val px = with(LocalDensity.current) { 18.dp.toPx() }
    graphicsLayer { alpha = a.value; translationY = (1f - a.value) * px }
}

/** Shimmering placeholder block for loading states (instead of a lone spinner). */
@Composable
fun Skeleton(modifier: Modifier = Modifier, radius: Dp = 10.dp) {
    val t = rememberInfiniteTransition(label = "shimmer")
    val x by t.animateFloat(-1f, 2f, infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart), label = "x")
    val base = MaterialTheme.sd.surface2; val hi = MaterialTheme.sd.line
    Box(modifier.clip(RoundedCornerShape(radius)).drawBehind {
        val w = size.width
        drawRect(Brush.horizontalGradient(listOf(base, hi, base), startX = w * x, endX = w * (x + 0.6f)))
    })
}
@Composable
fun SkeletonRows(count: Int = 7) = Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
    repeat(count) { Row(verticalAlignment = Alignment.CenterVertically) { Skeleton(Modifier.size(44.dp)); Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Skeleton(Modifier.height(12.dp).width(((150 + (it * 37) % 90)).dp), 6.dp); Skeleton(Modifier.height(10.dp).width(90.dp), 5.dp) } } }
}

// ---- bars and headers ----

/** The website's page header: bold title, quiet subtitle, actions on the right, hairline below. */
@Composable
fun PageHeader(title: String, modifier: Modifier = Modifier, subtitle: String? = null, leading: (@Composable () -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Column(modifier.fillMaxWidth().background(MaterialTheme.sd.surface).windowInsetsPadding(WindowInsets.statusBars)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = if (leading == null) 20.dp else 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            leading?.invoke()
            Column(Modifier.weight(1f).padding(end = 8.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.sd.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.sd.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            actions()
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.sd.line))
    }
}

@Composable
fun BarIcon(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = MaterialTheme.sd.muted, badge: Int = 0) {
    Box(modifier.size(44.dp).pressable(onClick = onClick, shape = CircleShape, scaleTo = 0.9f), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
        if (badge > 0) Box(Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 8.dp).size(9.dp).clip(CircleShape).background(MaterialTheme.sd.dangerInk).border(2.dp, MaterialTheme.sd.surface, CircleShape))
    }
}

class NavItem(val label: String, val icon: ImageVector, val badge: Int = 0)

/** Bottom bar of the website: a bar on the surface with one indicator that glides to the active tab. */
@Composable
fun SdBottomBar(items: List<NavItem>, selected: Int, onSelect: (Int) -> Unit) {
    val c = MaterialTheme.sd; val haptic = LocalHapticFeedback.current
    Column(Modifier.fillMaxWidth().background(c.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
        BoxWithConstraints(Modifier.fillMaxWidth().navigationBarsPadding()) {
            val w = maxWidth / items.size
            val x by animateDpAsState(w * selected, tween(320, easing = Motion.Drawer), label = "indicator")
            Box(Modifier.offset(x = x).width(w).height(3.dp).padding(horizontal = 18.dp).clip(RoundedCornerShape(bottomStart = 3.dp, bottomEnd = 3.dp)).background(c.primary))
            Row(Modifier.fillMaxWidth()) {
                items.forEachIndexed { i, it ->
                    val on = i == selected
                    val tint by androidx.compose.animation.animateColorAsState(if (on) c.primaryInk else c.muted, tween(200), label = "tint")
                    val lift by animateFloatAsState(if (on) -2f else 0f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMedium), label = "lift")
                    Column(Modifier.weight(1f).height(60.dp).pressable(onClick = { if (!on) haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onSelect(i) }, scaleTo = 0.94f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Box(Modifier.graphicsLayer { translationY = lift.dp.toPx() }) {
                            Icon(it.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
                            if (it.badge > 0) Text(if (it.badge > 9) "9+" else "${it.badge}", Modifier.align(Alignment.TopEnd).offset(x = 10.dp, y = (-6).dp).clip(RoundedCornerShape(50)).background(c.primary).padding(horizontal = 5.dp), color = Color.White, style = MaterialTheme.typography.labelSmall)
                        }
                        Text(it.label, color = tint, style = MaterialTheme.typography.labelSmall.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium), modifier = Modifier.padding(top = 3.dp), maxLines = 1)
                    }
                }
            }
        }
    }
}

/** Segmented tabs: a surface pill slides under the chosen label (the website's SlidingTabs). */
@Composable
fun SlidingTabs(labels: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = MaterialTheme.sd
    BoxWithConstraints(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.surface2).padding(3.dp)) {
        val w = maxWidth / labels.size
        val x by animateDpAsState(w * selected, tween(280, easing = Motion.Drawer), label = "pill")
        Box(Modifier.offset(x = x).width(w).height(36.dp).clip(RoundedCornerShape(9.dp)).background(c.surface))
        Row(Modifier.fillMaxWidth()) {
            labels.forEachIndexed { i, l ->
                Box(Modifier.weight(1f).height(36.dp).pressable(onClick = { onSelect(i) }, shape = RoundedCornerShape(9.dp), scaleTo = 0.96f), contentAlignment = Alignment.Center) {
                    Text(l, style = MaterialTheme.typography.labelLarge, color = if (i == selected) c.ink else c.muted, maxLines = 1)
                }
            }
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, body: String? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        IconTile(icon, MaterialTheme.sd.primarySoft, MaterialTheme.sd.primaryInk, size = 64.dp, iconSize = 30.dp, radius = 20.dp)
        Text(title, Modifier.padding(top = 16.dp), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.sd.ink)
        if (body != null) Text(body, Modifier.padding(top = 4.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.sd.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = 16.dp)) { action() }
    }
}

/** Rounded progress bar that eases to its value, in the site's blue (or a given tone). */
@Composable
fun SdProgress(fraction: Float, modifier: Modifier = Modifier, color: Color = MaterialTheme.sd.primary, track: Color = MaterialTheme.sd.surface2, height: Dp = 6.dp) {
    val f by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(500, easing = Motion.EaseOut), label = "progress")
    Box(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(50)).background(track)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(f).clip(RoundedCornerShape(50)).background(Brush.horizontalGradient(listOf(color, color.copy(alpha = 0.78f)))))
    }
}

/** Provider colour dots from the website's sidebar. */
fun providerColor(provider: String): Color = when (provider) {
    "GOOGLE_DRIVE" -> Color(0xFF4285F4); "ONEDRIVE" -> Color(0xFF0078D4); "DROPBOX" -> Color(0xFF0061FF); "LOCAL" -> Color(0xFF047857)
    "S3" -> Color(0xFFA65A05); "SMB" -> Color(0xFF6D4BD1); "SFTP" -> Color(0xFF1769E8); "WEBDAV" -> Color(0xFFB42318); else -> Color(0xFF607087)
}

// ---- forms ----

enum class BtnKind { Primary, Secondary, Danger }

@Composable
fun SdButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, kind: BtnKind = BtnKind.Primary, icon: ImageVector? = null) {
    val c = MaterialTheme.sd
    val (bg, fg, border) = when (kind) {
        BtnKind.Primary -> Triple(c.primary, Color.White, Color.Transparent)
        BtnKind.Secondary -> Triple(c.surface, c.primaryInk, c.lineStrong)
        BtnKind.Danger -> Triple(c.dangerSoft, c.dangerInk, Color.Transparent)
    }
    val on = enabled && !busy
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.fillMaxWidth().height(50.dp).clip(shape).background(if (on) bg else bg.copy(alpha = 0.4f)).border(1.dp, border, shape)
            .pressable(onClick = onClick, shape = shape, scaleTo = 0.97f, enabled = on),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = fg)
        else { if (icon != null) Icon(icon, null, tint = fg.copy(alpha = if (on) 1f else 0.6f), modifier = Modifier.size(18.dp).padding(end = 0.dp)); Text(text, Modifier.padding(start = if (icon != null) 8.dp else 0.dp), style = MaterialTheme.typography.titleSmall, color = fg.copy(alpha = if (on) 1f else 0.6f)) }
    }
}

@Composable
fun SdField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, password: Boolean = false, enabled: Boolean = true, keyboard: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text, supporting: String? = null) {
    val c = MaterialTheme.sd
    androidx.compose.material3.OutlinedTextField(
        value, onChange, modifier.fillMaxWidth(), enabled = enabled, singleLine = true, label = { Text(label) }, shape = RoundedCornerShape(14.dp),
        visualTransformation = if (password) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = if (password) androidx.compose.ui.text.input.KeyboardType.Password else keyboard),
        supportingText = supporting?.let { { Text(it) } },
        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(focusedBorderColor = c.primary, unfocusedBorderColor = c.lineStrong, focusedContainerColor = c.surface, unfocusedContainerColor = c.surface, focusedLabelColor = c.primaryInk),
    )
}

@Composable
fun SdSwitch(checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    val c = MaterialTheme.sd
    androidx.compose.material3.Switch(checked, onChange, enabled = enabled, colors = androidx.compose.material3.SwitchDefaults.colors(
        checkedThumbColor = Color.White, checkedTrackColor = c.primary, checkedBorderColor = c.primary,
        uncheckedThumbColor = c.faint, uncheckedTrackColor = c.surface2, uncheckedBorderColor = c.lineStrong,
        disabledCheckedTrackColor = c.primary.copy(alpha = 0.4f), disabledUncheckedTrackColor = c.surface2, disabledUncheckedBorderColor = c.line, disabledUncheckedThumbColor = c.line,
    ))
}

/** One row of a settings card: tinted icon tile, title, a line of detail, then a control or chevron. */
@Composable
fun SettingRow(icon: ImageVector, title: String, modifier: Modifier = Modifier, detail: String? = null, tone: Pair<Color, Color>? = null, onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    val c = MaterialTheme.sd
    Row(modifier.fillMaxWidth().then(if (onClick != null) Modifier.pressable(onClick = onClick) else Modifier).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(icon, tone?.first ?: c.primarySoft, tone?.second ?: c.primaryInk, size = 40.dp)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = c.ink)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = c.muted)
        }
        if (trailing != null) trailing() else if (onClick != null) Icon(Lu.ChevronRight, null, tint = c.faint, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun Divider(inset: Dp = 66.dp) = Box(Modifier.padding(start = inset).fillMaxWidth().height(1.dp).background(MaterialTheme.sd.line))

/** Message box in a tone: info (blue), warning, danger or success. */
@Composable
fun Notice(text: String, tone: Pair<Color, Color>, icon: ImageVector = Lu.Info, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(tone.first).padding(12.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, tint = tone.second, modifier = Modifier.size(16.dp).padding(top = 1.dp)); Text(text, Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodySmall, color = tone.second)
    }
}
