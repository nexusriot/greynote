package main

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type trashedNoteDTO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Snippet   string `json:"snippet"`
	Tags      string `json:"tags"`
	UpdatedAt string `json:"updatedAt"`
	DeletedAt string `json:"deletedAt"`
	PurgeAt   string `json:"purgeAt,omitempty"`
}

// GET /api/notes/trash — notes waiting to be restored or purged
func (h *NotesHandlers) ListTrash(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(`
		SELECT id, title, content, tags, updated_at, deleted_at
		FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL
		ORDER BY deleted_at DESC`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	out := []trashedNoteDTO{}
	for rows.Next() {
		var t trashedNoteDTO
		var content string
		if err := rows.Scan(&t.ID, &t.Title, &content, &t.Tags, &t.UpdatedAt, &t.DeletedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		t.Snippet = snippetOf(content, 160)
		if h.TrashRetention > 0 {
			if deleted, err := time.Parse(time.RFC3339, t.DeletedAt); err == nil {
				t.PurgeAt = formatRFC3339(deleted.Add(h.TrashRetention))
			}
		}
		out = append(out, t)
	}
	c.JSON(http.StatusOK, out)
}

// POST /api/notes/:id/restore — bring a trashed note back
func (h *NotesHandlers) RestoreNote(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	res, err := h.DB.Exec(
		`UPDATE notes SET deleted_at=NULL WHERE id=? AND user_id=? AND deleted_at IS NOT NULL`, id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if err := reindexNote(h.DB, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if err := resolveUserLinks(h.DB, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.Status(http.StatusNoContent)
}

// DELETE /api/notes/:id/purge — delete a trashed note for good
func (h *NotesHandlers) PurgeNote(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	res, err := h.DB.Exec(
		`DELETE FROM notes WHERE id=? AND user_id=? AND deleted_at IS NOT NULL`, id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if err := afterPurge(h.DB, userID, []int64{id}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.Status(http.StatusNoContent)
}

// DELETE /api/notes/trash — empty the trash
func (h *NotesHandlers) EmptyTrash(c *gin.Context) {
	userID := getUserID(c)

	ids, err := trashedNoteIDs(h.DB, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if _, err := h.DB.Exec(
		`DELETE FROM notes WHERE user_id=? AND deleted_at IS NOT NULL`, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if err := afterPurge(h.DB, userID, ids); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"purged": len(ids)})
}

func trashedNoteIDs(db *sql.DB, userID int64) ([]int64, error) {
	rows, err := db.Query(`SELECT id FROM notes WHERE user_id=? AND deleted_at IS NOT NULL`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// afterPurge clears the derived state a hard-deleted note leaves behind. Rows in
// note_tags and note_links go with the cascade; the search index and the tag
// list do not.
func afterPurge(db *sql.DB, userID int64, ids []int64) error {
	for _, id := range ids {
		if err := deindexNote(db, id); err != nil {
			return err
		}
	}
	if err := pruneOrphanTags(db, userID); err != nil {
		return err
	}
	return resolveUserLinks(db, userID)
}

// purgeExpiredTrash hard-deletes notes that have sat in the trash longer than
// the retention window. Returns how many notes were removed.
func purgeExpiredTrash(db *sql.DB, retention time.Duration) (int, error) {
	if retention <= 0 {
		return 0, nil
	}
	cutoff := formatRFC3339(time.Now().Add(-retention))

	rows, err := db.Query(
		`SELECT id, user_id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	byUser := map[int64][]int64{}
	total := 0
	for rows.Next() {
		var id, userID int64
		if err := rows.Scan(&id, &userID); err != nil {
			rows.Close()
			return 0, err
		}
		byUser[userID] = append(byUser[userID], id)
		total++
	}
	rows.Close()
	if total == 0 {
		return 0, nil
	}

	if _, err := db.Exec(
		`DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff); err != nil {
		return 0, err
	}
	for userID, ids := range byUser {
		if err := afterPurge(db, userID, ids); err != nil {
			return 0, err
		}
	}
	return total, nil
}

// startTrashSweeper purges expired trash at startup and then on a slow ticker.
func startTrashSweeper(db *sql.DB, retention time.Duration) {
	if retention <= 0 {
		log.Printf("trash retention disabled — deleted notes are kept until purged by hand")
		return
	}
	sweep := func() {
		n, err := purgeExpiredTrash(db, retention)
		if err != nil {
			log.Printf("trash sweep failed: %v", err)
			return
		}
		if n > 0 {
			log.Printf("trash sweep purged %d note(s) older than %s", n, retention)
		}
	}
	sweep()

	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			sweep()
		}
	}()
}
