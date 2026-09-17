package main

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

func TestNormalizeFolder(t *testing.T) {
	cases := map[string]string{
		"":                    "",
		"/Work/":              "Work",
		" Work / Projects ":   "Work/Projects",
		"Work//Projects":      "Work/Projects",
		"../../etc":           "etc",
		"Work/./Projects":     "Work/Projects",
		"a/b/c/d/e/f/g/h/i/j": "a/b/c/d/e/f/g/h",
	}
	for in, want := range cases {
		if got := normalizeFolder(in); got != want {
			t.Errorf("normalizeFolder(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFolderAncestors(t *testing.T) {
	got := folderAncestors("a/b/c")
	if len(got) != 2 || got[0] != "a" || got[1] != "a/b" {
		t.Errorf("folderAncestors = %v", got)
	}
	if len(folderAncestors("a")) != 0 {
		t.Error("a top-level folder has no ancestors")
	}
}

func (e *testEnv) createNoteIn(cookie *http.Cookie, title, folder string) int64 {
	e.t.Helper()

	var out struct {
		ID int64 `json:"id"`
	}
	e.do(http.MethodPost, "/api/notes",
		gin.H{"title": title, "content": "x", "folder": folder}, cookie).
		expect(http.StatusCreated).decode(&out)
	return out.ID
}

func TestFolderTreeCountsIncludeNesting(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("folders@example.com")

	env.createNoteIn(cookie, "A", "Work")
	env.createNoteIn(cookie, "B", "Work/Projects")
	env.createNoteIn(cookie, "C", "Work/Projects")
	env.createNoteIn(cookie, "D", "")

	var folders []folderDTO
	env.do(http.MethodGet, "/api/folders", nil, cookie).expect(http.StatusOK).decode(&folders)

	got := map[string]folderDTO{}
	for _, f := range folders {
		got[f.Path] = f
	}
	if got["Work"].Count != 1 || got["Work"].Total != 3 {
		t.Errorf("Work = %+v, want count 1 / total 3", got["Work"])
	}
	if got["Work/Projects"].Count != 2 {
		t.Errorf("Work/Projects = %+v", got["Work/Projects"])
	}
	if _, ok := got[""]; ok {
		t.Error("the root should not appear as a folder")
	}
}

func TestListFilteredByFolder(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("folderfilter@example.com")

	env.createNoteIn(cookie, "Root note", "")
	env.createNoteIn(cookie, "Work note", "Work")
	env.createNoteIn(cookie, "Nested", "Work/Projects")

	if got := env.listNotes(cookie, "?folder=Work"); len(got) != 1 || got[0].Title != "Work note" {
		t.Errorf("folder filter = %+v", got)
	}
	if got := env.listNotes(cookie, "?folder=Work&recursive=1"); len(got) != 2 {
		t.Errorf("recursive filter returned %d notes, want 2", len(got))
	}
	if got := env.listNotes(cookie, "?folder="); len(got) != 1 || got[0].Title != "Root note" {
		t.Errorf("root filter = %+v", got)
	}
}

func TestRenameFolderMovesSubtree(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("renamefolder@example.com")

	top := env.createNoteIn(cookie, "A", "Work")
	nested := env.createNoteIn(cookie, "B", "Work/Projects")
	other := env.createNoteIn(cookie, "C", "Personal")

	env.do(http.MethodPut, "/api/folders", gin.H{"from": "Work", "to": "Job"}, cookie).
		expect(http.StatusOK)

	if got := env.getNote(cookie, top).Folder; got != "Job" {
		t.Errorf("folder = %q, want Job", got)
	}
	if got := env.getNote(cookie, nested).Folder; got != "Job/Projects" {
		t.Errorf("nested folder = %q, want Job/Projects", got)
	}
	if got := env.getNote(cookie, other).Folder; got != "Personal" {
		t.Errorf("unrelated note moved: %q", got)
	}
}

func TestRenameFolderIntoItselfIsRejected(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("selfmove@example.com")
	env.createNoteIn(cookie, "A", "Work")

	env.do(http.MethodPut, "/api/folders", gin.H{"from": "Work", "to": "Work/Sub"}, cookie).
		expect(http.StatusBadRequest)
}

func TestDeleteFolderKeepsNotes(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("delfolder@example.com")

	id := env.createNoteIn(cookie, "A", "Work/Projects")
	env.do(http.MethodDelete, "/api/folders?path=Work", nil, cookie).expect(http.StatusOK)

	note := env.getNote(cookie, id)
	if note.Folder != "" {
		t.Errorf("folder = %q, want the note moved to the root", note.Folder)
	}
	if note.Title != "A" {
		t.Error("deleting a folder must not delete its notes")
	}
}

func TestFoldersAreScopedPerUser(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("alice-folders@example.com")
	_, bob := env.user("bob-folders@example.com")

	env.createNoteIn(alice, "A", "Shared")
	bobNote := env.createNoteIn(bob, "B", "Shared")

	env.do(http.MethodPut, "/api/folders", gin.H{"from": "Shared", "to": "Mine"}, alice).
		expect(http.StatusOK)

	if got := env.getNote(bob, bobNote).Folder; got != "Shared" {
		t.Errorf("another user's folder was renamed: %q", got)
	}
}

// A path longer than the limit is cut to length. Counting bytes rather than
// runes splits a multi-byte character in half, and the invalid UTF-8 that
// leaves behind is replaced with U+FFFD on the way out — so the path the API
// reports no longer matches the one in the database and the folder becomes
// unreachable.
func TestNormalizeFolderTruncatesOnCharacterBoundaries(t *testing.T) {
	cases := []struct{ name, in string }{
		{"three-byte runes", strings.Repeat("あ", 70)},
		{"two-byte runes", strings.Repeat("ф", 150)},
		{"four-byte runes", strings.Repeat("😀", 80)},
		{"mixed", strings.Repeat("aあ", 120)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeFolder(tc.in)
			if !utf8.ValidString(got) {
				t.Fatalf("normalizeFolder produced invalid UTF-8: %q", got)
			}
			if strings.ContainsRune(got, utf8.RuneError) {
				t.Errorf("normalizeFolder left a replacement character in %q", got)
			}
			if n := utf8.RuneCountInString(got); n > folderMaxPathLength {
				t.Errorf("normalizeFolder kept %d runes, want at most %d", n, folderMaxPathLength)
			}
			if got == "" {
				t.Error("a long path should be shortened, not dropped")
			}
		})
	}
}

// The folder a note reports must be the one it can be filtered by; a truncated
// path that round-trips through JSON as U+FFFD silently matches nothing.
func TestLongUnicodeFolderStaysFilterable(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("utf8folder@example.com")

	env.createNoteIn(cookie, "Deep", strings.Repeat("あ", 70))

	var notes []noteDTO
	env.do(http.MethodGet, "/api/notes", nil, cookie).expect(http.StatusOK).decode(&notes)
	if len(notes) != 1 {
		t.Fatalf("expected the note back, got %d", len(notes))
	}
	folder := notes[0].Folder
	if strings.ContainsRune(folder, utf8.RuneError) {
		t.Fatalf("stored folder came back mangled: %q", folder)
	}

	filtered := env.listNotes(cookie, "?folder="+url.QueryEscape(folder))
	if len(filtered) != 1 {
		t.Errorf("filtering by the folder the API reports returned %d notes, want 1", len(filtered))
	}
}
