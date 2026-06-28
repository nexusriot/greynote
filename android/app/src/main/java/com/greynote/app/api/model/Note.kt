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

data class PinResponse(val isPinned: Boolean)
