package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestDeleteMovesNoteToTrash(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("trash@example.com")

	id := env.createNote(cookie, "Doomed", "content", "work")
	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)

	if notes := env.listNotes(cookie, ""); len(notes) != 0 {
		t.Errorf("trashed note still listed: %+v", notes)
	}
	env.do(http.MethodGet, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNotFound)

	var trash []trashedNoteDTO
	env.do(http.MethodGet, "/api/notes/trash", nil, cookie).expect(http.StatusOK).decode(&trash)
	if len(trash) != 1 || trash[0].ID != id {
		t.Fatalf("trash listing = %+v, want the deleted note", trash)
	}
	if trash[0].PurgeAt == "" {
		t.Error("trash entry should advertise when it will be purged")
	}

	var row int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, id).Scan(&row); err != nil {
		t.Fatal(err)
	}
	if row != 1 {
		t.Error("delete must not remove the row, only flag it")
	}
}

func TestRestoreFromTrash(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("restore@example.com")

	id := env.createNote(cookie, "Back", "content", "")
	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)
	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/restore", nil, cookie).expect(http.StatusNoContent)

	if notes := env.listNotes(cookie, ""); len(notes) != 1 {
		t.Fatalf("restored note not listed: %+v", notes)
	}
	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/restore", nil, cookie).expect(http.StatusNotFound)
}

func TestPurgeSingleNote(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("purge@example.com")

	id := env.createNote(cookie, "Gone", "content", "temp")
	env.do(http.MethodDelete, "/api/notes/"+itoa(id)+"/purge", nil, cookie).expect(http.StatusNotFound)

	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)
	env.do(http.MethodDelete, "/api/notes/"+itoa(id)+"/purge", nil, cookie).expect(http.StatusNoContent)

	var rows int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, id).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Error("purge should hard-delete the row")
	}

	var tags []tagDTO
	env.do(http.MethodGet, "/api/tags", nil, cookie).expect(http.StatusOK).decode(&tags)
	if len(tags) != 0 {
		t.Errorf("tags of a purged note should be pruned, got %+v", tags)
	}
}

func TestEmptyTrash(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("empty@example.com")

	keep := env.createNote(cookie, "Keep", "content", "")
	for _, title := range []string{"A", "B"} {
		id := env.createNote(cookie, title, "content", "")
		env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)
	}

	var out struct {
		Purged int `json:"purged"`
	}
	env.do(http.MethodDelete, "/api/notes/trash", nil, cookie).expect(http.StatusOK).decode(&out)
	if out.Purged != 2 {
		t.Errorf("purged = %d, want 2", out.Purged)
	}

	var trash []trashedNoteDTO
	env.do(http.MethodGet, "/api/notes/trash", nil, cookie).expect(http.StatusOK).decode(&trash)
	if len(trash) != 0 {
		t.Errorf("trash not empty: %+v", trash)
	}
	if notes := env.listNotes(cookie, ""); len(notes) != 1 || notes[0].ID != keep {
		t.Errorf("emptying the trash disturbed live notes: %+v", notes)
	}
}

func TestTrashIsPerUser(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("alice-trash@example.com")
	_, bob := env.user("bob-trash@example.com")

	id := env.createNote(alice, "Alice note", "content", "")
	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, alice).expect(http.StatusNoContent)

	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/restore", nil, bob).expect(http.StatusNotFound)
	env.do(http.MethodDelete, "/api/notes/"+itoa(id)+"/purge", nil, bob).expect(http.StatusNotFound)

	var trash []trashedNoteDTO
	env.do(http.MethodGet, "/api/notes/trash", nil, bob).expect(http.StatusOK).decode(&trash)
	if len(trash) != 0 {
		t.Errorf("another user's trash leaked: %+v", trash)
	}
}

func TestRetentionSweepPurgesOldTrash(t *testing.T) {
	env := newTestEnvWithRetention(t, 24*time.Hour)
	_, cookie := env.user("sweep@example.com")

	fresh := env.createNote(cookie, "Fresh", "content", "")
	stale := env.createNote(cookie, "Stale", "content", "")
	for _, id := range []int64{fresh, stale} {
		env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)
	}
	if _, err := env.DB.Exec(`UPDATE notes SET deleted_at=? WHERE id=?`,
		time.Now().UTC().Add(-72*time.Hour).Format(time.RFC3339), stale); err != nil {
		t.Fatal(err)
	}

	purged, err := purgeExpiredTrash(env.DB, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if purged != 1 {
		t.Fatalf("purged = %d, want 1", purged)
	}

	var trash []trashedNoteDTO
	env.do(http.MethodGet, "/api/notes/trash", nil, cookie).expect(http.StatusOK).decode(&trash)
	if len(trash) != 1 || trash[0].ID != fresh {
		t.Errorf("sweep kept the wrong notes: %+v", trash)
	}
}

func TestRetentionZeroKeepsTrashForever(t *testing.T) {
	env := newTestEnvWithRetention(t, 0)
	_, cookie := env.user("keep@example.com")

	id := env.createNote(cookie, "Old", "content", "")
	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)
	if _, err := env.DB.Exec(`UPDATE notes SET deleted_at=? WHERE id=?`,
		time.Now().UTC().AddDate(-5, 0, 0).Format(time.RFC3339), id); err != nil {
		t.Fatal(err)
	}

	purged, err := purgeExpiredTrash(env.DB, 0)
	if err != nil {
		t.Fatal(err)
	}
	if purged != 0 {
		t.Errorf("purged = %d with retention disabled, want 0", purged)
	}
}

func TestTrashedNotesAreHiddenEverywhere(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("hidden@example.com")

	id := env.createNote(cookie, "Secret", "findable content", "work")
	var share struct {
		Token string `json:"token"`
	}
	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/share", nil, cookie).expect(http.StatusOK).decode(&share)
	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)

	env.do(http.MethodGet, "/api/share/"+share.Token, nil, nil).expect(http.StatusNotFound)

	var search struct {
		Results []searchHit `json:"results"`
	}
	env.do(http.MethodGet, "/api/notes/search?q=findable", nil, cookie).expect(http.StatusOK).decode(&search)
	if len(search.Results) != 0 {
		t.Errorf("trashed note found by search: %+v", search.Results)
	}

	var stats struct {
		TotalNotes int `json:"totalNotes"`
	}
	env.do(http.MethodGet, "/api/notes/stats", nil, cookie).expect(http.StatusOK).decode(&stats)
	if stats.TotalNotes != 0 {
		t.Errorf("stats counted a trashed note: %d", stats.TotalNotes)
	}

	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/pin", nil, cookie).expect(http.StatusNotFound)
	env.do(http.MethodPut, "/api/notes/"+itoa(id), gin.H{"title": "x", "content": "y"}, cookie).
		expect(http.StatusNotFound)
}
