package main

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const dailyDateLayout = "2006-01-02"

type templateDTO struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Tags      string `json:"tags"`
	Folder    string `json:"folder"`
	IsDaily   bool   `json:"isDaily"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type templateReq struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Tags    string `json:"tags"`
	Folder  string `json:"folder"`
	IsDaily bool   `json:"isDaily"`
}

// expandTemplate substitutes the placeholders a template may contain. The date
// comes from the caller so a daily note gets the user's local day rather than
// the server's UTC one.
func expandTemplate(text string, date time.Time, title string) string {
	replacements := []string{
		"{{date}}", date.Format(dailyDateLayout),
		"{{time}}", date.Format("15:04"),
		"{{datetime}}", date.Format("2006-01-02 15:04"),
		"{{weekday}}", date.Format("Monday"),
		"{{month}}", date.Format("January"),
		"{{year}}", date.Format("2006"),
		"{{title}}", title,
	}
	return strings.NewReplacer(replacements...).Replace(text)
}

// GET /api/templates
func (h *NotesHandlers) ListTemplates(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(`
		SELECT id, name, title, content, tags, folder, is_daily, created_at, updated_at
		FROM templates WHERE user_id = ? ORDER BY name`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	out := []templateDTO{}
	for rows.Next() {
		var t templateDTO
		var isDaily int
		if err := rows.Scan(&t.ID, &t.Name, &t.Title, &t.Content, &t.Tags, &t.Folder, &isDaily, &t.CreatedAt, &t.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		t.IsDaily = isDaily == 1
		out = append(out, t)
	}
	c.JSON(http.StatusOK, out)
}

// clearOtherDailyTemplates keeps at most one template flagged as the daily one.
func clearOtherDailyTemplates(ex execer, userID, keepID int64) error {
	_, err := ex.Exec(`UPDATE templates SET is_daily = 0 WHERE user_id = ? AND id != ?`, userID, keepID)
	return err
}

// POST /api/templates
func (h *NotesHandlers) CreateTemplate(c *gin.Context) {
	userID := getUserID(c)

	var req templateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	now := nowRFC3339()
	res, err := h.DB.Exec(`
		INSERT INTO templates(user_id, name, title, content, tags, folder, is_daily, created_at, updated_at)
		VALUES(?,?,?,?,?,?,?,?,?)`,
		userID, name, req.Title, req.Content, strings.Join(normalizeTags(req.Tags), ","),
		normalizeFolder(req.Folder), boolToInt(req.IsDaily), now, now)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a template with that name already exists"})
		return
	}
	id, _ := res.LastInsertId()

	if req.IsDaily {
		if err := clearOtherDailyTemplates(h.DB, userID, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// PUT /api/templates/:id
func (h *NotesHandlers) UpdateTemplate(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var req templateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad json"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	res, err := h.DB.Exec(`
		UPDATE templates SET name=?, title=?, content=?, tags=?, folder=?, is_daily=?, updated_at=?
		WHERE id=? AND user_id=?`,
		name, req.Title, req.Content, strings.Join(normalizeTags(req.Tags), ","),
		normalizeFolder(req.Folder), boolToInt(req.IsDaily), nowRFC3339(), id, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a template with that name already exists"})
		return
	}
	if aff, _ := res.RowsAffected(); aff == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if req.IsDaily {
		if err := clearOtherDailyTemplates(h.DB, userID, id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
	}
	c.Status(http.StatusNoContent)
}

// DELETE /api/templates/:id
func (h *NotesHandlers) DeleteTemplate(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	res, err := h.DB.Exec(`DELETE FROM templates WHERE id=? AND user_id=?`, id, userID)
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

// POST /api/templates/:id/apply — create a note from a template
func (h *NotesHandlers) ApplyTemplate(c *gin.Context) {
	userID := getUserID(c)
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)

	var req struct {
		Title string `json:"title"`
		Date  string `json:"date"`
	}
	_ = c.ShouldBindJSON(&req)

	tpl, err := loadTemplate(h.DB, userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	when := parseClientDate(req.Date)
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = expandTemplate(tpl.Title, when, tpl.Name)
	}
	if strings.TrimSpace(title) == "" {
		title = tpl.Name
	}

	noteID, err := h.createNote(userID, noteUpsertReq{
		Title:   title,
		Content: expandTemplate(tpl.Content, when, title),
		Tags:    tpl.Tags,
		Folder:  tpl.Folder,
	}, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": noteID})
}

func loadTemplate(db *sql.DB, userID, id int64) (templateDTO, error) {
	var t templateDTO
	var isDaily int
	err := db.QueryRow(`
		SELECT id, name, title, content, tags, folder, is_daily, created_at, updated_at
		FROM templates WHERE id = ? AND user_id = ?`, id, userID).
		Scan(&t.ID, &t.Name, &t.Title, &t.Content, &t.Tags, &t.Folder, &isDaily, &t.CreatedAt, &t.UpdatedAt)
	t.IsDaily = isDaily == 1
	return t, err
}

func dailyTemplate(db *sql.DB, userID int64) (templateDTO, bool) {
	var t templateDTO
	var isDaily int
	err := db.QueryRow(`
		SELECT id, name, title, content, tags, folder, is_daily, created_at, updated_at
		FROM templates WHERE user_id = ? AND is_daily = 1 LIMIT 1`, userID).
		Scan(&t.ID, &t.Name, &t.Title, &t.Content, &t.Tags, &t.Folder, &isDaily, &t.CreatedAt, &t.UpdatedAt)
	return t, err == nil
}

// parseClientDate reads a YYYY-MM-DD sent by the client, falling back to the
// server's current UTC day.
func parseClientDate(value string) time.Time {
	if t, err := time.Parse(dailyDateLayout, strings.TrimSpace(value)); err == nil {
		return t
	}
	return time.Now().UTC()
}

// GET /api/notes/daily?date= — the journal entry for a day, if it exists
func (h *NotesHandlers) GetDailyNote(c *gin.Context) {
	userID := getUserID(c)
	date := parseClientDate(c.Query("date")).Format(dailyDateLayout)

	var id int64
	if err := h.DB.QueryRow(
		`SELECT id FROM notes WHERE user_id=? AND daily_date=? AND deleted_at IS NULL`,
		userID, date).Scan(&id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no note for that day", "date": date})
		return
	}

	note, err := h.loadNote(userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, note)
}

// POST /api/notes/daily — open today's journal entry, creating it if needed
func (h *NotesHandlers) OpenDailyNote(c *gin.Context) {
	userID := getUserID(c)

	var req struct {
		Date string `json:"date"`
	}
	_ = c.ShouldBindJSON(&req)

	when := parseClientDate(req.Date)
	date := when.Format(dailyDateLayout)

	var existing int64
	if err := h.DB.QueryRow(
		`SELECT id FROM notes WHERE user_id=? AND daily_date=? AND deleted_at IS NULL`,
		userID, date).Scan(&existing); err == nil {
		c.JSON(http.StatusOK, gin.H{"id": existing, "created": false, "date": date})
		return
	}

	req2 := noteUpsertReq{Title: date}
	if tpl, ok := dailyTemplate(h.DB, userID); ok {
		title := strings.TrimSpace(expandTemplate(tpl.Title, when, date))
		if title == "" {
			title = date
		}
		req2 = noteUpsertReq{
			Title:   title,
			Content: expandTemplate(tpl.Content, when, title),
			Tags:    tpl.Tags,
			Folder:  tpl.Folder,
		}
	}

	id, err := h.createNote(userID, req2, date)
	if err != nil {
		// A concurrent request may have created the same day first.
		var raced int64
		if e := h.DB.QueryRow(
			`SELECT id FROM notes WHERE user_id=? AND daily_date=? AND deleted_at IS NULL`,
			userID, date).Scan(&raced); e == nil {
			c.JSON(http.StatusOK, gin.H{"id": raced, "created": false, "date": date})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "created": true, "date": date})
}

// GET /api/notes/daily/list — the days that already have an entry
func (h *NotesHandlers) ListDailyNotes(c *gin.Context) {
	userID := getUserID(c)

	rows, err := h.DB.Query(`
		SELECT id, daily_date, title FROM notes
		WHERE user_id=? AND daily_date IS NOT NULL AND deleted_at IS NULL
		ORDER BY daily_date DESC LIMIT 400`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer rows.Close()

	type entry struct {
		ID    int64  `json:"id"`
		Date  string `json:"date"`
		Title string `json:"title"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.ID, &e.Date, &e.Title); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		out = append(out, e)
	}
	c.JSON(http.StatusOK, out)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
