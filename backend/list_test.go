package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestListOmitsBodiesButCarriesSnippets(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("slim@example.com")

	body := strings.Repeat("long body text ", 100)
	env.createNote(cookie, "Big", body, "")

	notes := env.listNotes(cookie, "")
	if len(notes) != 1 {
		t.Fatalf("notes = %+v", notes)
	}
	if notes[0].Content != "" {
		t.Errorf("list should not ship the body, got %d chars", len(notes[0].Content))
	}
	if !strings.HasPrefix(notes[0].Snippet, "long body text") || len(notes[0].Snippet) > 250 {
		t.Errorf("snippet = %q", notes[0].Snippet)
	}

	full := env.listNotes(cookie, "?full=1")
	if full[0].Content != body {
		t.Error("?full=1 should still return the whole body")
	}
}

func TestListPagination(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("paged@example.com")

	for i := 0; i < 5; i++ {
		env.createNote(cookie, fmt.Sprintf("Note %d", i), "x", "")
	}

	res := env.do(http.MethodGet, "/api/notes?limit=2", nil, cookie).expect(http.StatusOK)
	var page []noteDTO
	res.decode(&page)
	if len(page) != 2 {
		t.Fatalf("limit=2 returned %d notes", len(page))
	}

	second := env.listNotes(cookie, "?limit=2&offset=2")
	if len(second) != 2 || second[0].ID == page[0].ID {
		t.Errorf("offset did not advance the window: %+v", second)
	}
	if got := env.listNotes(cookie, "?limit=2&offset=4"); len(got) != 1 {
		t.Errorf("last page returned %d notes, want 1", len(got))
	}
	if got := env.listNotes(cookie, ""); len(got) != 5 {
		t.Errorf("an unpaged request should return everything, got %d", len(got))
	}
}

func TestListReportsTotalCount(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("total@example.com")
	for i := 0; i < 3; i++ {
		env.createNote(cookie, fmt.Sprintf("N%d", i), "x", "")
	}

	rec := env.request(http.MethodGet, "/api/notes?limit=1", nil, cookie)
	if got := rec.Header().Get("X-Total-Count"); got != "3" {
		t.Errorf("X-Total-Count = %q, want 3", got)
	}
}

func TestVersionsArePruned(t *testing.T) {
	env := newTestEnvWithVersions(t, 3)
	_, cookie := env.user("prune@example.com")

	id := env.createNote(cookie, "Note", "v0", "")
	for i := 1; i <= 6; i++ {
		version := env.getNote(cookie, id).UpdatedAt
		env.do(http.MethodPut, "/api/notes/"+itoa(id),
			gin.H{"title": "Note", "content": fmt.Sprintf("v%d", i)}, cookie,
			[2]string{"If-Match", version}).expect(http.StatusOK)
	}

	var stored int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM note_versions WHERE note_id=?`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 3 {
		t.Fatalf("kept %d versions, want the 3 most recent", stored)
	}

	var versions []struct {
		ID      int64  `json:"id"`
		SavedAt string `json:"savedAt"`
	}
	env.do(http.MethodGet, "/api/notes/"+itoa(id)+"/versions", nil, cookie).
		expect(http.StatusOK).decode(&versions)
	if len(versions) != 3 {
		t.Errorf("listed %d versions, want 3", len(versions))
	}

	// The survivors must be the newest ones.
	var oldest string
	if err := env.DB.QueryRow(`SELECT MIN(content) FROM note_versions WHERE note_id=?`, id).Scan(&oldest); err != nil {
		t.Fatal(err)
	}
	if oldest == "v0" {
		t.Error("pruning kept the oldest version instead of the newest")
	}
}

func TestVersionsUnlimitedWhenCapIsZero(t *testing.T) {
	env := newTestEnvWithVersions(t, 0)
	_, cookie := env.user("nocap@example.com")

	id := env.createNote(cookie, "Note", "v0", "")
	for i := 1; i <= 4; i++ {
		env.do(http.MethodPut, "/api/notes/"+itoa(id),
			gin.H{"title": "Note", "content": fmt.Sprintf("v%d", i)}, cookie).expect(http.StatusOK)
	}

	var stored int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM note_versions WHERE note_id=?`, id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 4 {
		t.Errorf("kept %d versions, want all 4", stored)
	}
}

// The build stamps a version into the binary; a plain `go test` build leaves the
// default, so this only checks the endpoint reports whatever was compiled in.
func TestVersionEndpoint(t *testing.T) {
	env := newTestEnv(t)

	var out struct {
		Version string `json:"version"`
	}
	env.do(http.MethodGet, "/api/version", nil, nil).expect(http.StatusOK).decode(&out)
	if out.Version == "" {
		t.Error("the version endpoint returned nothing")
	}
	if out.Version != version {
		t.Errorf("reported %q, built with %q", out.Version, version)
	}
}
