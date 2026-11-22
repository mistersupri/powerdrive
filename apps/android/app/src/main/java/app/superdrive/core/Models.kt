package app.superdrive.core

import kotlinx.serialization.Serializable

// The same shapes the API sends to the website (packages/shared). Unknown fields are ignored, so the server can grow without breaking the app.

@Serializable data class User(val id: String, val email: String, val name: String, val isSuperAdmin: Boolean = false)
@Serializable data class Workspace(val id: String, val name: String, val role: String = "MEMBER")
@Serializable data class Me(val user: User, val workspaces: List<Workspace> = emptyList(), val activeWorkspaceId: String)

/** Either a signed-in session, or (for accounts with two-step verification) a challenge that still needs a code. */
@Serializable data class LoginResult(val user: User? = null, val mfaRequired: Boolean = false, val challenge: String? = null, val mfaSetupRequired: Boolean = false)

@Serializable data class Storage(val id: String, val name: String, val provider: String = "", val status: String = "CONNECTED", val isDefault: Boolean = false)

@Serializable
data class FileEntry(
    val id: String, val storageId: String, val parentId: String? = null, val name: String, val isFolder: Boolean,
    val mimeType: String? = null, val size: Long? = null, val modifiedAt: String? = null, val hasThumbnail: Boolean = false,
    val version: String? = null, val starred: Boolean = false, val changed: Boolean = false,
    val createdAt: String? = null, val checksum: String? = null, val path: String? = null, val color: String? = null,
)
/** What a folder holds: its item count and a few files to show peeking out of it. */
@Serializable data class FolderPeek(val count: Int = 0, val files: List<FileEntry> = emptyList())
@Serializable data class FolderPeeks(val items: Map<String, FolderPeek> = emptyMap())
@Serializable data class Crumb(val id: String, val name: String)
@Serializable data class FolderInfo(val id: String, val name: String = "", val parentId: String? = null, val path: List<Crumb> = emptyList())
@Serializable data class FileListing(val items: List<FileEntry>, val nextPageToken: String? = null, val folder: FolderInfo)
