package app.superdrive

import app.superdrive.core.DocKind
import app.superdrive.core.docKind
import app.superdrive.core.docxParagraphs
import app.superdrive.core.parseCsv
import app.superdrive.core.xlsxRows
import app.superdrive.core.zipEntries
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Test

private fun zip(vararg files: Pair<String, String>): ByteArray {
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { z -> files.forEach { (n, c) -> z.putNextEntry(ZipEntry(n)); z.write(c.toByteArray()); z.closeEntry() } }
    return out.toByteArray()
}

class DocParseTest {
    @Test fun kinds() {
        assertEquals(DocKind.Pdf, docKind("a.PDF", null)); assertEquals(DocKind.Image, docKind("x", "image/png")); assertEquals(DocKind.Text, docKind("a.json", null))
        assertEquals(DocKind.Csv, docKind("t.csv", "text/csv")); assertEquals(DocKind.Docx, docKind("l.docx", null)); assertEquals(DocKind.Other, docKind("a.bin", "application/octet-stream"))
    }
    @Test fun docx() {
        val doc = zip("word/document.xml" to "<w:document><w:p><w:r><w:t>Halo</w:t></w:r><w:r><w:t xml:space=\"preserve\"> dunia &amp; semua</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:t>Baris dua</w:t></w:r></w:p></w:document>")
        assertEquals(listOf("Halo dunia & semua", "Baris dua"), docxParagraphs(doc))
    }
    @Test fun xlsx() {
        val x = zip("xl/sharedStrings.xml" to "<sst><si><t>Nama</t></si><si><t>Umur</t></si><si><t>Ani</t></si></sst>",
            "xl/worksheets/sheet1.xml" to "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"C1\" t=\"s\"><v>1</v></c></row><row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\"><v>7</v></c><c r=\"C2\"><v>30</v></c></row></sheetData></worksheet>")
        assertEquals(listOf(listOf("Nama", "", "Umur"), listOf("Ani", "7", "30")), xlsxRows(x))
    }
    @Test fun zipList() { assertEquals(listOf("a.txt" to 3L, "d/b.txt" to 5L), zipEntries(zip("a.txt" to "abc", "d/b.txt" to "hello")).map { it.name to it.size }) }
    @Test fun csv() { assertEquals(listOf(listOf("a", "b,c", "d\"e"), listOf("1", "2", "3")), parseCsv("a,\"b,c\",\"d\"\"e\"\r\n1,2,3\n")) }
}
