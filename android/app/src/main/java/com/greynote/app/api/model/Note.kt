package com.greynote.app.api.model

data class Note(
    val id: Long,
    val title: String = "",
    val content: String = "",
    // The list endpoint sends a snippet instead of the whole body, and omits it
    // for an empty note — hence nullable.
    val snippet: String? = null,
    val tags: String = "",
    val folder: String = "",
    val dailyDate: String? = null,
    val isPinned: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = "",
    val shareUrl: String? = null,
    val sharePasswordSet: Boolean = false,
    val shareExpiresAt: String? = null,
)

data class NoteUpsertRequest(
    val title: String,
    val content: String,
    val tags: String,
    val isPinned: Boolean,
    val folder: String = "",
)

data class CreateNoteResponse(val id: Long)

data class UpdateNoteResponse(val updatedAt: String)

// ConflictResponse is the body of a 409 from PUT /api/notes/{id}.
data class ConflictResponse(val error: String? = null, val current: Note? = null)

data class PinResponse(val isPinned: Boolean)

data class SearchHit(
    val id: Long,
    val title: String = "",
    val tags: String = "",
    val snippet: String = "",
    val isPinned: Boolean = false,
    val updatedAt: String = "",
)

data class SearchResponse(val results: List<SearchHit> = emptyList(), val indexed: Boolean = false)

data class NoteLink(val title: String, val id: Long?)

data class Backlink(val id: Long, val title: String, val snippet: String)

data class LinksResponse(
    val outgoing: List<NoteLink> = emptyList(),
    val backlinks: List<Backlink> = emptyList(),
)

data class NoteVersionSummary(val id: Long, val title: String, val savedAt: String)

data class NoteVersion(val id: Long, val title: String, val content: String, val tags: String, val savedAt: String)

data class TrashedNote(
    val id: Long,
    val title: String = "",
    val snippet: String = "",
    val tags: String = "",
    val deletedAt: String = "",
    val purgeAt: String? = null,
)

data class PurgeResponse(val purged: Int = 0)

data class DailyRequest(val date: String)

data class DailyResponse(val id: Long, val created: Boolean = false, val date: String = "")

data class DailyEntry(val id: Long, val date: String, val title: String)

data class Template(
    val id: Long = 0,
    val name: String = "",
    val title: String = "",
    val content: String = "",
    val tags: String = "",
    val folder: String = "",
    val isDaily: Boolean = false,
)

data class ApplyTemplateRequest(val title: String = "", val date: String = "")

data class TagCount(val name: String, val count: Int)

data class RenameRequest(val name: String)

data class MergeTagsRequest(val from: List<String>, val into: String)

data class TagMutationResponse(val name: String = "", val notesUpdated: Int = 0)

data class Folder(val path: String, val count: Int = 0, val total: Int = 0)

data class MoveFolderRequest(val from: String, val to: String)

data class FolderMutationResponse(val path: String = "", val notesUpdated: Int = 0)

data class ShareRequest(val expiresAt: String = "")

data class ShareResponse(val token: String = "", val shareUrl: String = "")

data class SharePasswordRequest(val password: String)

// An empty expiresAt clears the expiry: the link then works until disabled.
data class ShareExpiryRequest(val expiresAt: String = "")

data class ImageUploadResponse(val url: String)

data class ImportSkip(val name: String = "", val reason: String = "")

data class ImportResponse(val imported: Int = 0, val skipped: List<ImportSkip> = emptyList())

data class StatsResponse(
    val totalNotes: Int = 0,
    val totalWords: Int = 0,
    val topTags: List<StatsTag> = emptyList(),
    val notesPerMonth: List<MonthCount> = emptyList(),
)

// The stats endpoint names the field "tag", unlike /api/tags which sends "name".
data class StatsTag(val tag: String = "", val count: Int = 0)

data class MonthCount(val month: String, val count: Int)
