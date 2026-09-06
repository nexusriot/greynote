package main

import (
	"database/sql"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Highlight sentinels wrap matched terms inside snippets. They are control
// characters rather than HTML so clients can render matches without ever
// interpreting server output as markup.
const (
	HighlightStart = "\x01"
	HighlightEnd   = "\x02"
)

// ftsEnabled reports whether the SQLite driver was built with FTS5 support
// (build tag `sqlite_fts5`). Without it the app still works — search falls back
// to LIKE scanning, which is correct but slower and unranked.
var ftsEnabled bool

func initSearch(db *sql.DB) error {
	_, err := db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, content, tags, tokenize='unicode61')`)
	if err != nil {
		ftsEnabled = false
		return nil
	}
	ftsEnabled = true

	// Self-heal: rows whose note is gone or trashed (an older build could leave
	// them behind when a user was deleted) must not linger in the index.
	if _, err := db.Exec(`
		DELETE FROM notes_fts
		WHERE rowid NOT IN (SELECT id FROM notes WHERE deleted_at IS NULL)`); err != nil {
		return err
	}

	rows, err := db.Query(`
		SELECT id FROM notes
		WHERE deleted_at IS NULL AND id NOT IN (SELECT rowid FROM notes_fts)`)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()

	for _, id := range ids {
		if err := reindexNote(db, id); err != nil {
			return err
		}
	}
	return nil
}

// reindexNote refreshes the search index entry for one note. Trashed notes are
// removed from the index so they never surface in search results.
func reindexNote(ex execer, noteID int64) error {
	if !ftsEnabled {
		return nil
	}
	var title, content, tags string
	var deletedAt sql.NullString
	err := ex.QueryRow(`SELECT title, content, tags, deleted_at FROM notes WHERE id=?`, noteID).
		Scan(&title, &content, &tags, &deletedAt)
	if err != nil {
		return deindexNote(ex, noteID)
	}
	if _, err := ex.Exec(`DELETE FROM notes_fts WHERE rowid=?`, noteID); err != nil {
		return err
	}
	if deletedAt.Valid && deletedAt.String != "" {
		return nil
	}
	_, err = ex.Exec(`INSERT INTO notes_fts(rowid, title, content, tags) VALUES(?,?,?,?)`,
		noteID, title, content, tags)
	return err
}

// deindexUserNotes removes every note of one user from the search index. Used
// when an account is deleted: the notes rows go, but the FTS table has no
// foreign keys and would otherwise keep the note text.
func deindexUserNotes(ex execer, userID int64) error {
	if !ftsEnabled {
		return nil
	}
	_, err := ex.Exec(
		`DELETE FROM notes_fts WHERE rowid IN (SELECT id FROM notes WHERE user_id = ?)`, userID)
	return err
}

func deindexNote(ex execer, noteID int64) error {
	if !ftsEnabled {
		return nil
	}
	_, err := ex.Exec(`DELETE FROM notes_fts WHERE rowid=?`, noteID)
	return err
}

type searchHit struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Tags      string `json:"tags"`
	IsPinned  bool   `json:"isPinned"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	Snippet   string `json:"snippet"`
}

// searchTerms splits a user query into index-safe terms. FTS5 treats many
// punctuation characters as syntax, so anything that is not a letter or digit
// becomes a separator.
func searchTerms(q string) []string {
	fields := strings.FieldsFunc(q, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	terms := []string{}
	for _, f := range fields {
		if f = strings.TrimSpace(f); f != "" {
			terms = append(terms, strings.ToLower(f))
		}
	}
	return terms
}

// ftsQuery renders terms as a prefix-matching AND query: `foo bar` becomes
// `"foo"* "bar"*`.
func ftsQuery(terms []string) string {
	parts := make([]string, 0, len(terms))
	for _, t := range terms {
		parts = append(parts, `"`+t+`"*`)
	}
	return strings.Join(parts, " ")
}

func searchNotes(db *sql.DB, userID int64, q string, limit int) ([]searchHit, error) {
	terms := searchTerms(q)
	if len(terms) == 0 {
		return []searchHit{}, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if ftsEnabled {
		return searchNotesFTS(db, userID, terms, limit)
	}
	return searchNotesLike(db, userID, terms, limit)
}

func searchNotesFTS(db *sql.DB, userID int64, terms []string, limit int) ([]searchHit, error) {
	rows, err := db.Query(`
		SELECT notes.id, notes.title, notes.tags, notes.is_pinned, notes.created_at, notes.updated_at,
		       snippet(notes_fts, 1, ?, ?, '…', 14)
		FROM notes_fts JOIN notes ON notes.id = notes_fts.rowid
		WHERE notes_fts MATCH ? AND notes.user_id = ? AND notes.deleted_at IS NULL
		ORDER BY bm25(notes_fts, 10.0, 1.0, 5.0)
		LIMIT ?`,
		HighlightStart, HighlightEnd, ftsQuery(terms), userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []searchHit{}
	for rows.Next() {
		var h searchHit
		var isPinned int
		if err := rows.Scan(&h.ID, &h.Title, &h.Tags, &isPinned, &h.CreatedAt, &h.UpdatedAt, &h.Snippet); err != nil {
			return nil, err
		}
		h.IsPinned = isPinned == 1
		h.Snippet = strings.TrimSpace(strings.ReplaceAll(h.Snippet, "\n", " "))
		out = append(out, h)
	}
	return out, rows.Err()
}

func searchNotesLike(db *sql.DB, userID int64, terms []string, limit int) ([]searchHit, error) {
	where := []string{"user_id = ?", "deleted_at IS NULL"}
	args := []any{userID}
	for _, t := range terms {
		where = append(where, "(lower(title) LIKE ? OR lower(content) LIKE ? OR lower(tags) LIKE ?)")
		pat := "%" + t + "%"
		args = append(args, pat, pat, pat)
	}
	args = append(args, limit)

	rows, err := db.Query(`
		SELECT id, title, content, tags, is_pinned, created_at, updated_at
		FROM notes WHERE `+strings.Join(where, " AND ")+`
		ORDER BY is_pinned DESC, updated_at DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []searchHit{}
	for rows.Next() {
		var h searchHit
		var content string
		var isPinned int
		if err := rows.Scan(&h.ID, &h.Title, &content, &h.Tags, &isPinned, &h.CreatedAt, &h.UpdatedAt); err != nil {
			return nil, err
		}
		h.IsPinned = isPinned == 1
		h.Snippet = likeSnippet(content, terms)
		out = append(out, h)
	}
	return out, rows.Err()
}

// indexFold reports the byte offset of the first case-insensitive occurrence of
// sub in s, or -1. Lowercasing the haystack first would be simpler but unsafe:
// case folding can change a string's byte length (Ⱥ → ⱥ), and the shifted
// offsets then slice the original string out of bounds.
func indexFold(s, sub string) int {
	if sub == "" {
		return -1
	}
	for i := range s {
		if i+len(sub) > len(s) {
			break
		}
		if strings.EqualFold(s[i:i+len(sub)], sub) {
			return i
		}
	}
	return -1
}

// likeSnippet builds a highlighted excerpt around the first matching term,
// mirroring what FTS5's snippet() produces on the fast path.
func likeSnippet(content string, terms []string) string {
	flat := strings.TrimSpace(strings.ReplaceAll(content, "\n", " "))

	idx, matched := -1, ""
	for _, t := range terms {
		if i := indexFold(flat, t); i >= 0 && (idx < 0 || i < idx) {
			idx, matched = i, flat[i:i+len(t)]
		}
	}
	if idx < 0 {
		return snippetOf(flat, 160)
	}

	start := idx - 60
	prefix := ""
	if start > 0 {
		prefix = "…"
		// Never cut a multi-byte character in half.
		for start > 0 && !utf8.RuneStart(flat[start]) {
			start--
		}
	} else {
		start = 0
	}
	end := idx + len(matched) + 100
	suffix := ""
	if end < len(flat) {
		suffix = "…"
		for end < len(flat) && !utf8.RuneStart(flat[end]) {
			end++
		}
	} else {
		end = len(flat)
	}

	excerpt := flat[start:end]
	relative := idx - start
	return prefix + excerpt[:relative] + HighlightStart + excerpt[relative:relative+len(matched)] +
		HighlightEnd + excerpt[relative+len(matched):] + suffix
}
