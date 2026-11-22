package app.superdrive

import app.superdrive.core.DocKind
import app.superdrive.core.docKind
import app.superdrive.core.DocPara
import app.superdrive.core.DocTable
import app.superdrive.core.docxBlocks
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
        val doc = zip("word/document.xml" to "<w:document><w:body><w:p><w:r><w:t>Halo</w:t></w:r><w:r><w:t xml:space=\"preserve\"> dunia &amp; semua</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:t>Baris dua</w:t></w:r></w:p></w:body></w:document>")
        assertEquals(listOf("Halo dunia & semua", "", "Baris dua"), docxBlocks(doc).filterIsInstance<DocPara>().map { it.text })
    }
    @Test fun docxFormatting() {
        val doc = zip(
            "word/document.xml" to "<w:document><w:body>" +
                "<w:p><w:pPr><w:pStyle w:val=\"Judul\"/><w:jc w:val=\"center\"/></w:pPr><w:r><w:t>Laporan</w:t></w:r></w:p>" +
                "<w:p><w:r><w:rPr><w:b/><w:i/><w:color w:val=\"C00000\"/><w:sz w:val=\"28\"/></w:rPr><w:t>Tebal merah</w:t></w:r></w:p>" +
                "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr><w:r><w:t>Satu</w:t></w:r></w:p>" +
                "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"2\"/></w:numPr></w:pPr><w:r><w:t>A</w:t></w:r></w:p>" +
                "<w:p><w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"2\"/></w:numPr></w:pPr><w:r><w:t>B</w:t></w:r></w:p>" +
                "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>K1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>K2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
                "</w:body></w:document>",
            "word/styles.xml" to "<w:styles><w:style w:styleId=\"Judul\"><w:name w:val=\"Heading 1\"/></w:style></w:styles>",
            "word/numbering.xml" to "<w:numbering><w:abstractNum w:abstractNumId=\"0\"><w:lvl w:ilvl=\"0\"><w:numFmt w:val=\"bullet\"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId=\"1\"><w:lvl w:ilvl=\"0\"><w:numFmt w:val=\"decimal\"/></w:lvl></w:abstractNum><w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num><w:num w:numId=\"2\"><w:abstractNumId w:val=\"1\"/></w:num></w:numbering>",
        )
        val b = docxBlocks(doc); val paras = b.filterIsInstance<DocPara>()
        assertEquals(1, paras[0].heading); assertEquals("center", paras[0].align)
        assertEquals(true, paras[1].runs[0].bold); assertEquals(true, paras[1].runs[0].italic); assertEquals(0xC00000, paras[1].runs[0].color); assertEquals(14f, paras[1].runs[0].sizePt)
        assertEquals(listOf("•", "1.", "2."), paras.drop(2).map { it.label })
        assertEquals(listOf("K1", "K2"), (b.last() as DocTable).rows[0].map { it[0].text })
    }
    @Test fun xlsx() {
        val x = zip("xl/sharedStrings.xml" to "<sst><si><t>Nama</t></si><si><t>Umur</t></si><si><t>Ani</t></si></sst>",
            "xl/worksheets/sheet1.xml" to "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"C1\" t=\"s\"><v>1</v></c></row><row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\"><v>7</v></c><c r=\"C2\"><v>30</v></c></row></sheetData></worksheet>")
        assertEquals(listOf(listOf("Nama", "", "Umur"), listOf("Ani", "7", "30")), xlsxRows(x))
    }
    @Test fun zipList() { assertEquals(listOf("a.txt" to 3L, "d/b.txt" to 5L), zipEntries(zip("a.txt" to "abc", "d/b.txt" to "hello")).map { it.name to it.size }) }
    @Test fun csv() { assertEquals(listOf(listOf("a", "b,c", "d\"e"), listOf("1", "2", "3")), parseCsv("a,\"b,c\",\"d\"\"e\"\r\n1,2,3\n")) }
}
