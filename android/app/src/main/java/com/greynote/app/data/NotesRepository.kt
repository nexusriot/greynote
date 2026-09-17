package com.greynote.app.data

import com.google.gson.Gson
import com.greynote.app.api.ApiService
import com.greynote.app.api.model.ConflictResponse
import com.greynote.app.api.model.Note
import com.greynote.app.api.model.NoteUpsertRequest
import com.greynote.app.data.db.NoteDao
import com.greynote.app.data.db.NoteEntity
import kotlinx.coroutines.flow.Flow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** What a sync attempt did, for the status line in the UI. */
data class SyncResult(
    val pushed: Int = 0,
    val pulled: Int = 0,
    val conflicts: Int = 0,
    val error: String? = null,
    /**
     * Placeholder id -> server id, for notes that reached the server this run.
     * A screen holding one of those ids is pointing at a row that no longer
     * exists and has to follow the note to its new one.
     */
    val adopted: Map<Long, Long> = emptyMap(),
) {
    val ok: Boolean get() = error == null
}

/**
 * The single source of truth for notes on the device.
 *
 * Reads always come from Room, so the app works with no network at all. Writes
 * land locally first and are marked dirty; [sync] pushes them and pulls the
 * server's state back. A push the server rejects with 409 marks the note as
 * conflicted and keeps both copies until the user chooses one.
 */
class NotesRepository(
    private val dao: NoteDao,
    // Resolved per call, not captured: changing the server URL rebuilds the
    // Retrofit client, and a stored instance would keep talking to the old host.
    private val apiProvider: () -> ApiService,
    private val now: () -> String = ::timestampNow,
) {
    private val api: ApiService get() = apiProvider()

    fun observeNotes(query: String = "", tag: String = "", folder: String? = null): Flow<List<NoteEntity>> =
        dao.observeNotes(query.trim(), tag.trim().lowercase(), folder)

    fun observeNote(id: Long): Flow<NoteEntity?> = dao.observeNote(id)
    fun observePendingCount(): Flow<Int> = dao.observePendingCount()
    fun observeConflictCount(): Flow<Int> = dao.observeConflictCount()
    fun observeFolders(): Flow<List<String>> = dao.observeFolders()
    fun observeTagStrings(): Flow<List<String>> = dao.observeTagStrings()

    suspend fun find(id: Long): NoteEntity? = dao.find(id)

    /** Creates a note locally; it gets a real id on the next successful sync. */
    suspend fun create(title: String = "", content: String = "", tags: String = "", folder: String = ""): Long {
        val lowest = dao.lowestId() ?: 0
        val id = if (lowest < 0) lowest - 1 else -1
        val stamp = now()
        dao.upsert(
            NoteEntity(
                id = id,
                title = title,
                content = content,
                tags = tags,
                folder = folder,
                createdAt = stamp,
                localUpdatedAt = stamp,
                dirty = true,
            )
        )
        return id
    }

    /**
     * Writes an edit to the local store. Returns false when the row is gone —
     * the caller is holding a stale id and must not report the edit as saved.
     */
    suspend fun save(id: Long, title: String, content: String, tags: String, folder: String): Boolean {
        val existing = dao.find(id) ?: return false
        dao.update(
            existing.copy(
                title = title,
                content = content,
                tags = tags,
                folder = folder,
                localUpdatedAt = now(),
                dirty = true,
            )
        )
        return true
    }

    suspend fun setPinned(id: Long, pinned: Boolean) {
        val existing = dao.find(id) ?: return
        dao.update(existing.copy(isPinned = pinned, localUpdatedAt = now(), dirty = true))
    }

    /** Moves a note to the trash. A note that never reached the server just goes. */
    suspend fun trash(id: Long) {
        val existing = dao.find(id) ?: return
        if (existing.isLocalOnly) dao.delete(existing)
        else dao.update(existing.copy(pendingDelete = true, dirty = true))
    }

    /** Resolves a conflict by keeping the local copy and forcing it upstream. */
    suspend fun resolveKeepMine(id: Long) {
        val existing = dao.find(id) ?: return
        dao.update(existing.copy(conflict = false, dirty = true, updatedAt = existing.serverUpdatedAt ?: existing.updatedAt,
            serverContent = null, serverTitle = null, serverUpdatedAt = null))
    }

    /** Resolves a conflict by discarding the local edits. */
    suspend fun resolveKeepServer(id: Long) {
        val existing = dao.find(id) ?: return
        dao.update(
            existing.copy(
                title = existing.serverTitle ?: existing.title,
                content = existing.serverContent ?: existing.content,
                updatedAt = existing.serverUpdatedAt ?: existing.updatedAt,
                conflict = false,
                dirty = false,
                serverContent = null,
                serverTitle = null,
                serverUpdatedAt = null,
            )
        )
    }

    suspend fun clearCache() = dao.clear()

    /** Pushes local changes, then pulls the server's state. */
    suspend fun sync(): SyncResult {
        var pushed = 0
        var conflicts = 0
        val adopted = mutableMapOf<Long, Long>()

        try {
            for (note in dao.pendingDeletes()) {
                val res = api.deleteNote(note.id)
                // A 404 means it is already gone, which is the outcome we wanted.
                if (res.isSuccessful || res.code() == 404) {
                    dao.delete(note)
                    pushed++
                } else {
                    return SyncResult(pushed = pushed, error = "Delete failed (${res.code()})", adopted = adopted)
                }
            }

            for (note in dao.dirtyNotes()) {
                if (note.conflict) continue
                when (val outcome = push(note)) {
                    is PushOutcome.Pushed -> {
                        pushed++
                        outcome.adoptedId?.let { adopted[note.id] = it }
                    }
                    PushOutcome.Conflict -> conflicts++
                    PushOutcome.Failed -> return SyncResult(
                        pushed = pushed, conflicts = conflicts, error = "Upload failed", adopted = adopted,
                    )
                }
            }

            val pulled = pull()
            return SyncResult(pushed = pushed, pulled = pulled, conflicts = conflicts, adopted = adopted)
        } catch (e: Exception) {
            return SyncResult(
                pushed = pushed, conflicts = conflicts, error = e.message ?: "Network error", adopted = adopted,
            )
        }
    }

    private sealed interface PushOutcome {
        /** [adoptedId] is set when the row was re-keyed onto a fresh server id. */
        data class Pushed(val adoptedId: Long? = null) : PushOutcome
        object Conflict : PushOutcome
        object Failed : PushOutcome
    }

    private suspend fun push(note: NoteEntity): PushOutcome {
        val body = NoteUpsertRequest(
            title = note.title,
            content = note.content,
            tags = note.tags,
            isPinned = note.isPinned,
            folder = note.folder,
        )

        if (note.isLocalOnly) {
            val res = api.createNote(body)
            val newId = res.body()?.id
            if (!res.isSuccessful || newId == null) return PushOutcome.Failed
            // The placeholder row is replaced by one keyed on the server id, so
            // the caller is told where the note went.
            dao.delete(note)
            dao.upsert(note.copy(id = newId, dirty = false, localUpdatedAt = ""))
            return PushOutcome.Pushed(adoptedId = newId)
        }

        val res = api.updateNote(note.id, body, note.updatedAt.ifBlank { null })
        if (res.isSuccessful) {
            dao.update(note.copy(dirty = false, updatedAt = res.body()?.updatedAt ?: note.updatedAt, localUpdatedAt = ""))
            return PushOutcome.Pushed()
        }
        if (res.code() == 409) {
            val theirs = parseConflict(res.errorBody()?.string())
            dao.update(
                note.copy(
                    conflict = true,
                    serverTitle = theirs?.title,
                    serverContent = theirs?.content,
                    serverUpdatedAt = theirs?.updatedAt,
                )
            )
            return PushOutcome.Conflict
        }
        if (res.code() == 404) {
            // Deleted on the server while we were away; drop the local copy.
            dao.delete(note)
            return PushOutcome.Pushed()
        }
        return PushOutcome.Failed
    }

    private suspend fun pull(): Int {
        val remote = mutableListOf<Note>()
        var offset = 0
        while (true) {
            val res = api.listNotes(full = 1, limit = PAGE_SIZE, offset = offset)
            if (!res.isSuccessful) throw IllegalStateException("Download failed (${res.code()})")
            val page = res.body() ?: emptyList()
            remote += page
            if (page.size < PAGE_SIZE) break
            offset += PAGE_SIZE
        }

        val rows = mutableListOf<NoteEntity>()
        for (note in remote) {
            val local = dao.find(note.id)
            // Never overwrite something the user changed here but we could not push.
            if (local != null && (local.dirty || local.pendingDelete || local.conflict)) continue
            rows += note.toEntity()
        }
        dao.upsertAll(rows)
        dropNotesMissingFrom(remote.mapTo(mutableSetOf()) { it.id })
        return remote.size
    }

    /**
     * Removes the local copies of notes the server no longer lists.
     *
     * Worked out in Kotlin and deleted in batches rather than as one
     * `NOT IN (…)`: that binds one variable per note kept, and SQLite caps a
     * statement at 999 of them on the Android versions this app still supports —
     * so a library past a thousand notes would fail every sync. The list here is
     * only as long as the number of notes actually gone.
     */
    private suspend fun dropNotesMissingFrom(remoteIds: Set<Long>) {
        val stale = dao.cleanIds().filterNot { it in remoteIds }
        stale.chunked(DELETE_BATCH).forEach { dao.deleteByIds(it) }
    }

    /**
     * Gson fills a missing JSON field with null even where Kotlin says the type
     * is non-null, so every string is read defensively — an incomplete response
     * must not be able to crash a sync.
     */
    private fun Note.toEntity() = NoteEntity(
        id = id,
        title = title.orEmpty(),
        content = content.orEmpty(),
        tags = tags.orEmpty(),
        folder = folder.orEmpty(),
        isPinned = isPinned,
        createdAt = createdAt.orEmpty(),
        updatedAt = updatedAt.orEmpty(),
    )

    private fun parseConflict(body: String?): Note? =
        body?.let { runCatching { Gson().fromJson(it, ConflictResponse::class.java).current }.getOrNull() }

    companion object {
        private const val PAGE_SIZE = 200

        /** Well under SQLite's 999-variable ceiling on older Android releases. */
        private const val DELETE_BATCH = 400
    }
}

/** RFC3339 with milliseconds, matching what the server stores. */
fun timestampNow(): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date())
}

/** Today in the device's own timezone, as the journal endpoints expect. */
fun localDateToday(): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
