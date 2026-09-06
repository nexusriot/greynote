package com.greynote.app.api.model

data class Note(
    val id: Long,
    val title: String,
    val content: String,
    val tags: String,
    val isPinned: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val shareUrl: String? = null,
    val sharePasswordSet: Boolean = false,
    val shareExpiresAt: String? = null,
)

data class NoteUpsertRequest(
    val title: String,
    val content: String,
    val tags: String,
    val isPinned: Boolean,
)

data class CreateNoteResponse(val id: Long)

data class UpdateNoteResponse(val updatedAt: String)

// ConflictResponse is the body of a 409 from PUT /api/notes/{id}.
data class ConflictResponse(val error: String? = null, val current: Note? = null)

data class PinResponse(val isPinned: Boolean)
