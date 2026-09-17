package main

import (
	"database/sql"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	folderMaxDepth      = 8
	folderMaxPathLength = 200
)

// normalizeFolder canonicalises a folder path: "/Work//Projects/ " becomes
// "Work/Projects". Folders are plain paths on the note row rather than a table,
// which keeps moving a note a single UPDATE and matches how markdown vaults are
// usually organised. Case is preserved (unlike tags) because folder names read
// as titles.
func normalizeFolder(path string) string {
	segments := []string{}
	for _, raw := range strings.Split(path, "/") {
		seg := strings.TrimSpace(raw)
		if seg == "" || seg == "." || seg == ".." {
			continue
		}
		segments = append(segments, seg)
		if len(segments) == folderMaxDepth {
			break
		}
	}

	// Counted in runes, not bytes: cutting a path at a byte offset can land in
	// the middle of a multi-byte character, and the invalid UTF-8 that leaves in
	// the database comes back out as U+FFFD, so the folder can never be matched
	// by the very path the API reports.
	out := strings.Join(segments, "/")
	if runes := []rune(out); len(runes) > folderMaxPathLength {
		out = string(runes[:folderMaxPathLength])
		if i := strings.LastIndex(out, "/"); i > 0 {
			out = out[:i]
		}
	}
	return out
}

// folderAncestors lists every parent path of a folder, closest last.
func folderAncestors(path string) []string {
	segments := strings.Split(path, "/")
	out := []string{}
	for i := 1; i < len(segments); i++ {
		out = append(out, strings.Join(segments[:i], "/"))
	}
	return out
}

type folderDTO struct {
	Path string `json:"path"`
	// Count is the number of notes directly in the folder; Total includes
	// everything nested below it.
	Count int `json:"count"`
	Total int `json:"total"`
}

// GET /api/folders — the folder tree derived from note paths
func (h *NotesHandlers) ListFolders(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(`
		SELECT folder, COUNT(*) FROM notes
		WHERE user_id = ? AND deleted_at IS NULL AND folder != ''
		GROUP BY folder`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	direct := map[string]int{}
	total := map[string]int{}
	for rows.Next() {
		var path string
		var count int
		if err := rows.Scan(&path, &count); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		direct[path] += count
		total[path] += count
		// A folder that only exists as a parent still belongs in the tree.
		for _, parent := range folderAncestors(path) {
			if _, ok := direct[parent]; !ok {
				direct[parent] = 0
			}
			total[parent] += count
		}
	}

	out := make([]folderDTO, 0, len(direct))
	for path, count := range direct {
		out = append(out, folderDTO{Path: path, Count: count, Total: total[path]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })

	c.JSON(http.StatusOK, out)
}

// moveFolder repoints a folder and everything nested under it. An empty `to`
// moves the contents to the root.
func moveFolder(db *sql.DB, userID int64, from, to string) (int64, error) {
	res, err := db.Exec(`
		UPDATE notes
		SET folder = CASE
			WHEN folder = ? THEN ?
			ELSE TRIM(? || SUBSTR(folder, LENGTH(?) + 1), '/')
		END
		WHERE user_id = ? AND (folder = ? OR folder LIKE ?)`,
		from, to, to, from, userID, from, from+"/%")
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// PUT /api/folders — rename or move a folder (and its subfolders)
func (h *NotesHandlers) RenameFolder(c *gin.Context) {
	userID := getUserID(c)

	var req struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}

	from := normalizeFolder(req.From)
	to := normalizeFolder(req.To)
	if from == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "from is required"})
		return
	}
	if to == from {
		c.JSON(http.StatusOK, gin.H{"path": to, "notesUpdated": 0})
		return
	}
	if to != "" && strings.HasPrefix(to+"/", from+"/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot move a folder inside itself"})
		return
	}

	moved, err := moveFolder(h.DB, userID, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": to, "notesUpdated": moved})
}

// DELETE /api/folders?path= — keep the notes, move them back to the root
func (h *NotesHandlers) DeleteFolder(c *gin.Context) {
	userID := getUserID(c)

	path := normalizeFolder(c.Query("path"))
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}

	// Everything under the folder goes back to the root rather than keeping a
	// half-path: "delete Work" should not leave a stray "Projects" behind.
	res, err := h.DB.Exec(
		`UPDATE notes SET folder = '' WHERE user_id = ? AND (folder = ? OR folder LIKE ?)`,
		userID, path, path+"/%")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	moved, _ := res.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"notesUpdated": moved})
}
