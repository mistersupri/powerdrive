package app.superdrive.core

import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

/** What the native previewer does with a file. */
enum class DocKind { Image, Video, Pdf, Text, Csv, Docx, Xlsx, Zip, Other }

private val TEXT_EXT = setOf("txt", "md", "markdown", "json", "xml", "yml", "yaml", "log", "ini", "conf", "cfg", "toml", "js", "ts", "tsx", "jsx", "css", "html", "htm", "kt", "java", "py", "sh", "sql", "c", "h", "cpp", "go", "rs", "rb", "php", "env", "gitignore", "csv")

fun docKind(name: String, mime: String?): DocKind {
    val ext = name.substringAfterLast('.', "").lowercase()
    val m = (mime ?: "").lowercase()
    return when {
        m.startsWith("image/") && !m.contains("svg") -> DocKind.Image
        m.startsWith("video/") -> DocKind.Video
        m == "application/pdf" || ext == "pdf" -> DocKind.Pdf
        ext == "csv" || m == "text/csv" -> DocKind.Csv
        ext == "docx" -> DocKind.Docx
        ext == "xlsx" -> DocKind.Xlsx
        ext == "zip" || m == "application/zip" -> DocKind.Zip
        m.startsWith("text/") || m == "application/json" || m == "application/xml" || ext in TEXT_EXT -> DocKind.Text
        else -> DocKind.Other
    }
}

private fun unescape(s: String) = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")

private fun zipEntry(bytes: ByteArray, name: String): String? {
    ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
        while (true) { val e = z.nextEntry ?: return null; if (e.name == name) return z.readBytes().toString(Charsets.UTF_8) }
    }
}

/** Plain paragraphs of a Word document, found without any XML parsing: the fallback when [docxBlocks] cannot read a file. */
fun docxPlainText(bytes: ByteArray): List<String> {
    val xml = zipEntry(bytes, "word/document.xml") ?: return emptyList()
    val text = Regex("<w:t(?:\\s[^>]*)?>(.*?)</w:t>|<w:tab\\s*/>|<w:br\\s*/>", RegexOption.DOT_MATCHES_ALL)
    return xml.split("</w:p>").map { p ->
        text.findAll(p).joinToString("") { m -> when { m.value.startsWith("<w:tab") -> "\t"; m.value.startsWith("<w:br") -> "\n"; else -> unescape(m.groupValues[1]) } }
    }.filter { it.isNotBlank() }
}

/** A run of text with the formatting Word gave it. [color] is 0xRRGGBB, null for "automatic". */
data class DocRun(val text: String, val bold: Boolean = false, val italic: Boolean = false, val underline: Boolean = false, val strike: Boolean = false, val color: Int? = null, val sizePt: Float? = null)
sealed interface DocBlock
/** One paragraph. [heading] is 1–6 for headings and 7 for the title; [label] is the bullet or number of a list item. */
data class DocPara(val runs: List<DocRun>, val heading: Int = 0, val align: String = "left", val label: String? = null, val level: Int = 0, val indentPt: Float = 0f) : DocBlock {
    val text: String get() = runs.joinToString("") { it.text }
}
data class DocTable(val rows: List<List<List<DocPara>>>) : DocBlock
class DocImage(val bytes: ByteArray) : DocBlock

/** A node of a parsed XML document: just what the Word reader needs. */
private class X(val tagName: String, private val attrs: Map<String, String>) {
    val kids = ArrayList<X>()
    val text = StringBuilder()
    fun getAttribute(n: String): String = attrs[n].orEmpty()
    val textContent: String get() = if (kids.isEmpty()) text.toString() else text.toString() + kids.joinToString("") { it.textContent }
}

private val ENTITY = Regex("&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);")
private val ATTR = Regex("([^\\s=]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')")
private fun decodeEntities(s: String): String = if ('&' !in s) s else ENTITY.replace(s) { m ->
    when (val g = m.groupValues[1]) {
        "lt" -> "<"; "gt" -> ">"; "amp" -> "&"; "quot" -> "\""; "apos" -> "'"
        else -> runCatching { String(Character.toChars(if (g.startsWith("#x")) g.substring(2).toInt(16) else g.substring(1).toInt())) }.getOrDefault("")
    }
}

/**
 * A small XML reader of our own rather than the platform's: phones differ in which parser features they allow, and a document must never be able to
 * pull in files or entities. Comments, processing instructions and DOCTYPEs are skipped; only the five standard and numeric entities are expanded.
 */
private fun parseXml(src: String): X? {
    val xml = src.removePrefix("\uFEFF")
    var i = 0; val n = xml.length; val stack = ArrayList<X>(); var root: X? = null
    while (i < n) {
        val lt = xml.indexOf('<', i); if (lt < 0) break
        if (lt > i && stack.isNotEmpty()) stack.last().text.append(decodeEntities(xml.substring(i, lt)))
        when {
            xml.startsWith("<!--", lt) -> { val e = xml.indexOf("-->", lt + 4); if (e < 0) return root; i = e + 3 }
            xml.startsWith("<![CDATA[", lt) -> { val e = xml.indexOf("]]>", lt + 9); if (e < 0) return root; stack.lastOrNull()?.text?.append(xml, lt + 9, e); i = e + 3 }
            xml.startsWith("<?", lt) -> { val e = xml.indexOf("?>", lt + 2); if (e < 0) return root; i = e + 2 }
            xml.startsWith("<!", lt) -> { val e = xml.indexOf('>', lt); if (e < 0) return root; i = e + 1 }
            xml.startsWith("</", lt) -> { val e = xml.indexOf('>', lt); if (e < 0) return root; if (stack.isNotEmpty()) stack.removeAt(stack.size - 1); i = e + 1 }
            else -> {
                var j = lt + 1; var quote = ' '
                while (j < n) { val c = xml[j]; if (quote != ' ') { if (c == quote) quote = ' ' } else if (c == '"' || c == '\'') quote = c else if (c == '>') break; j++ }
                if (j >= n) return root
                val selfClosing = xml[j - 1] == '/'
                val inner = xml.substring(lt + 1, if (selfClosing) j - 1 else j)
                val nameEnd = inner.indexOfFirst { it.isWhitespace() }.let { if (it < 0) inner.length else it }
                val attrs = HashMap<String, String>()
                ATTR.findAll(inner.substring(nameEnd)).forEach { attrs[it.groupValues[1]] = decodeEntities(it.groupValues[2].ifEmpty { it.groupValues[3] }) }
                val node = X(inner.substring(0, nameEnd), attrs)
                if (stack.isNotEmpty()) stack.last().kids.add(node) else if (root == null) root = node
                if (!selfClosing && stack.size < 400) stack.add(node)
                i = j + 1
            }
        }
    }
    return root
}

private fun X.elements(): List<X> = kids
private fun X.child(name: String) = kids.firstOrNull { it.tagName == name }
private fun X.on(name: String): Boolean { val e = child(name) ?: return false; val v = e.getAttribute("w:val"); return v != "0" && v != "false" && v != "none" }
private fun X.descendants(name: String): List<X> { val out = ArrayList<X>(); fun walk(x: X) { for (k in x.kids) { if (k.tagName == name) out.add(k); walk(k) } }; walk(this); return out }

private fun zipAll(bytes: ByteArray, maxEntry: Int = 12 * 1024 * 1024): Map<String, ByteArray> {
    val out = HashMap<String, ByteArray>(); var total = 0L
    ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
        while (true) {
            val e = z.nextEntry ?: break
            if (e.isDirectory || !(e.name.startsWith("word/"))) continue
            val data = z.readBytes(); total += data.size
            if (data.size > maxEntry || total > 60L * 1024 * 1024) continue
            out[e.name] = data
        }
    }
    return out
}

private fun romanOf(n: Int): String { var x = n; val sb = StringBuilder(); for ((v, r) in listOf(1000 to "m", 900 to "cm", 500 to "d", 400 to "cd", 100 to "c", 90 to "xc", 50 to "l", 40 to "xl", 10 to "x", 9 to "ix", 5 to "v", 4 to "iv", 1 to "i")) while (x >= v) { sb.append(r); x -= v }; return sb.toString() }
private fun letterOf(n: Int): String { var x = n - 1; val sb = StringBuilder(); do { sb.insert(0, 'a' + x % 26); x = x / 26 - 1 } while (x >= 0); return sb.toString() }

/**
 * A Word document as blocks, in order: paragraphs with their bold/italic/underline/colour/size, headings, bullet and numbered lists, alignment, tables and pictures.
 * Page layout, headers, footers, text boxes and fields are not reproduced.
 */
fun docxBlocks(bytes: ByteArray): List<DocBlock> {
    val files = zipAll(bytes)
    val doc = parseXml(files["word/document.xml"]?.toString(Charsets.UTF_8) ?: return emptyList()) ?: return emptyList()
    val body = doc.child("w:body") ?: doc

    // style id -> heading level (Title = 7)
    val headingOf = HashMap<String, Int>()
    files["word/styles.xml"]?.toString(Charsets.UTF_8)?.let(::parseXml)?.descendants("w:style")?.forEach { st ->
        val id = st.getAttribute("w:styleId"); val name = (st.child("w:name")?.getAttribute("w:val") ?: id).lowercase()
        val m = Regex("heading\\s*(\\d)").find(name)
        if (m != null) headingOf[id] = m.groupValues[1].toInt().coerceIn(1, 6) else if (name == "title") headingOf[id] = 7 else if (name == "subtitle") headingOf[id] = 6
    }
    // numbering: numId -> format of each level
    val formats = HashMap<String, Map<Int, String>>()
    files["word/numbering.xml"]?.toString(Charsets.UTF_8)?.let(::parseXml)?.let { nr ->
        val abstract = nr.descendants("w:abstractNum").associate { a -> a.getAttribute("w:abstractNumId") to a.descendants("w:lvl").associate { l -> (l.getAttribute("w:ilvl").toIntOrNull() ?: 0) to (l.child("w:numFmt")?.getAttribute("w:val") ?: "decimal") } }
        nr.descendants("w:num").forEach { n -> n.child("w:abstractNumId")?.getAttribute("w:val")?.let { abstract[it] }?.let { formats[n.getAttribute("w:numId")] = it } }
    }
    val rels = HashMap<String, String>()
    files["word/_rels/document.xml.rels"]?.toString(Charsets.UTF_8)?.let(::parseXml)?.descendants("Relationship")?.forEach { r -> rels[r.getAttribute("Id")] = r.getAttribute("Target") }
    val counters = HashMap<String, IntArray>()

    fun runOf(r: X): DocRun? {
        val sb = StringBuilder()
        for (e in r.elements()) when (e.tagName) { "w:t" -> sb.append(e.textContent); "w:tab" -> sb.append('\t'); "w:br", "w:cr" -> sb.append('\n') }
        if (sb.isEmpty()) return null
        val pr = r.child("w:rPr")
        val color = pr?.child("w:color")?.getAttribute("w:val")?.takeIf { it.length == 6 }?.toIntOrNull(16)
        val size = pr?.child("w:sz")?.getAttribute("w:val")?.toFloatOrNull()?.div(2)
        return DocRun(sb.toString(), pr?.on("w:b") == true, pr?.on("w:i") == true, pr?.on("w:u") == true, pr?.on("w:strike") == true, color, size)
    }
    fun runsOf(p: X): List<DocRun> = p.elements().flatMap { e -> when (e.tagName) { "w:r" -> listOfNotNull(runOf(e)); "w:hyperlink", "w:smartTag", "w:ins" -> e.elements().filter { it.tagName == "w:r" }.mapNotNull(::runOf); else -> emptyList() } }
    fun paraOf(p: X): DocPara {
        val pr = p.child("w:pPr")
        val style = pr?.child("w:pStyle")?.getAttribute("w:val").orEmpty()
        val jc = when (pr?.child("w:jc")?.getAttribute("w:val")) { "center" -> "center"; "right", "end" -> "right"; "both", "distribute" -> "justify"; else -> "left" }
        val indent = (pr?.child("w:ind")?.let { it.getAttribute("w:left").ifEmpty { it.getAttribute("w:start") } }?.toFloatOrNull() ?: 0f) / 20f
        var label: String? = null; var level = 0
        val num = pr?.child("w:numPr")
        if (num != null) {
            val id = num.child("w:numId")?.getAttribute("w:val").orEmpty(); level = num.child("w:ilvl")?.getAttribute("w:val")?.toIntOrNull() ?: 0
            if (id.isNotEmpty() && id != "0") {
                val fmt = formats[id]?.get(level) ?: "bullet"
                if (fmt == "bullet" || fmt == "none") label = if (level % 2 == 0) "•" else "◦"
                else {
                    val c = counters.getOrPut(id) { IntArray(10) }; c[level.coerceIn(0, 9)]++; for (k in level + 1..9) c[k] = 0
                    val n = c[level.coerceIn(0, 9)]
                    label = (when (fmt) { "lowerLetter" -> letterOf(n); "upperLetter" -> letterOf(n).uppercase(); "lowerRoman" -> romanOf(n); "upperRoman" -> romanOf(n).uppercase(); else -> n.toString() }) + "."
                }
            }
        }
        return DocPara(runsOf(p), headingOf[style] ?: 0, jc, label, level.coerceIn(0, 8), indent.coerceIn(0f, 200f))
    }
    fun imagesOf(p: X): List<DocImage> = p.descendants("a:blip").mapNotNull { b ->
        val target = rels[b.getAttribute("r:embed")] ?: return@mapNotNull null
        files["word/" + target.removePrefix("/word/").removePrefix("word/")]?.let(::DocImage)
    }

    // Content controls, tracked changes and similar wrappers hold the real paragraphs: look through them.
    fun flat(list: List<X>): List<X> = list.flatMap { e -> when (e.tagName) {
        "w:sdt" -> flat(e.child("w:sdtContent")?.elements() ?: emptyList())
        "w:sdtContent", "w:customXml", "w:ins", "w:smartTag" -> flat(e.elements())
        else -> listOf(e)
    } }
    // Text boxes live inside a drawing in a paragraph; show their paragraphs right after it. Word repeats them in a fallback copy, so skip repeats.
    fun boxesOf(p: X): List<DocPara> {
        val seen = HashSet<String>(); val out = ArrayList<DocPara>()
        for (box in p.descendants("w:txbxContent")) for (q in box.elements().filter { it.tagName == "w:p" }) { val para = paraOf(q); if (para.text.isNotBlank() && seen.add(para.text)) out += para }
        return out
    }
    fun tableOf(tbl: X) = DocTable(tbl.elements().filter { it.tagName == "w:tr" }.map { tr -> flat(tr.elements()).filter { it.tagName == "w:tc" }.map { tc -> flat(tc.elements()).filter { it.tagName == "w:p" }.map(::paraOf) } })

    val out = ArrayList<DocBlock>()
    for (e in flat(body.elements())) when (e.tagName) {
        "w:p" -> { out += paraOf(e); out += boxesOf(e); out += imagesOf(e) }
        "w:tbl" -> out += tableOf(e)
    }
    return out
}

private fun DocBlock.hasText(): Boolean = when (this) { is DocPara -> text.isNotBlank(); is DocTable -> rows.any { r -> r.any { c -> c.any { it.text.isNotBlank() } } }; else -> false }

/**
 * What the previewer shows for a Word file: the full reading; if that finds no text at all (a document made of pictures or objects the reader does not follow),
 * the plain paragraphs found anywhere in the file; and if there is still none, a plain note, so the file never opens as a blank page.
 */
fun docxForViewer(bytes: ByteArray): List<DocBlock> {
    val full = runCatching { docxBlocks(bytes) }.getOrDefault(emptyList())
    if (full.any { it.hasText() }) return full
    val plain = runCatching { docxPlainText(bytes) }.getOrDefault(emptyList())
    if (plain.isNotEmpty()) return full.filterIsInstance<DocImage>() + plain.map { DocPara(listOf(DocRun(it))) }
    return full.filterIsInstance<DocImage>() + DocPara(listOf(DocRun("Dokumen ini tidak memiliki teks yang bisa ditampilkan di sini (isinya mungkin gambar atau objek). Gunakan Unduh untuk membukanya di aplikasi lain.", italic = true)))
}

/** Cells of the first worksheet as text, capped so a huge sheet cannot exhaust memory. */
fun xlsxRows(bytes: ByteArray, maxRows: Int = 500, maxCols: Int = 30): List<List<String>> {
    val shared = zipEntry(bytes, "xl/sharedStrings.xml")?.let { xml ->
        Regex("<si>(.*?)</si>", RegexOption.DOT_MATCHES_ALL).findAll(xml).map { si -> Regex("<t(?:\\s[^>]*)?>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).findAll(si.groupValues[1]).joinToString("") { unescape(it.groupValues[1]) } }.toList()
    } ?: emptyList()
    val sheet = zipEntry(bytes, "xl/worksheets/sheet1.xml") ?: return emptyList()
    val cell = Regex("<c\\s([^>]*?)(?:/>|>(.*?)</c>)", RegexOption.DOT_MATCHES_ALL)
    return Regex("<row\\b[^>]*>(.*?)</row>", RegexOption.DOT_MATCHES_ALL).findAll(sheet).take(maxRows).map { row ->
        val out = ArrayList<String>()
        for (c in cell.findAll(row.groupValues[1])) {
            val attrs = c.groupValues[1]; val body = c.groupValues[2]
            val col = Regex("r=\"([A-Z]+)\\d+\"").find(attrs)?.groupValues?.get(1)?.fold(0) { a, ch -> a * 26 + (ch - 'A' + 1) }?.minus(1) ?: out.size
            if (col >= maxCols) continue
            while (out.size < col) out.add("")
            val v = Regex("<v>(.*?)</v>", RegexOption.DOT_MATCHES_ALL).find(body)?.groupValues?.get(1)
            val value = when {
                attrs.contains("t=\"s\"") -> v?.toIntOrNull()?.let { shared.getOrNull(it) } ?: ""
                attrs.contains("t=\"inlineStr\"") -> Regex("<t(?:\\s[^>]*)?>(.*?)</t>", RegexOption.DOT_MATCHES_ALL).find(body)?.groupValues?.get(1)?.let(::unescape) ?: ""
                else -> v?.let(::unescape) ?: ""
            }
            if (col < out.size) out[col] = value else out.add(value)
        }
        out as List<String>
    }.toList()
}

data class ZipItem(val name: String, val size: Long, val isDir: Boolean)
fun zipEntries(bytes: ByteArray, max: Int = 1000): List<ZipItem> {
    val out = ArrayList<ZipItem>()
    ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
        while (out.size < max) { val e = z.nextEntry ?: break; val size = if (e.size >= 0) e.size else { var n = 0L; val buf = ByteArray(8192); while (true) { val r = z.read(buf); if (r < 0) break; n += r }; n }; out.add(ZipItem(e.name, size, e.isDirectory)) }
    }
    return out
}

/** Comma-separated values with quotes ("a,b" and "" for a quote inside), tolerant of CRLF. */
fun parseCsv(text: String, maxRows: Int = 1000): List<List<String>> {
    val rows = ArrayList<List<String>>(); var row = ArrayList<String>(); val cur = StringBuilder(); var q = false; var i = 0
    fun endCell() { row.add(cur.toString()); cur.clear() }
    fun endRow() { endCell(); rows.add(row); row = ArrayList() }
    while (i < text.length && rows.size < maxRows) {
        val c = text[i]
        when {
            q && c == '"' && text.getOrNull(i + 1) == '"' -> { cur.append('"'); i++ }
            c == '"' -> q = !q
            !q && c == ',' -> endCell()
            !q && c == '\r' -> {}
            !q && c == '\n' -> endRow()
            else -> cur.append(c)
        }
        i++
    }
    if (cur.isNotEmpty() || row.isNotEmpty()) endRow()
    return rows
}
