package main

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestNormalizeTags(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", []string{}},
		{"Work, ideas ,work", []string{"work", "ideas"}},
		{"#todo,#Todo", []string{"todo"}},
		{" , ,", []string{}},
		{"a,b,c", []string{"a", "b", "c"}},
	}
	for _, c := range cases {
		if got := normalizeTags(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("normalizeTags(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestNoteTagsPopulateJoinTable(t *testing.T) {
	env := newTestEnv(t)
	userID, cookie := env.user("tags@example.com")

	id := env.createNote(cookie, "Tagged", "body", "Work, Ideas, work")

	if got := env.getNote(cookie, id).Tags; got != "work,ideas" {
		t.Fatalf("tags = %q, want %q", got, "work,ideas")
	}

	var count int
	if err := env.DB.QueryRow(`
		SELECT COUNT(*) FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
		WHERE nt.note_id=? AND t.user_id=?`, id, userID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("note_tags rows = %d, want 2", count)
	}
}

func TestTagListCountsLiveNotesOnly(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("counts@example.com")

	env.createNote(cookie, "One", "a", "work")
	trashed := env.createNote(cookie, "Two", "b", "work,ideas")
	env.do(http.MethodDelete, "/api/notes/"+itoa(trashed), nil, cookie).expect(http.StatusNoContent)

	var tags []tagDTO
	env.do(http.MethodGet, "/api/tags", nil, cookie).expect(http.StatusOK).decode(&tags)

	got := map[string]int{}
	for _, tag := range tags {
		got[tag.Name] = tag.Count
	}
	if got["work"] != 1 {
		t.Errorf("work count = %d, want 1 (trashed notes must not count)", got["work"])
	}
	if _, ok := got["ideas"]; !ok {
		t.Errorf("tag on a trashed note should still be listed, got %v", got)
	}
}

func TestTagRenameRewritesNotes(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("rename@example.com")

	a := env.createNote(cookie, "A", "x", "work,ideas")
	b := env.createNote(cookie, "B", "y", "personal")

	env.do(http.MethodPut, "/api/tags/work", gin.H{"name": "Job"}, cookie).expect(http.StatusOK)

	if got := env.getNote(cookie, a).Tags; got != "job,ideas" {
		t.Errorf("renamed note tags = %q, want %q", got, "job,ideas")
	}
	if got := env.getNote(cookie, b).Tags; got != "personal" {
		t.Errorf("unrelated note changed: %q", got)
	}

	var stale int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM tags WHERE name='work'`).Scan(&stale); err != nil {
		t.Fatal(err)
	}
	if stale != 0 {
		t.Errorf("old tag row survived rename")
	}
}

func TestTagRenameIntoExistingTagMerges(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("mergerename@example.com")

	id := env.createNote(cookie, "A", "x", "work,job")
	env.do(http.MethodPut, "/api/tags/work", gin.H{"name": "job"}, cookie).expect(http.StatusOK)

	if got := env.getNote(cookie, id).Tags; got != "job" {
		t.Errorf("tags = %q, want %q (duplicates must collapse)", got, "job")
	}
}

func TestTagMerge(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("merge@example.com")

	a := env.createNote(cookie, "A", "x", "js,javascript")
	b := env.createNote(cookie, "B", "y", "ecmascript,notes")

	env.do(http.MethodPost, "/api/tags/merge",
		gin.H{"from": []string{"javascript", "ecmascript"}, "into": "js"}, cookie).expect(http.StatusOK)

	if got := env.getNote(cookie, a).Tags; got != "js" {
		t.Errorf("note A tags = %q, want %q", got, "js")
	}
	if got := env.getNote(cookie, b).Tags; got != "js,notes" {
		t.Errorf("note B tags = %q, want %q", got, "js,notes")
	}
}

func TestTagDelete(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("deltag@example.com")

	id := env.createNote(cookie, "A", "x", "work,ideas")
	env.do(http.MethodDelete, "/api/tags/work", nil, cookie).expect(http.StatusOK)

	if got := env.getNote(cookie, id).Tags; got != "ideas" {
		t.Errorf("tags = %q, want %q", got, "ideas")
	}

	var tags []tagDTO
	env.do(http.MethodGet, "/api/tags", nil, cookie).expect(http.StatusOK).decode(&tags)
	for _, tag := range tags {
		if tag.Name == "work" {
			t.Errorf("deleted tag still listed")
		}
	}
}

func TestTagsAreScopedPerUser(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("alice@example.com")
	_, bob := env.user("bob@example.com")

	env.createNote(alice, "A", "x", "shared")
	bobNote := env.createNote(bob, "B", "y", "shared")

	env.do(http.MethodDelete, "/api/tags/shared", nil, alice).expect(http.StatusOK)

	if got := env.getNote(bob, bobNote).Tags; got != "shared" {
		t.Errorf("another user's tags were modified: %q", got)
	}
}

func TestListNotesFilteredByTag(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("filter@example.com")

	env.createNote(cookie, "Work note", "x", "work,urgent")
	env.createNote(cookie, "Idea", "y", "ideas")

	notes := env.listNotes(cookie, "?tag=work")
	if len(notes) != 1 || notes[0].Title != "Work note" {
		t.Fatalf("tag filter returned %d notes: %+v", len(notes), notes)
	}

	if got := env.listNotes(cookie, "?tag=work,urgent"); len(got) != 1 {
		t.Errorf("multi-tag filter (AND) returned %d notes, want 1", len(got))
	}
	if got := env.listNotes(cookie, "?tag=work,ideas"); len(got) != 0 {
		t.Errorf("multi-tag filter (AND) returned %d notes, want 0", len(got))
	}
}

func TestLegacyTagsColumnIsBackfilled(t *testing.T) {
	env := newTestEnv(t)
	userID, cookie := env.user("legacy@example.com")

	// Simulate a row written before the join table existed.
	res, err := env.DB.Exec(
		`INSERT INTO notes(user_id, title, content, tags, is_pinned, created_at, updated_at)
		 VALUES(?,?,?,?,0,?,?)`,
		userID, "Old note", "body", "alpha, Beta", nowRFC3339(), nowRFC3339())
	if err != nil {
		t.Fatal(err)
	}
	noteID, _ := res.LastInsertId()

	if err := backfillTags(env.DB); err != nil {
		t.Fatal(err)
	}

	if got := env.getNote(cookie, noteID).Tags; got != "alpha,beta" {
		t.Errorf("backfilled tags = %q, want %q", got, "alpha,beta")
	}

	var tags []tagDTO
	env.do(http.MethodGet, "/api/tags", nil, cookie).expect(http.StatusOK).decode(&tags)
	if len(tags) != 2 {
		t.Errorf("tag list after backfill = %+v, want 2 entries", tags)
	}
}

// Nested tags use "/" in their name, which only survives routing because the
// router matches on the raw path.
func TestTagsWithSlashCanBeManaged(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("slash@example.com")

	id := env.createNote(cookie, "A", "x", "work/projects,home")

	env.do(http.MethodPut, "/api/tags/work%2Fprojects", gin.H{"name": "work/archive"}, cookie).
		expect(http.StatusOK)
	if got := env.getNote(cookie, id).Tags; got != "work/archive,home" {
		t.Fatalf("tags = %q after rename", got)
	}

	env.do(http.MethodDelete, "/api/tags/work%2Farchive", nil, cookie).expect(http.StatusOK)
	if got := env.getNote(cookie, id).Tags; got != "home" {
		t.Errorf("tags = %q after delete", got)
	}
}
