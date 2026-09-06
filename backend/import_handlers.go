package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

const (
	importMaxUploadBytes = 20 * 1024 * 1024
	importMaxEntryBytes  = 2 * 1024 * 1024
	// A small archive can decompress to something enormous, and every parsed
	// note is held in memory until the transaction runs, so cap the totals too.
	importMaxTotalBytes = 64 * 1024 * 1024
	importMaxEntries    = 5000
)

// frontMatter is the YAML header GreyNote understands on imported markdown.
// Every field is optional; unknown keys are ignored.
type frontMatter struct {
	Title     string `yaml:"title"`
	Tags      any    `yaml:"tags"`
	Pinned    bool   `yaml:"pinned"`
	Created   string `yaml:"created"`
	CreatedAt string `yaml:"created_at"`
	Updated   string `yaml:"updated"`
	UpdatedAt string `yaml:"updated_at"`
}

type importedNote struct {
	Title     string
	Content   string
	Tags      string
	IsPinned  bool
	CreatedAt string
	UpdatedAt string
}

type importSkip struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

func isMarkdownName(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown", ".txt":
		return true
	}
	return false
}

// splitFrontMatter separates a leading `---` YAML block from the note body.
func splitFrontMatter(text string) (string, string) {
	text = strings.TrimPrefix(text, "\ufeff")
	if !strings.HasPrefix(text, "---\n") && !strings.HasPrefix(text, "---\r\n") {
		return "", text
	}
	rest := text[strings.Index(text, "\n")+1:]

	lines := strings.Split(rest, "\n")
	for i, line := range lines {
		if strings.TrimRight(line, "\r") == "---" || strings.TrimRight(line, "\r") == "..." {
			return strings.Join(lines[:i], "\n"), strings.Join(lines[i+1:], "\n")
		}
	}
	return "", text
}

// tagsFromFrontMatter accepts either `tags: a, b` or a YAML list of tags.
func tagsFromFrontMatter(v any) string {
	switch t := v.(type) {
	case string:
		return strings.Join(normalizeTags(t), ",")
	case []any:
		parts := []string{}
		for _, item := range t {
			parts = append(parts, fmt.Sprintf("%v", item))
		}
		return strings.Join(normalizeTags(strings.Join(parts, ",")), ",")
	default:
		return ""
	}
}

var importTimeLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
	"2006-01-02",
}

func parseImportTime(values ...string) string {
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		for _, layout := range importTimeLayouts {
			if t, err := time.Parse(layout, v); err == nil {
				return formatRFC3339(t)
			}
		}
	}
	return ""
}

// parseImportedNote turns one markdown file into a note. The title comes from
// front matter, else a leading `# heading` (which is then dropped so exports
// round-trip cleanly), else the file name.
func parseImportedNote(name, text string) (importedNote, error) {
	header, body := splitFrontMatter(text)

	var fm frontMatter
	if header != "" {
		if err := yaml.Unmarshal([]byte(header), &fm); err != nil {
			return importedNote{}, fmt.Errorf("invalid front matter: %w", err)
		}
	}

	body = strings.TrimLeft(body, "\n")
	title := strings.TrimSpace(fm.Title)
	if title == "" {
		if rest, heading, ok := takeLeadingHeading(body); ok {
			title, body = heading, rest
		}
	}
	if title == "" {
		title = strings.TrimSuffix(path.Base(name), filepath.Ext(name))
	}
	if strings.TrimSpace(title) == "" {
		title = "Untitled"
	}

	now := nowRFC3339()
	created := parseImportTime(fm.Created, fm.CreatedAt)
	if created == "" {
		created = now
	}
	updated := parseImportTime(fm.Updated, fm.UpdatedAt)
	if updated == "" {
		updated = created
	}

	return importedNote{
		Title:     strings.TrimSpace(title),
		Content:   strings.TrimRight(body, "\n"),
		Tags:      tagsFromFrontMatter(fm.Tags),
		IsPinned:  fm.Pinned,
		CreatedAt: created,
		UpdatedAt: updated,
	}, nil
}

// takeLeadingHeading pulls a leading `# Title` line off the body.
func takeLeadingHeading(body string) (rest, heading string, ok bool) {
	lines := strings.SplitN(body, "\n", 2)
	first := strings.TrimSpace(lines[0])
	if !strings.HasPrefix(first, "# ") {
		return body, "", false
	}
	heading = strings.TrimSpace(strings.TrimPrefix(first, "# "))
	if heading == "" {
		return body, "", false
	}
	if len(lines) == 1 {
		return "", heading, true
	}
	return strings.TrimLeft(lines[1], "\n"), heading, true
}

// collectImportEntries reads either a single markdown file or every markdown
// file inside a zip archive.
func collectImportEntries(filename string, data []byte) ([]importedNote, []importSkip, error) {
	if isMarkdownName(filename) {
		note, err := parseImportedNote(filename, string(data))
		if err != nil {
			return nil, []importSkip{{Name: filename, Reason: err.Error()}}, nil
		}
		return []importedNote{note}, nil, nil
	}
	if !strings.EqualFold(filepath.Ext(filename), ".zip") {
		return nil, nil, fmt.Errorf("unsupported file type — upload a .md file or a .zip of .md files")
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, fmt.Errorf("could not read zip archive")
	}

	notes := []importedNote{}
	skipped := []importSkip{}
	totalBytes := 0
	for _, f := range zr.File {
		name := f.Name
		if len(notes) >= importMaxEntries {
			skipped = append(skipped, importSkip{Name: name, Reason: "archive holds too many notes (max 5000)"})
			continue
		}
		if totalBytes >= importMaxTotalBytes {
			skipped = append(skipped, importSkip{Name: name, Reason: "archive contents exceed 64 MB"})
			continue
		}
		if f.FileInfo().IsDir() || strings.HasPrefix(name, "__MACOSX/") || strings.HasPrefix(path.Base(name), ".") {
			continue
		}
		if !isMarkdownName(name) {
			skipped = append(skipped, importSkip{Name: name, Reason: "not a markdown file"})
			continue
		}
		if f.UncompressedSize64 > importMaxEntryBytes {
			skipped = append(skipped, importSkip{Name: name, Reason: "file too large (max 2 MB)"})
			continue
		}

		rc, err := f.Open()
		if err != nil {
			skipped = append(skipped, importSkip{Name: name, Reason: "could not read entry"})
			continue
		}
		body, err := io.ReadAll(io.LimitReader(rc, importMaxEntryBytes+1))
		rc.Close()
		if err != nil {
			skipped = append(skipped, importSkip{Name: name, Reason: "could not read entry"})
			continue
		}
		if len(body) > importMaxEntryBytes {
			skipped = append(skipped, importSkip{Name: name, Reason: "file too large (max 2 MB)"})
			continue
		}
		totalBytes += len(body)

		note, err := parseImportedNote(name, string(body))
		if err != nil {
			skipped = append(skipped, importSkip{Name: name, Reason: err.Error()})
			continue
		}
		notes = append(notes, note)
	}
	return notes, skipped, nil
}

// insertImportedNotes writes parsed notes for a user, skipping ones that already
// exist verbatim so re-importing the same archive is a no-op.
func insertImportedNotes(db *sql.DB, userID int64, notes []importedNote) (int, []importSkip, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()

	imported := 0
	skipped := []importSkip{}
	for _, n := range notes {
		var existing int64
		err := tx.QueryRow(
			`SELECT id FROM notes WHERE user_id=? AND deleted_at IS NULL AND title=? AND content=?`,
			userID, n.Title, n.Content,
		).Scan(&existing)
		if err == nil {
			skipped = append(skipped, importSkip{Name: n.Title, Reason: "already imported"})
			continue
		}

		isPinned := 0
		if n.IsPinned {
			isPinned = 1
		}
		res, err := tx.Exec(
			`INSERT INTO notes(user_id, title, content, tags, is_pinned, created_at, updated_at)
			 VALUES(?,?,?,?,?,?,?)`,
			userID, n.Title, n.Content, "", isPinned, n.CreatedAt, n.UpdatedAt)
		if err != nil {
			return 0, nil, err
		}
		noteID, _ := res.LastInsertId()

		if _, err := setNoteTags(tx, userID, noteID, n.Tags); err != nil {
			return 0, nil, err
		}
		if err := setNoteLinks(tx, noteID, n.Content); err != nil {
			return 0, nil, err
		}
		// setNoteTags rewrites notes.tags, so reindex after both are stored.
		if err := reindexNote(tx, noteID); err != nil {
			return 0, nil, err
		}
		imported++
	}

	if err := resolveUserLinks(tx, userID); err != nil {
		return 0, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, err
	}
	return imported, skipped, nil
}

// POST /api/notes/import — import a .md file or a .zip archive of .md files
func (h *NotesHandlers) Import(c *gin.Context) {
	userID := getUserID(c)

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}
	defer file.Close()

	if header.Size > importMaxUploadBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 20 MB)"})
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, importMaxUploadBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "read error"})
		return
	}
	if len(data) > importMaxUploadBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 20 MB)"})
		return
	}

	notes, skipped, err := collectImportEntries(header.Filename, data)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	imported, dupes, err := insertImportedNotes(h.DB, userID, notes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	skipped = append(skipped, dupes...)

	c.JSON(http.StatusOK, gin.H{"imported": imported, "skipped": skipped})
}
