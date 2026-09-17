package com.greynote.app.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    @Query(
        """
        SELECT * FROM notes
        WHERE pendingDelete = 0
          AND (:query = '' OR title LIKE '%' || :query || '%' OR content LIKE '%' || :query || '%' OR tags LIKE '%' || :query || '%')
          AND (:tag = '' OR ',' || tags || ',' LIKE '%,' || :tag || ',%')
          AND (:folder IS NULL OR folder = :folder OR (:folder != '' AND folder LIKE :folder || '/%'))
        ORDER BY isPinned DESC,
                 CASE WHEN localUpdatedAt > updatedAt THEN localUpdatedAt ELSE updatedAt END DESC
        """
    )
    fun observeNotes(query: String, tag: String, folder: String?): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE id = :id")
    fun observeNote(id: Long): Flow<NoteEntity?>

    @Query("SELECT * FROM notes WHERE id = :id")
    suspend fun find(id: Long): NoteEntity?

    @Query("SELECT * FROM notes WHERE pendingDelete = 1")
    suspend fun pendingDeletes(): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE dirty = 1 AND pendingDelete = 0")
    suspend fun dirtyNotes(): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE pendingDelete = 0")
    suspend fun allLive(): List<NoteEntity>

    @Query("SELECT COUNT(*) FROM notes WHERE dirty = 1 OR pendingDelete = 1")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM notes WHERE conflict = 1")
    fun observeConflictCount(): Flow<Int>

    @Query("SELECT DISTINCT folder FROM notes WHERE pendingDelete = 0 AND folder != '' ORDER BY folder")
    fun observeFolders(): Flow<List<String>>

    @Query("SELECT tags FROM notes WHERE pendingDelete = 0 AND tags != ''")
    fun observeTagStrings(): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(note: NoteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(notes: List<NoteEntity>)

    @Update
    suspend fun update(note: NoteEntity)

    @Delete
    suspend fun delete(note: NoteEntity)

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun deleteById(id: Long)

    /** Ids of rows that hold nothing the server has not already been told. */
    @Query("SELECT id FROM notes WHERE dirty = 0 AND pendingDelete = 0")
    suspend fun cleanIds(): List<Long>

    @Query("DELETE FROM notes WHERE dirty = 0 AND pendingDelete = 0 AND id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("DELETE FROM notes")
    suspend fun clear()

    @Query("SELECT MIN(id) FROM notes")
    suspend fun lowestId(): Long?
}
