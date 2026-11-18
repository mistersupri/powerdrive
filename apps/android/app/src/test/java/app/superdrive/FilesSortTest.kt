package app.superdrive

import app.superdrive.core.FileEntry
import app.superdrive.ui.files.sortedForDisplay
import org.junit.Assert.assertEquals
import org.junit.Test

class FilesSortTest {
    private fun f(name: String, folder: Boolean = false) = FileEntry(id = name, storageId = "s", name = name, isFolder = folder)

    @Test fun foldersComeFirstThenNaturalOrder() {
        val sorted = sortedForDisplay(listOf(f("b.txt"), f("file 10.txt"), f("file 2.txt"), f("Zebra", true), f("alpha", true), f("A.txt")))
        assertEquals(listOf("alpha", "Zebra", "A.txt", "b.txt", "file 2.txt", "file 10.txt"), sorted.map { it.name })
    }

    @Test fun ignoresCaseAndLeadingZeros() {
        val sorted = sortedForDisplay(listOf(f("IMG_010.jpg"), f("img_9.jpg"), f("Img_100.jpg")))
        assertEquals(listOf("img_9.jpg", "IMG_010.jpg", "Img_100.jpg"), sorted.map { it.name })
    }
}
