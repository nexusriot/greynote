package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", path+"?_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	if err := migrate(db); err != nil {
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			is_admin INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			token TEXT NOT NULL UNIQUE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS share_links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			note_id INTEGER NOT NULL UNIQUE,
			token TEXT NOT NULL UNIQUE,
			is_enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS note_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			note_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			tags TEXT NOT NULL DEFAULT '',
			saved_at TEXT NOT NULL,
			FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL,
			UNIQUE(user_id, name),
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS note_tags (
			note_id INTEGER NOT NULL,
			tag_id INTEGER NOT NULL,
			position INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY(note_id, tag_id),
			FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
			FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS note_links (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id INTEGER NOT NULL,
			target_id INTEGER,
			target_title TEXT NOT NULL,
			position INTEGER NOT NULL DEFAULT 0,
			UNIQUE(source_id, target_title),
			FOREIGN KEY(source_id) REFERENCES notes(id) ON DELETE CASCADE,
			FOREIGN KEY(target_id) REFERENCES notes(id) ON DELETE SET NULL
		);`,
	}
	for _, s := range tables {
		if _, err := db.Exec(s); err != nil {
			return err
		}
	}

	// Additive migrations: add columns to existing tables without breaking old data.
	// SQLite does not support ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check PRAGMA first.
	type colDef struct{ table, col, def string }
	for _, c := range []colDef{
		{"notes", "tags", "TEXT NOT NULL DEFAULT ''"},
		{"notes", "is_pinned", "INTEGER NOT NULL DEFAULT 0"},
		{"notes", "deleted_at", "TEXT"},
		{"share_links", "password_hash", "TEXT"},
		{"share_links", "expires_at", "TEXT"},
	} {
		if err := addColumnIfMissing(db, c.table, c.col, c.def); err != nil {
			return err
		}
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_notes_user_live ON notes(user_id, deleted_at, is_pinned, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_notes_user_title ON notes(user_id, title)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
		`CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token)`,
		`CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, saved_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id)`,
		`CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_id)`,
		`CREATE INDEX IF NOT EXISTS idx_note_links_title ON note_links(target_title)`,
	}
	for _, s := range indexes {
		if _, err := db.Exec(s); err != nil {
			return err
		}
	}

	if err := backfillTags(db); err != nil {
		return err
	}
	return backfillLinks(db)
}

func addColumnIfMissing(db *sql.DB, table, col, def string) error {
	rows, err := db.Query(`PRAGMA table_info("` + table + `")`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var name, colType string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			return err
		}
		if name == col {
			return nil
		}
	}
	_, err = db.Exec(`ALTER TABLE "` + table + `" ADD COLUMN ` + col + ` ` + def)
	return err
}

// backfillTags populates the tags/note_tags join tables from the legacy
// comma-separated notes.tags column. It only runs for notes that have tags in
// the string column but no rows in note_tags, so it is safe to re-run.
func backfillTags(db *sql.DB) error {
	rows, err := db.Query(`
		SELECT n.id, n.user_id, n.tags FROM notes n
		WHERE n.tags != '' AND NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)`)
	if err != nil {
		return err
	}
	type pending struct {
		noteID int64
		userID int64
		tags   string
	}
	todo := []pending{}
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.noteID, &p.userID, &p.tags); err != nil {
			rows.Close()
			return err
		}
		todo = append(todo, p)
	}
	rows.Close()

	for _, p := range todo {
		if _, err := setNoteTags(db, p.userID, p.noteID, p.tags); err != nil {
			return err
		}
	}
	return nil
}

// backfillLinks indexes [[wiki links]] for notes saved before link tracking
// existed. Notes that already have link rows are left alone.
func backfillLinks(db *sql.DB) error {
	rows, err := db.Query(`
		SELECT n.id, n.user_id, n.content FROM notes n
		WHERE n.content LIKE '%[[%' AND NOT EXISTS (SELECT 1 FROM note_links l WHERE l.source_id = n.id)`)
	if err != nil {
		return err
	}
	type pending struct {
		noteID  int64
		userID  int64
		content string
	}
	todo := []pending{}
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.noteID, &p.userID, &p.content); err != nil {
			rows.Close()
			return err
		}
		todo = append(todo, p)
	}
	rows.Close()

	users := map[int64]bool{}
	for _, p := range todo {
		if err := setNoteLinks(db, p.noteID, p.content); err != nil {
			return err
		}
		users[p.userID] = true
	}
	for userID := range users {
		if err := resolveUserLinks(db, userID); err != nil {
			return err
		}
	}
	return nil
}

// rfc3339Millis keeps timestamps RFC3339-valid while giving note versions
// millisecond resolution — second resolution was too coarse to tell two quick
// saves apart, which optimistic concurrency depends on.
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

func nowRFC3339() string {
	return formatRFC3339(time.Now())
}

func formatRFC3339(t time.Time) string {
	return t.UTC().Format(rfc3339Millis)
}

// nextVersionStamp returns a timestamp strictly different from prev, so every
// save of a note gets its own version identifier.
func nextVersionStamp(prev string) string {
	now := nowRFC3339()
	if now != prev {
		return now
	}
	if t, err := time.Parse(time.RFC3339, prev); err == nil {
		return formatRFC3339(t.Add(time.Millisecond))
	}
	return now
}

func randomTokenURLSafe(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// execer is satisfied by both *sql.DB and *sql.Tx so helpers can run inside or
// outside a transaction.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

// snippetOf flattens a note body into a short preview. It counts runes, not
// bytes, so a truncated snippet never cuts a character in half.
func snippetOf(content string, max int) string {
	s := strings.TrimSpace(strings.ReplaceAll(content, "\n", " "))
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return strings.TrimSpace(string(runes[:max])) + "…"
}

var ErrNotFound = errors.New("not found")
