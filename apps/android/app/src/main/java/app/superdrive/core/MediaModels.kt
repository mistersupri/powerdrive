package app.superdrive.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class MediaCounts(val image: Int = 0, val video: Int = 0)
@Serializable data class MediaPage(val items: List<FileEntry> = emptyList(), val nextCursor: String? = null, val counts: MediaCounts = MediaCounts())

/** A folder that holds photos or videos (the gallery's "Folder" view). */
@Serializable data class MediaFolder(val storageId: String, val folderId: String, val name: String, val storageName: String = "", val count: Int = 0, val cover: FileEntry? = null)
@Serializable data class MediaFolders(val items: List<MediaFolder> = emptyList())

@Serializable data class Album(val id: String, val name: String, val isPrivate: Boolean = false, val count: Int = 0, val updatedAt: String = "", val cover: FileEntry? = null)
@Serializable data class PrivateStatus(val hasPassword: Boolean = false, val unlocked: Boolean = false, val until: String? = null, val count: Int = 0)
@Serializable data class Albums(val albums: List<Album> = emptyList(), @SerialName("private") val privateStatus: PrivateStatus = PrivateStatus())

/** "On this day": earlier years' photos from today and the next three days. */
@Serializable data class HighlightGroup(val year: Int, val yearsAgo: Int, val total: Int = 0, val items: List<FileEntry> = emptyList())
@Serializable data class Highlights(val from: String = "", val until: String = "", val groups: List<HighlightGroup> = emptyList())
