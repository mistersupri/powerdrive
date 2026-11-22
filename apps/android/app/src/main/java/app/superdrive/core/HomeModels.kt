package app.superdrive.core

import kotlinx.serialization.Serializable

/** A folder somewhere in a storage: folderId is null at the top. */
@Serializable data class Place(val storageId: String = "", val folderId: String? = null, val path: String = "/")
@Serializable data class UploadHistoryItem(val id: String, val storageId: String = "", val storageName: String = "", val fileId: String? = null, val name: String, val size: Long = 0, val status: String = "DONE", val errorMessage: String? = null, val createdAt: String = "", val place: Place? = null)
@Serializable data class UploadHistoryPage(val items: List<UploadHistoryItem> = emptyList(), val total: Int = 0)
@Serializable data class Quota(val used: Long? = null, val total: Long? = null)
@Serializable data class StorageInfo(val id: String, val name: String, val provider: String = "", val status: String = "CONNECTED", val quota: Quota? = null)
@Serializable data class TransferCounts(val active: Int = 0, val completed: Int = 0, val failed: Int = 0)
@Serializable data class AuditEntry(val id: String, val action: String, val userName: String? = null, val createdAt: String = "")
@Serializable data class Dashboard(
    val storages: Int = 0, val providers: Int = 0, val knownCapacity: Long = 0, val knownUsage: Long = 0,
    val transfers: TransferCounts = TransferCounts(), val recentActivity: List<AuditEntry> = emptyList(), val storageList: List<StorageInfo> = emptyList(),
)

@Serializable data class TransferJob(
    val id: String, val type: String = "COPY", val status: String, val title: String = "",
    val sourceStorageName: String = "", val destinationStorageName: String = "",
    val totalFiles: Int = 0, val completedFiles: Int = 0, val skippedFiles: Int = 0,
    val totalBytes: Long? = null, val transferredBytes: Long = 0, val errorMessage: String? = null, val createdAt: String = "",
    val sourcePlace: Place? = null, val destinationPlace: Place? = null,
) {
    val active get() = status in ACTIVE
    val paused get() = status == "PAUSED"
    /** 0..100, from bytes when the total is known, else from finished files. */
    val percent: Int get() = when {
        totalBytes != null && totalBytes > 0 -> (transferredBytes * 100 / totalBytes).toInt()
        totalFiles > 0 -> (completedFiles + skippedFiles) * 100 / totalFiles
        else -> 0
    }.coerceIn(0, 100)
    companion object { val ACTIVE = setOf("QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING") }
}
@Serializable data class TransferPage(val items: List<TransferJob> = emptyList(), val total: Int = 0)

@Serializable data class AppNotification(val id: String, val type: String = "", val title: String, val message: String = "", val readAt: String? = null, val createdAt: String = "")
@Serializable data class Notifications(val items: List<AppNotification> = emptyList(), val unread: Int = 0)
@Serializable data class SearchResult(val items: List<FileEntry> = emptyList(), val total: Int = 0)

/** Short label for an audit action such as "file.upload". */
fun auditLabel(action: String): String = when (action) {
    "file.upload", "upload" -> "mengunggah file"; "file.rename" -> "mengganti nama"; "file.delete", "file.trash" -> "menghapus file"
    "file.move" -> "memindahkan file"; "file.copy" -> "menyalin file"; "share.create" -> "membuat tautan berbagi"; "auth.login" -> "masuk"
    else -> action.replace('.', ' ').replace('_', ' ')
}

@Serializable data class ShareItem(
    val id: String, val title: String? = null, val kind: String = "single", val itemCount: Int = 1, val storageId: String = "", val storageName: String = "",
    val fileId: String = "", val name: String = "", val isFolder: Boolean = false, val role: String = "VIEWER", val url: String = "",
    val hasPassword: Boolean = false, val expiresAt: String? = null, val accessCount: Int = 0, val createdAt: String = "", val createdByName: String? = null, val expired: Boolean = false, val place: Place? = null,
)
/** An automation as the server describes it. trigger and actions stay as JSON; the screen only reads a few fields. */
@Serializable data class AutomationItem(
    val id: String, val name: String, val enabled: Boolean = true, val storageName: String? = null, val folderPath: String? = null, val recursive: Boolean = true,
    val trigger: kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.JsonObject(emptyMap()), val actions: List<kotlinx.serialization.json.JsonObject> = emptyList(),
    val nextRunAt: String? = null, val lastRunAt: String? = null, val lastStatus: String? = null, val lastMessage: String? = null, val canEdit: Boolean = false, val createdByName: String = "",
)
@Serializable data class AutomationRun(val id: String, val startedAt: String = "", val status: String = "", val trigger: String = "", val matched: Int = 0, val acted: Int = 0, val message: String? = null, val dryRun: Boolean = false)
@Serializable data class SharePage(val items: List<ShareItem> = emptyList(), val total: Int = 0)
