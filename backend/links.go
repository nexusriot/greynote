package main

import (
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

var (
	wikiLinkRe   = regexp.MustCompile(`\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]`)
	fencedCodeRe = regexp.MustCompile("(?s)```.*?```")
	inlineCodeRe = regexp.MustCompile("`[^`\n]*`")
)

// parseWikiLinks extracts the target titles of every [[wiki link]] in a note,
// in order of appearance and without duplicates. Links inside code fences or
// inline code are ignored so documentation about the syntax does not create
// phantom links.
func parseWikiLinks(content string) []string {
	stripped := inlineCodeRe.ReplaceAllString(fencedCodeRe.ReplaceAllString(content, ""), "")

	out := []string{}
	seen := map[string]bool{}
	for _, m := range wikiLinkRe.FindAllStringSubmatch(stripped, -1) {
		title := strings.TrimSpace(m[1])
		if title == "" {
			continue
		}
		key := strings.ToLower(title)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, title)
	}
	return out
}

// setNoteLinks replaces the outgoing link rows of a note. Targets are stored by
// title and resolved to ids separately, so a link to a note that does not exist
// yet is remembered and lights up once that note is created.
func setNoteLinks(ex execer, noteID int64, content string) error {
	if _, err := ex.Exec(`DELETE FROM note_links WHERE source_id=?`, noteID); err != nil {
		return err
	}
	for i, title := range parseWikiLinks(content) {
		if _, err := ex.Exec(
			`INSERT OR IGNORE INTO note_links(source_id, target_id, target_title, position) VALUES(?,NULL,?,?)`,
			noteID, title, i,
		); err != nil {
			return err
		}
	}
	return nil
}

// resolveUserLinks re-points every link owned by the user at the note whose
// title it names. Run after any title change, creation, deletion or restore.
func resolveUserLinks(ex execer, userID int64) error {
	_, err := ex.Exec(`
		UPDATE note_links
		SET target_id = (
			SELECT n2.id FROM notes n2
			WHERE n2.user_id = ?
			  AND n2.deleted_at IS NULL
			  AND lower(n2.title) = lower(note_links.target_title)
			ORDER BY n2.id LIMIT 1
		)
		WHERE source_id IN (SELECT id FROM notes WHERE user_id = ?)`, userID, userID)
	return err
}

type linkDTO struct {
	Title string `json:"title"`
	ID    *int64 `json:"id"`
}

type backlinkDTO struct {
	ID      int64  `json:"id"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
}

// GET /api/notes/:id/links — outgoing wiki links and incoming backlinks
func (h *NotesHandlers) Links(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(
		`SELECT id FROM notes WHERE id=? AND user_id=? AND deleted_at IS NULL`, noteID, userID,
	).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	outgoing := []linkDTO{}
	rows, err := h.DB.Query(
		`SELECT target_title, target_id FROM note_links WHERE source_id=? ORDER BY position`, noteID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	for rows.Next() {
		var l linkDTO
		var targetID sql.NullInt64
		if err := rows.Scan(&l.Title, &targetID); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		if targetID.Valid {
			id := targetID.Int64
			l.ID = &id
		}
		outgoing = append(outgoing, l)
	}
	rows.Close()

	backlinks := []backlinkDTO{}
	brows, err := h.DB.Query(`
		SELECT n.id, n.title, n.content
		FROM note_links l JOIN notes n ON n.id = l.source_id
		WHERE l.target_id = ? AND n.user_id = ? AND n.deleted_at IS NULL
		ORDER BY n.updated_at DESC`, noteID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer brows.Close()
	for brows.Next() {
		var b backlinkDTO
		var content string
		if err := brows.Scan(&b.ID, &b.Title, &content); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		b.Snippet = snippetOf(content, 160)
		backlinks = append(backlinks, b)
	}

	c.JSON(http.StatusOK, gin.H{"outgoing": outgoing, "backlinks": backlinks})
}
