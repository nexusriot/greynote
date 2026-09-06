package com.greynote.app.data.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A note as it exists on this device.
 *
 * [id] is the server id. Notes created offline get a negative placeholder id
 * until the first successful push, at which point the row is rewritten with the
 * real one.
 *
 * [updatedAt] is the server's version token, sent back as `If-Match`; it is not
 * touched by local edits. [localUpdatedAt] is when the user last changed the
 * note here and drives ordering, so an offline edit still floats to the top.
 */
@Entity(
    tableName = "notes",
    indices = [Index("folder"), Index("localUpdatedAt")],
)
data class NoteEntity(
    @PrimaryKey val id: Long,
    val title: String = "",
    val content: String = "",
    val tags: String = "",
    val folder: String = "",
    val isPinned: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = "",
    val localUpdatedAt: String = "",
    /** Local changes waiting to be pushed. */
    val dirty: Boolean = false,
    /** Trashed here, not yet on the server. */
    val pendingDelete: Boolean = false,
    /** The server refused our last push because it had a newer copy. */
    val conflict: Boolean = false,
    val serverContent: String? = null,
    val serverTitle: String? = null,
    val serverUpdatedAt: String? = null,
) {
    val isLocalOnly: Boolean get() = id < 0

    /** The timestamp to show and sort by. */
    val displayUpdatedAt: String get() = if (localUpdatedAt > updatedAt) localUpdatedAt else updatedAt
}
