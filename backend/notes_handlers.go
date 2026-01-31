package main

import (
	"database/sql"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type NotesHandlers struct {
	DB *sql.DB
}

func NewNotesHandlers(db *sql.DB) *NotesHandlers {
	return &NotesHandlers{DB: db}
}

type noteDTO struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	ShareURL  string `json:"shareUrl,omitempty"`
}

type noteUpsertReq struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

func (h *NotesHandlers) List(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(`SELECT id, title, content, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	out := []noteDTO{}
	for rows.Next() {
		var n noteDTO
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
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

	now := nowRFC3339()
	res, err := h.DB.Exec(
		`INSERT INTO notes(user_id, title, content, created_at, updated_at) VALUES(?,?,?,?,?)`,
		userID, req.Title, req.Content, now, now,
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
	err := h.DB.QueryRow(
		`SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ? AND user_id = ?`,
		id, userID,
	).Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// include share URL if enabled
	var token string
	var enabled int
	err = h.DB.QueryRow(`SELECT token, is_enabled FROM share_links WHERE note_id = ?`, n.ID).Scan(&token, &enabled)
	if err == nil && enabled == 1 {
		n.ShareURL = "/share/" + token
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

	res, err := h.DB.Exec(
		`UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		req.Title, req.Content, nowRFC3339(), id, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *NotesHandlers) Delete(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	res, err := h.DB.Exec(`DELETE FROM notes WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	c.Status(http.StatusNoContent)
}

// POST /api/notes/:id/share
func (h *NotesHandlers) CreateOrEnableShare(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	// verify ownership
	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id = ? AND user_id = ?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// existing link?
	var token string
	err := h.DB.QueryRow(`SELECT token FROM share_links WHERE note_id = ?`, noteID).Scan(&token)
	if err == nil {
		_, _ = h.DB.Exec(`UPDATE share_links SET is_enabled = 1 WHERE note_id = ?`, noteID)
	} else {
		token, err = randomTokenURLSafe(24)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token error"})
			return
		}
		_, err = h.DB.Exec(
			`INSERT INTO share_links(note_id, token, is_enabled, created_at) VALUES(?,?,1,?)`,
			noteID, token, nowRFC3339(),
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"token":    token,
		"shareUrl": "/share/" + token,
	})
}

// POST /api/notes/:id/share/disable
func (h *NotesHandlers) DisableShare(c *gin.Context) {
	userID := getUserID(c)
	noteID, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var dummy int64
	if err := h.DB.QueryRow(`SELECT id FROM notes WHERE id = ? AND user_id = ?`, noteID, userID).Scan(&dummy); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	_, _ = h.DB.Exec(`UPDATE share_links SET is_enabled = 0 WHERE note_id = ?`, noteID)
	c.Status(http.StatusNoContent)
}

// GET /api/share/:token (public)
func (h *NotesHandlers) GetShared(c *gin.Context) {
	token := c.Param("token")

	var noteID int64
	var enabled int
	err := h.DB.QueryRow(`SELECT note_id, is_enabled FROM share_links WHERE token = ?`, token).Scan(&noteID, &enabled)
	if err != nil || enabled != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	var n noteDTO
	err = h.DB.QueryRow(`SELECT id, title, content, created_at, updated_at FROM notes WHERE id = ?`, noteID).
		Scan(&n.ID, &n.Title, &n.Content, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	c.JSON(http.StatusOK, n)
}
