package main

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestUpdateReturnsNewVersion(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("version@example.com")

	id := env.createNote(cookie, "Note", "v1", "")

	var out struct {
		UpdatedAt string `json:"updatedAt"`
	}
	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v2"}, cookie).expect(http.StatusOK).decode(&out)

	if out.UpdatedAt == "" {
		t.Fatal("update must return the new version stamp")
	}
	if got := env.getNote(cookie, id).UpdatedAt; got != out.UpdatedAt {
		t.Errorf("returned updatedAt %q, stored %q", out.UpdatedAt, got)
	}
}

func TestUpdateWithStaleIfMatchConflicts(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("conflict@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	stale := env.getNote(cookie, id).UpdatedAt

	// Another device saves first.
	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "from phone"}, cookie,
		[2]string{"If-Match", stale}).expect(http.StatusOK)

	res := env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "from laptop"}, cookie,
		[2]string{"If-Match", stale}).expect(http.StatusConflict)

	var conflict struct {
		Error   string  `json:"error"`
		Current noteDTO `json:"current"`
	}
	res.decode(&conflict)
	if conflict.Current.Content != "from phone" {
		t.Errorf("conflict response should carry the server copy, got %q", conflict.Current.Content)
	}
	if got := env.getNote(cookie, id).Content; got != "from phone" {
		t.Errorf("a rejected save must not overwrite: content = %q", got)
	}
}

func TestUpdateWithQuotedIfMatchIsAccepted(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("quoted@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	current := env.getNote(cookie, id).UpdatedAt

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v2"}, cookie,
		[2]string{"If-Match", `"` + current + `"`}).expect(http.StatusOK)
}

func TestUpdateWithBaseUpdatedAtInBody(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("bodybase@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	stale := env.getNote(cookie, id).UpdatedAt
	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v2"}, cookie).expect(http.StatusOK)

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v3", "baseUpdatedAt": stale}, cookie).
		expect(http.StatusConflict)
}

func TestUpdateWithoutBaseVersionStillOverwrites(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("legacyclient@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v2"}, cookie).expect(http.StatusOK)

	// A client that sends no version information keeps the old last-write-wins
	// behaviour rather than being locked out.
	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v3"}, cookie).expect(http.StatusOK)

	if got := env.getNote(cookie, id).Content; got != "v3" {
		t.Errorf("content = %q, want v3", got)
	}
}

func TestConflictDoesNotCreateAVersionSnapshot(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("nosnapshot@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	stale := env.getNote(cookie, id).UpdatedAt
	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v2"}, cookie).expect(http.StatusOK)

	var before int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM note_versions WHERE note_id=?`, id).Scan(&before); err != nil {
		t.Fatal(err)
	}

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "v3"}, cookie,
		[2]string{"If-Match", stale}).expect(http.StatusConflict)

	var after int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM note_versions WHERE note_id=?`, id).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Errorf("rejected save left a version snapshot (%d → %d)", before, after)
	}
}

func TestAccountDeletionRemovesNoteTextFromTheIndex(t *testing.T) {
	if !ftsEnabled {
		t.Skip("needs fts5")
	}
	env := newTestEnv(t)
	_, cookie := env.user("erase@example.com")
	env.createNote(cookie, "Secret", "highly confidential material", "")

	env.do(http.MethodDelete, "/api/account", gin.H{"password": "password123"}, cookie).
		expect(http.StatusNoContent)

	var n int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'confidential'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d row(s) of a deleted account's note text remain in the search index", n)
	}
}

func TestAdminUserDeletionRemovesNoteTextFromTheIndex(t *testing.T) {
	if !ftsEnabled {
		t.Skip("needs fts5")
	}
	env := newTestEnv(t)
	adminID, admin := env.user("admin-erase@example.com")
	victimID, victim := env.user("victim@example.com")
	if _, err := env.DB.Exec(`UPDATE users SET is_admin=1 WHERE id=?`, adminID); err != nil {
		t.Fatal(err)
	}
	env.createNote(victim, "Secret", "highly confidential material", "")

	env.do(http.MethodDelete, "/api/admin/users/"+itoa(victimID), nil, admin).
		expect(http.StatusNoContent)

	var n int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'confidential'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d row(s) of a deleted user's note text remain in the search index", n)
	}
}
