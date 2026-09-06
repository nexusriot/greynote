package main

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// normalizeTags turns a raw comma-separated tag string into the canonical form
// stored everywhere: trimmed, lowercased, de-duplicated, order preserved.
func normalizeTags(csv string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range strings.Split(csv, ",") {
		t := strings.ToLower(strings.TrimSpace(raw))
		t = strings.TrimPrefix(t, "#")
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

// setNoteTags makes note_tags the source of truth for a note's tags and keeps
// the denormalised notes.tags string in sync for API responses. It returns the
// normalised tag string that was stored.
func setNoteTags(ex execer, userID, noteID int64, csv string) (string, error) {
	tags := normalizeTags(csv)

	if _, err := ex.Exec(`DELETE FROM note_tags WHERE note_id=?`, noteID); err != nil {
		return "", err
	}
	for i, name := range tags {
		if _, err := ex.Exec(
			`INSERT OR IGNORE INTO tags(user_id, name, created_at) VALUES(?,?,?)`,
			userID, name, nowRFC3339(),
		); err != nil {
			return "", err
		}
		var tagID int64
		if err := ex.QueryRow(`SELECT id FROM tags WHERE user_id=? AND name=?`, userID, name).Scan(&tagID); err != nil {
			return "", err
		}
		if _, err := ex.Exec(
			`INSERT OR REPLACE INTO note_tags(note_id, tag_id, position) VALUES(?,?,?)`,
			noteID, tagID, i,
		); err != nil {
			return "", err
		}
	}

	joined := strings.Join(tags, ",")
	if _, err := ex.Exec(`UPDATE notes SET tags=? WHERE id=?`, joined, noteID); err != nil {
		return "", err
	}
	if err := pruneOrphanTags(ex, userID); err != nil {
		return "", err
	}
	return joined, reindexNote(ex, noteID)
}

// pruneOrphanTags drops tag rows no note references any more, so the tag list
// never shows labels the user has fully removed.
func pruneOrphanTags(ex execer, userID int64) error {
	_, err := ex.Exec(`
		DELETE FROM tags WHERE user_id=? AND id NOT IN (SELECT tag_id FROM note_tags)`, userID)
	return err
}

type TagsHandlers struct {
	DB *sql.DB
}

func NewTagsHandlers(db *sql.DB) *TagsHandlers {
	return &TagsHandlers{DB: db}
}

type tagDTO struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// GET /api/tags — every tag the user has, with live-note counts
func (h *TagsHandlers) List(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(`
		SELECT t.name, COUNT(n.id)
		FROM tags t
		LEFT JOIN note_tags nt ON nt.tag_id = t.id
		LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
		WHERE t.user_id = ?
		GROUP BY t.id, t.name
		ORDER BY t.name`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	out := []tagDTO{}
	for rows.Next() {
		var t tagDTO
		if err := rows.Scan(&t.Name, &t.Count); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		out = append(out, t)
	}
	c.JSON(http.StatusOK, out)
}

// notesWithTags returns the ids and current tag strings of every live note
// carrying any of the given tags.
func notesWithTags(ex execer, userID int64, names []string) (map[int64]string, error) {
	if len(names) == 0 {
		return map[int64]string{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(names)), ",")
	args := []any{userID}
	for _, n := range names {
		args = append(args, n)
	}

	rows, err := ex.Query(`
		SELECT DISTINCT n.id, n.tags
		FROM notes n
		JOIN note_tags nt ON nt.note_id = n.id
		JOIN tags t ON t.id = nt.tag_id
		WHERE n.user_id = ? AND t.name IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[int64]string{}
	for rows.Next() {
		var id int64
		var tags string
		if err := rows.Scan(&id, &tags); err != nil {
			return nil, err
		}
		out[id] = tags
	}
	return out, rows.Err()
}

// applyTagMapping rewrites every affected note's tag list through fn, which
// receives the note's current tags and returns the replacement list.
func applyTagMapping(db *sql.DB, userID int64, names []string, fn func([]string) []string) (int, error) {
	affected, err := notesWithTags(db, userID, names)
	if err != nil {
		return 0, err
	}
	for noteID, current := range affected {
		next := fn(normalizeTags(current))
		if _, err := setNoteTags(db, userID, noteID, strings.Join(next, ",")); err != nil {
			return 0, err
		}
	}
	return len(affected), nil
}

// PUT /api/tags/:name — rename a tag (merges into the target if it exists)
func (h *TagsHandlers) Rename(c *gin.Context) {
	userID := getUserID(c)
	old := strings.ToLower(strings.TrimSpace(c.Param("name")))

	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}
	next := normalizeTags(req.Name)
	if old == "" || len(next) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a single non-empty tag name is required"})
		return
	}
	newName := next[0]

	count, err := applyTagMapping(h.DB, userID, []string{old}, func(tags []string) []string {
		out := make([]string, 0, len(tags))
		for _, t := range tags {
			if t == old {
				out = append(out, newName)
			} else {
				out = append(out, t)
			}
		}
		return out
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"name": newName, "notesUpdated": count})
}

// POST /api/tags/merge — fold several tags into one
func (h *TagsHandlers) Merge(c *gin.Context) {
	userID := getUserID(c)

	var req struct {
		From []string `json:"from"`
		Into string   `json:"into"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}
	into := normalizeTags(req.Into)
	from := normalizeTags(strings.Join(req.From, ","))
	if len(into) != 1 || len(from) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from (non-empty) and a single into tag are required"})
		return
	}
	target := into[0]

	isSource := map[string]bool{}
	for _, f := range from {
		if f != target {
			isSource[f] = true
		}
	}
	if len(isSource) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nothing to merge"})
		return
	}

	names := make([]string, 0, len(isSource))
	for f := range isSource {
		names = append(names, f)
	}

	count, err := applyTagMapping(h.DB, userID, names, func(tags []string) []string {
		out := make([]string, 0, len(tags))
		for _, t := range tags {
			if isSource[t] {
				out = append(out, target)
			} else {
				out = append(out, t)
			}
		}
		return out
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"name": target, "notesUpdated": count})
}

// DELETE /api/tags/:name — strip a tag from every note that carries it
func (h *TagsHandlers) Delete(c *gin.Context) {
	userID := getUserID(c)
	name := strings.ToLower(strings.TrimSpace(c.Param("name")))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tag name required"})
		return
	}

	count, err := applyTagMapping(h.DB, userID, []string{name}, func(tags []string) []string {
		out := make([]string, 0, len(tags))
		for _, t := range tags {
			if t != name {
				out = append(out, t)
			}
		}
		return out
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"notesUpdated": count})
}
