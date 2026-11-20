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

/** Paragraphs of a Word document, in order. Formatting, images and tables' layout are not kept. */
fun docxParagraphs(bytes: ByteArray): List<String> {
    val xml = zipEntry(bytes, "word/document.xml") ?: return emptyList()
    val text = Regex("<w:t(?:\\s[^>]*)?>(.*?)</w:t>|<w:tab\\s*/>|<w:br\\s*/>", RegexOption.DOT_MATCHES_ALL)
    return xml.split("</w:p>").map { p ->
        text.findAll(p).joinToString("") { m -> when { m.value.startsWith("<w:tab") -> "\t"; m.value.startsWith("<w:br") -> "\n"; else -> unescape(m.groupValues[1]) } }
    }.filter { it.isNotBlank() }
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
