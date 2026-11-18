package app.superdrive

import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.PorterDuff
import android.util.AttributeSet
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView

/**
 * The app's own bottom bar: five places, a pill that glides to the active one, a count on Transfer, a tick under the finger.
 * It only knows which route it is on; the page itself is the web app, which this bar navigates with [onSelect].
 */
class NativeNav @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : FrameLayout(context, attrs) {
    private class Tab(val path: String, val label: String, val icon: Int, val matches: (String) -> Boolean)
    private class Cell(val root: FrameLayout, val icon: ImageView, val label: TextView, val badge: TextView)

    private val tabs = listOf(
        Tab("/", "Beranda", R.drawable.ic_nav_home) { it == "/" },
        Tab("/files", "File", R.drawable.ic_nav_files) { it.startsWith("/files") || it.startsWith("/s/") || it.startsWith("/recent") || it.startsWith("/starred") || it.startsWith("/trash") },
        Tab("/media", "Media", R.drawable.ic_nav_media) { it.startsWith("/media") },
        Tab("/shared", "Berbagi", R.drawable.ic_nav_shared) { it.startsWith("/shared") || it.startsWith("/shares") },
        Tab("/transfers", "Transfer", R.drawable.ic_nav_transfers) { it.startsWith("/transfers") || it.startsWith("/dual") },
    )
    private val cells = ArrayList<Cell>()
    private val pill = View(context)
    private val line = View(context)
    private val ease = PathInterpolator(0.32f, 0.72f, 0f, 1f)

    /** Called with the tab index and whether it was already the active one. */
    var onSelect: ((Int, Boolean) -> Unit)? = null
    var activeIndex = -1
        private set
    private var bg = Color.WHITE; private var muted = Color.parseColor("#4B5B74"); private var activeInk = Color.parseColor("#1769E8"); private var pillColor = Color.parseColor("#EAF2FF"); private var accent = Color.parseColor("#1769E8"); private var rule = Color.parseColor("#D3DBE6")

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)
    private fun dpi(v: Float) = dp(v).toInt()

    init {
        setBackgroundColor(bg)
        pill.setBackgroundResource(R.drawable.bg_nav_pill)
        addView(pill, LayoutParams(dpi(60f), dpi(32f)).apply { topMargin = dpi(10f) })
        for (t in tabs) {
            val root = FrameLayout(context)
            val icon = ImageView(context).apply { setImageResource(t.icon); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
            root.addView(icon, LayoutParams(dpi(24f), dpi(24f), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dpi(14f) })
            val label = TextView(context).apply { text = t.label; setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f); typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO; maxLines = 1 }
            root.addView(label, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dpi(10f) })
            val badge = TextView(context).apply { setBackgroundResource(R.drawable.bg_nav_badge); setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f); gravity = Gravity.CENTER; setPadding(dpi(4f), 0, dpi(4f), 0); minWidth = dpi(16f); visibility = GONE; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
            root.addView(badge, LayoutParams(LayoutParams.WRAP_CONTENT, dpi(16f), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dpi(8f); marginStart = dpi(26f) })
            root.isClickable = true; root.isFocusable = true; root.contentDescription = t.label
            cells.add(Cell(root, icon, label, badge))
        }
        // the cells are laid out by hand so the pill can be placed from the same numbers
        cells.forEach { addView(it.root) }
        addView(line, LayoutParams(LayoutParams.MATCH_PARENT, 1).apply { gravity = Gravity.TOP })
        cells.forEachIndexed { i, c ->
            c.root.setOnTouchListener { v, e ->
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(110).start()
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(160).setInterpolator(ease).start()
                }
                false
            }
            c.root.setOnClickListener { performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); onSelect?.invoke(i, i == activeIndex) }
        }
        applyColors(false)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec); val h = dpi(64f); val cw = w / tabs.size
        cells.forEach { it.root.measure(MeasureSpec.makeMeasureSpec(cw, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)) }
        pill.measure(MeasureSpec.makeMeasureSpec(dpi(60f), MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(dpi(32f), MeasureSpec.EXACTLY))
        line.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(1, MeasureSpec.EXACTLY))
        setMeasuredDimension(w, h)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val cw = (r - l) / tabs.size
        cells.forEachIndexed { i, c -> c.root.layout(i * cw, 0, (i + 1) * cw, b - t) }
        pill.layout(0, dpi(10f), dpi(60f), dpi(42f)); line.layout(0, 0, r - l, 1)
        pill.translationX = pillX(activeIndex)
    }

    private fun pillX(i: Int) = if (i < 0) 0f else (width / tabs.size) * i + ((width / tabs.size) - dpi(60f)) / 2f

    /** Colours from the web app's current theme, so the bar always matches the page above it. */
    fun applyTheme(surface: Int?, border: Int?, mutedInk: Int?, primaryInk: Int?, primarySoft: Int?, primary: Int?) {
        surface?.let { bg = it }; border?.let { rule = it }; mutedInk?.let { muted = it }; primaryInk?.let { activeInk = it }; primarySoft?.let { pillColor = it }; primary?.let { accent = it }
        applyColors(false)
    }

    private fun applyColors(animate: Boolean) {
        setBackgroundColor(bg); line.setBackgroundColor(rule)
        (pill.background.mutate() as? android.graphics.drawable.GradientDrawable)?.setColor(pillColor)
        cells.forEach { (it.badge.background.mutate() as? android.graphics.drawable.GradientDrawable)?.setColor(accent) }
        cells.forEachIndexed { i, c -> tint(c, if (i == activeIndex) activeInk else muted, animate) }
    }

    private fun tint(c: Cell, to: Int, animate: Boolean) {
        val from = (c.label.currentTextColor)
        if (!animate || from == to) { c.label.setTextColor(to); c.icon.setColorFilter(to, PorterDuff.Mode.SRC_IN); return }
        ValueAnimator.ofObject(ArgbEvaluator(), from, to).apply { duration = 220; addUpdateListener { c.label.setTextColor(it.animatedValue as Int); c.icon.setColorFilter(it.animatedValue as Int, PorterDuff.Mode.SRC_IN) } }.start()
    }

    /** Which tab the page is on (-1: a page that is not one of the five places). */
    fun setPath(path: String) = setActive(tabs.indexOfFirst { it.matches(path) })
    fun setActive(i: Int) {
        if (i == activeIndex) return
        val old = activeIndex; activeIndex = i
        cells.forEachIndexed { idx, c -> tint(c, if (idx == i) activeInk else muted, true); c.label.alpha = 1f }
        if (i < 0) { pill.animate().alpha(0f).setDuration(160).start(); return }
        if (old < 0 || width == 0) { pill.translationX = pillX(i); pill.animate().alpha(1f).setDuration(160).start(); return }
        pill.animate().alpha(1f).translationX(pillX(i)).setDuration(320).setInterpolator(ease).start()
    }
    fun pathOf(i: Int) = tabs[i].path

    fun setBadge(tab: Int, count: Int) {
        val b = cells.getOrNull(tab)?.badge ?: return
        if (count <= 0) { if (b.visibility == VISIBLE) b.animate().scaleX(0f).scaleY(0f).setDuration(140).withEndAction { b.visibility = GONE }.start(); return }
        b.text = if (count > 99) "99+" else count.toString()
        if (b.visibility != VISIBLE) { b.scaleX = 0f; b.scaleY = 0f; b.visibility = VISIBLE; b.animate().scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(android.view.animation.OvershootInterpolator(2f)).start() }
    }

    /** Fade the bar away (or back) instead of blinking. */
    fun setShown(show: Boolean) {
        if (show && visibility == VISIBLE && alpha == 1f) return
        if (!show && visibility == GONE) return
        if (show) { visibility = VISIBLE; animate().alpha(1f).setDuration(160).setListener(null).start() }
        else animate().alpha(0f).setDuration(120).withEndAction { visibility = GONE }.start()
    }
}
