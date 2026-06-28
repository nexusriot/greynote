package main

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type NotesHandlers struct {
	DB *sql.DB
}

func NewNotesHandlers(db *sql.DB) *NotesHandlers {
	return &NotesHandlers{DB: db}
}

type noteDTO struct {
	ID               int64  `json:"id"`
	Title            string `json:"title"`
	Content          string `json:"content"`
	Tags             string `json:"tags"`
	IsPinned         bool   `json:"isPinned"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
	ShareURL         string `json:"shareUrl,omitempty"`
	SharePasswordSet bool   `json:"sharePasswordSet,omitempty"`
	ShareExpiresAt   string `json:"shareExpiresAt,omitempty"`
}

type noteUpsertReq struct {
	Title    string `json:"title"`
	Content  string `json:"content"`
	Tags     string `json:"tags"`
	IsPinned bool   `json:"isPinned"`
}

type noteVersionDTO struct {
	ID      int64  `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Tags    string `json:"tags"`
	SavedAt string `json:"savedAt"`
}

func (h *NotesHandlers) List(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(
		`SELECT id, title, content, tags, is_pinned, created_at, updated_at
		 FROM notes WHERE user_id = ?
		 ORDER BY is_pinned DESC, updated_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	out := []noteDTO{}
	for rows.Next() {
		var n noteDTO
		var isPinned int
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.Tags, &isPinned, &n.CreatedAt, &n.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		n.IsPinned = isPinned == 1
		out = append(out, n)
	}

	c.JSON(http.StatusOK, out)
}

func (h *NotesHandlers) Create(c *gin.Context) {
	userID := getUserID(c)

	var req noteUpsertReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}

	isPinned := 0
	if req.IsPinned {
		isPinned = 1
	}
	now := nowRFC3339()
	res, err := h.DB.Exec(
		`INSERT INTO notes(user_id, title, content, tags, is_pinned, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`,
		userID, req.Title, req.Content, req.Tags, isPinned, now, now,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *NotesHandlers) Get(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var n noteDTO
	var isPinned int
	err := h.DB.QueryRow(
		`SELECT id, title, content, tags, is_pinned, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?`,
		id, userID,
	).Scan(&n.ID, &n.Title, &n.Content, &n.Tags, &isPinned, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	n.IsPinned = isPinned == 1

	var token string
	var enabled int
	var passwordHash, expiresAt sql.NullString
	if err := h.DB.QueryRow(
		`SELECT token, is_enabled, password_hash, expires_at FROM share_links WHERE note_id = ?`, n.ID,
	).Scan(&token, &enabled, &passwordHash, &expiresAt); err == nil && enabled == 1 {
		n.ShareURL = "/share/" + token
		n.SharePasswordSet = passwordHash.Valid && passwordHash.String != ""
		if expiresAt.Valid {
			n.ShareExpiresAt = expiresAt.String
		}
	}

	c.JSON(http.StatusOK, n)
}

func (h *NotesHandlers) Update(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var req noteUpsertReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}

	// Snapshot current state as a version before overwriting.
	var oldTitle, oldContent, oldTags, oldUpdatedAt string
	if err := h.DB.QueryRow(
		`SELECT title, content, tags, updated_at FROM notes WHERE id = ? AND user_id = ?`,
		id, userID,
	).Scan(&oldTitle, &oldContent, &oldTags, &oldUpdatedAt); err == nil {
		_, _ = h.DB.Exec(
			`INSERT INTO note_versions(note_id, title, content, tags, saved_at) VALUES(?,?,?,?,?)`,
			id, oldTitle, oldContent, oldTags, oldUpdatedAt,
		)
	}

	isPinned := 0
	if req.IsPinned {
		isPinned = 1
	}
	res, err := h.DB.Exec(
		`UPDATE notes SET title=?, content=?, tags=?, is_pinned=?, updated_at=? WHERE id=? AND user_id=?`,
		req.Title, req.Content, req.Tags, isPinned, nowRFC3339(), id, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *NotesHandlers) Delete(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	res, err := h.DB.Exec(`DELETE FROM notes WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.Status(http.StatusNoContent)
}

// POST /api/notes/:id/pin — toggles is_pinned
func (h *NotesHandlers) TogglePin(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var current int
	if err := h.DB.QueryRow(`SELECT is_pinned FROM notes WHERE id=? AND user_id=?`, id, userID).Scan(&current); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	next := 1 - current
	_, _ = h.DB.Exec(`UPDATE notes SET is_pinned=? WHERE id=?`, next, id)
	c.JSON(http.StatusOK, gin.H{"isPinned": next == 1})
}

// GET /api/notes/:id/versions
func (h *NotesHandlers) ListVersions(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id=? AND user_id=?`, id, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	rows, err := h.DB.Query(
		`SELECT id, title, saved_at FROM note_versions WHERE note_id=? ORDER BY saved_at DESC LIMIT 50`,
		id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	type item struct {
		ID      int64  `json:"id"`
		Title   string `json:"title"`
		SavedAt string `json:"savedAt"`
	}
	out := []item{}
	for rows.Next() {
		var v item
		if err := rows.Scan(&v.ID, &v.Title, &v.SavedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		out = append(out, v)
	}
	c.JSON(http.StatusOK, out)
}

// GET /api/notes/:id/versions/:vid
func (h *NotesHandlers) GetVersion(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	versionID, _ := strconv.ParseInt(c.Param("vid"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id=? AND user_id=?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var v noteVersionDTO
	if err := h.DB.QueryRow(
		`SELECT id, title, content, tags, saved_at FROM note_versions WHERE id=? AND note_id=?`,
		versionID, noteID,
	).Scan(&v.ID, &v.Title, &v.Content, &v.Tags, &v.SavedAt); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, v)
}

// POST /api/notes/:id/share
func (h *NotesHandlers) CreateOrEnableShare(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id=? AND user_id=?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req struct {
		ExpiresAt string `json:"expiresAt"`
	}
	_ = c.ShouldBindJSON(&req)

	var expiresAt sql.NullString
	if req.ExpiresAt != "" {
		if _, err := time.Parse(time.RFC3339, req.ExpiresAt); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid expiresAt, use RFC3339"})
			return
		}
		expiresAt = sql.NullString{String: req.ExpiresAt, Valid: true}
	}

	var token string
	err := h.DB.QueryRow(`SELECT token FROM share_links WHERE note_id=?`, noteID).Scan(&token)
	if err == nil {
		_, _ = h.DB.Exec(`UPDATE share_links SET is_enabled=1, expires_at=? WHERE note_id=?`, expiresAt, noteID)
	} else {
		token, err = randomTokenURLSafe(24)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token error"})
			return
		}
		if _, err = h.DB.Exec(
			`INSERT INTO share_links(note_id, token, is_enabled, created_at, expires_at) VALUES(?,?,1,?,?)`,
			noteID, token, nowRFC3339(), expiresAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"token": token, "shareUrl": "/share/" + token})
}

// POST /api/notes/:id/share/disable
func (h *NotesHandlers) DisableShare(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id=? AND user_id=?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	_, _ = h.DB.Exec(`UPDATE share_links SET is_enabled=0 WHERE note_id=?`, noteID)
	c.Status(http.StatusNoContent)
}

// PUT /api/notes/:id/share/password — sets or clears the share link password
func (h *NotesHandlers) SetSharePassword(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id=? AND user_id=?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}

	if strings.TrimSpace(req.Password) == "" {
		_, _ = h.DB.Exec(`UPDATE share_links SET password_hash=NULL WHERE note_id=?`, noteID)
	} else {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "hash error"})
			return
		}
		_, _ = h.DB.Exec(`UPDATE share_links SET password_hash=? WHERE note_id=?`, string(hash), noteID)
	}
	c.Status(http.StatusNoContent)
}

// GET /api/notes/export — download all user notes as a zip of .md files
func (h *NotesHandlers) ExportZip(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(
		`SELECT title, content FROM notes WHERE user_id = ? ORDER BY updated_at DESC`, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="notes-export.zip"`)

	zw := zip.NewWriter(c.Writer)
	defer zw.Close()

	seen := map[string]int{}
	for rows.Next() {
		var title, content string
		if err := rows.Scan(&title, &content); err != nil {
			continue
		}

		base := sanitizeFilename(title)
		if base == "" {
			base = "untitled"
		}
		filename := base
		if n := seen[base]; n > 0 {
			filename = fmt.Sprintf("%s (%d)", base, n)
		}
		seen[base]++

		w, err := zw.Create(filename + ".md")
		if err != nil {
			continue
		}
		fmt.Fprintf(w, "# %s\n\n%s", title, content)
	}
}

func sanitizeFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\n', '\r', '\t':
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	if len(out) > 100 {
		out = out[:100]
	}
	return out
}

// GET /api/share/:token  (public)
func (h *NotesHandlers) GetShared(c *gin.Context) {
	token := c.Param("token")

	var noteID int64
	var enabled int
	var passwordHash, shareExpiresAt sql.NullString
	if err := h.DB.QueryRow(
		`SELECT note_id, is_enabled, password_hash, expires_at FROM share_links WHERE token=?`, token,
	).Scan(&noteID, &enabled, &passwordHash, &shareExpiresAt); err != nil || enabled != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if shareExpiresAt.Valid && shareExpiresAt.String != "" {
		if exp, err := time.Parse(time.RFC3339, shareExpiresAt.String); err == nil && time.Now().UTC().After(exp) {
			c.JSON(http.StatusGone, gin.H{"error": "this share link has expired"})
			return
		}
	}

	if passwordHash.Valid && passwordHash.String != "" {
		provided := c.GetHeader("X-Share-Password")
		if provided == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"requiresPassword": true})
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(provided)) != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "wrong password"})
			return
		}
	}

	var n noteDTO
	var isPinned int
	if err := h.DB.QueryRow(
		`SELECT id, title, content, tags, is_pinned, created_at, updated_at FROM notes WHERE id=?`, noteID,
	).Scan(&n.ID, &n.Title, &n.Content, &n.Tags, &isPinned, &n.CreatedAt, &n.UpdatedAt); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	n.IsPinned = isPinned == 1
	c.JSON(http.StatusOK, n)
}

// PUT /api/notes/:id/share/expiry — sets or clears the share link expiry
func (h *NotesHandlers) SetShareExpiry(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id=? AND user_id=?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var req struct {
		ExpiresAt string `json:"expiresAt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}

	var expiresAt sql.NullString
	if req.ExpiresAt != "" {
		if _, err := time.Parse(time.RFC3339, req.ExpiresAt); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid expiresAt, use RFC3339"})
			return
		}
		expiresAt = sql.NullString{String: req.ExpiresAt, Valid: true}
	}

	_, _ = h.DB.Exec(`UPDATE share_links SET expires_at=? WHERE note_id=?`, expiresAt, noteID)
	c.Status(http.StatusNoContent)
}

// GET /api/notes/stats
func (h *NotesHandlers) Stats(c *gin.Context) {
	userID := getUserID(c)

	var totalNotes int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM notes WHERE user_id=?`, userID).Scan(&totalNotes)

	contentRows, err := h.DB.Query(`SELECT content FROM notes WHERE user_id=?`, userID)
	totalWords := 0
	if err == nil {
		defer contentRows.Close()
		for contentRows.Next() {
			var content string
			if contentRows.Scan(&content) == nil {
				totalWords += len(strings.Fields(content))
			}
		}
	}

	tagRows, _ := h.DB.Query(`SELECT tags FROM notes WHERE user_id=? AND tags != ''`, userID)
	tagCounts := map[string]int{}
	if tagRows != nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var tags string
			if tagRows.Scan(&tags) == nil {
				for _, t := range strings.Split(tags, ",") {
					if t = strings.TrimSpace(t); t != "" {
						tagCounts[t]++
					}
				}
			}
		}
	}

	type tagCount struct {
		Tag   string `json:"tag"`
		Count int    `json:"count"`
	}
	topTags := make([]tagCount, 0, len(tagCounts))
	for t, n := range tagCounts {
		topTags = append(topTags, tagCount{t, n})
	}
	sort.Slice(topTags, func(i, j int) bool { return topTags[i].Count > topTags[j].Count })
	if len(topTags) > 20 {
		topTags = topTags[:20]
	}

	monthRows, _ := h.DB.Query(`
		SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS cnt
		FROM notes WHERE user_id=?
		GROUP BY month ORDER BY month ASC`, userID)
	type monthCount struct {
		Month string `json:"month"`
		Count int    `json:"count"`
	}
	notesPerMonth := []monthCount{}
	if monthRows != nil {
		defer monthRows.Close()
		for monthRows.Next() {
			var m monthCount
			if monthRows.Scan(&m.Month, &m.Count) == nil {
				notesPerMonth = append(notesPerMonth, m)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"totalNotes":    totalNotes,
		"totalWords":    totalWords,
		"topTags":       topTags,
		"notesPerMonth": notesPerMonth,
	})
}
