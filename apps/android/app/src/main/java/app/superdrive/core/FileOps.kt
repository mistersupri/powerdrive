package app.superdrive.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

@Serializable data class ShareLink(val id: String, val url: String, val role: String = "VIEWER", val name: String = "", val hasPassword: Boolean = false, val expiresAt: String? = null, val title: String? = null)
@Serializable data class Activity(val id: String, val action: String, val actor: String = "", val at: String = "", val meta: JsonObject = JsonObject(emptyMap()))
@Serializable data class MetaRow(val k: String, val v: String)
@Serializable data class MetaGroup(val title: String, val rows: List<MetaRow> = emptyList())
@Serializable data class FolderStats(val files: Int = 0, val folders: Int = 0, val bytes: Long = 0, val truncated: Boolean = false)
@Serializable data class Comment(val id: String, val body: String, val authorName: String = "", val createdAt: String = "", val mine: Boolean = false)

/** Everything a person can do to a file or folder. Each call is one request; the server decides what is allowed. */
class FileOps(private val api: Api) {
    suspend fun rename(f: FileEntry, name: String) { api.send("POST", "/files/rename", buildJsonObject { put("storageId", f.storageId); put("fileId", f.id); put("name", name) }) }
    /** Moves to the trash (recoverable), not a permanent delete. */
    suspend fun trash(f: FileEntry) { api.send("DELETE", "/files/${f.storageId}/${f.id}") }
    suspend fun star(f: FileEntry, on: Boolean) { api.send("POST", "/files/${f.storageId}/${f.id}/star", buildJsonObject { put("starred", on) }) }
    suspend fun newFolder(storageId: String, parentId: String, name: String) { api.send("POST", "/files/folders", buildJsonObject { put("storageId", storageId); put("parentId", parentId); put("name", name) }) }

    /** Copy or move: always a transfer job on the server, so it is tracked on the Transfer tab. */
    suspend fun transfer(type: String, items: List<FileEntry>, destStorageId: String, destFolderId: String) {
        require(items.isNotEmpty())
        api.send("POST", "/transfers", buildJsonObject {
            put("type", type)
            put("source", buildJsonObject { put("storageId", items.first().storageId); put("fileIds", JsonArray(items.map { JsonPrimitive(it.id) })) })
            put("destination", buildJsonObject { put("storageId", destStorageId); put("folderId", destFolderId) })
            put("conflictPolicy", "RENAME"); put("idempotencyKey", UUID.randomUUID().toString())
        })
    }

    suspend fun createShare(items: List<FileEntry>, role: String, expiresInDays: Int?, password: String?, title: String?): ShareLink =
        api.post("/shares", buildJsonObject {
            put("storageId", items.first().storageId)
            if (items.size == 1) put("fileId", items.first().id) else put("fileIds", JsonArray(items.map { JsonPrimitive(it.id) }))
            put("role", role)
            put("expiresInDays", expiresInDays?.let { JsonPrimitive(it) } ?: JsonNull)
            put("password", password?.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("title", title?.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it) } ?: JsonNull)
        })

    /** EXIF and video details; empty for other files. */
    suspend fun metadata(f: FileEntry): List<MetaGroup> = api.get("/files/${f.storageId}/${f.id}/metadata")
    suspend fun stats(f: FileEntry): FolderStats = api.get("/files/${f.storageId}/${f.id}/stats")
    suspend fun activity(f: FileEntry): List<Activity> = api.get("/files/${f.storageId}/${f.id}/activity")
    suspend fun comments(f: FileEntry): List<Comment> = api.get("/files/${f.storageId}/${f.id}/comments")
    suspend fun addComment(f: FileEntry, body: String): List<Comment> = api.post("/files/${f.storageId}/${f.id}/comments", buildJsonObject { put("body", body) })
    suspend fun tags(f: FileEntry): List<String> = api.get("/files/${f.storageId}/${f.id}/tags")
    suspend fun addTag(f: FileEntry, tag: String): List<String> = api.post("/files/${f.storageId}/${f.id}/tags", buildJsonObject { put("tag", tag) })
}
