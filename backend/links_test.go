package main

import (
	"net/http"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseWikiLinks(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    []string
	}{
		{"plain", "see [[Other note]] here", []string{"Other note"}},
		{"alias", "see [[Target|display text]]", []string{"Target"}},
		{"duplicates", "[[A]] and [[a]] and [[B]]", []string{"A", "B"}},
		{"trimmed", "[[  Spaced  ]]", []string{"Spaced"}},
		{"empty", "[[]] and [[   ]]", []string{}},
		{"inline code", "use `[[Not a link]]` syntax", []string{}},
		{"fenced code", "```\n[[Not a link]]\n```\n[[Real]]", []string{"Real"}},
		{"multiline guard", "[[no\nnewlines]]", []string{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseWikiLinks(c.content); !reflect.DeepEqual(got, c.want) {
				t.Errorf("parseWikiLinks(%q) = %v, want %v", c.content, got, c.want)
			}
		})
	}
}

type linksResponse struct {
	Outgoing  []linkDTO     `json:"outgoing"`
	Backlinks []backlinkDTO `json:"backlinks"`
}

func (e *testEnv) links(cookie *http.Cookie, id int64) linksResponse {
	e.t.Helper()

	var out linksResponse
	e.do(http.MethodGet, "/api/notes/"+itoa(id)+"/links", nil, cookie).expect(http.StatusOK).decode(&out)
	return out
}

func TestBacklinksBetweenNotes(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("links@example.com")

	target := env.createNote(cookie, "Target", "the destination", "")
	source := env.createNote(cookie, "Source", "a pointer to [[Target]] here", "")

	out := env.links(cookie, source)
	if len(out.Outgoing) != 1 || out.Outgoing[0].ID == nil || *out.Outgoing[0].ID != target {
		t.Fatalf("outgoing links = %+v, want a resolved link to %d", out.Outgoing, target)
	}

	back := env.links(cookie, target)
	if len(back.Backlinks) != 1 || back.Backlinks[0].ID != source {
		t.Fatalf("backlinks = %+v, want note %d", back.Backlinks, source)
	}
	if back.Backlinks[0].Snippet == "" {
		t.Error("backlink should carry a snippet for context")
	}
}

func TestLinkToMissingNoteResolvesLater(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("later@example.com")

	source := env.createNote(cookie, "Source", "pointing at [[Future note]]", "")
	if out := env.links(cookie, source); len(out.Outgoing) != 1 || out.Outgoing[0].ID != nil {
		t.Fatalf("link should start unresolved, got %+v", out.Outgoing)
	}

	future := env.createNote(cookie, "Future note", "now I exist", "")

	out := env.links(cookie, source)
	if len(out.Outgoing) != 1 || out.Outgoing[0].ID == nil || *out.Outgoing[0].ID != future {
		t.Fatalf("link did not resolve after the target was created: %+v", out.Outgoing)
	}
}

func TestLinkResolutionIsCaseInsensitive(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("case@example.com")

	target := env.createNote(cookie, "Meeting Notes", "x", "")
	source := env.createNote(cookie, "Source", "see [[meeting notes]]", "")

	out := env.links(cookie, source)
	if len(out.Outgoing) != 1 || out.Outgoing[0].ID == nil || *out.Outgoing[0].ID != target {
		t.Fatalf("case-insensitive resolution failed: %+v", out.Outgoing)
	}
}

func TestRenamingTargetUnresolvesLink(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("rename-link@example.com")

	target := env.createNote(cookie, "Target", "x", "")
	source := env.createNote(cookie, "Source", "see [[Target]]", "")

	env.do(http.MethodPut, "/api/notes/"+itoa(target),
		gin.H{"title": "Renamed", "content": "x"}, cookie).expect(http.StatusOK)

	if out := env.links(cookie, source); len(out.Outgoing) != 1 || out.Outgoing[0].ID != nil {
		t.Fatalf("link to a renamed note should go unresolved, got %+v", out.Outgoing)
	}
	if back := env.links(cookie, target); len(back.Backlinks) != 0 {
		t.Errorf("stale backlink after rename: %+v", back.Backlinks)
	}
}

func TestTrashingTargetDropsBacklink(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("trash-link@example.com")

	target := env.createNote(cookie, "Target", "x", "")
	source := env.createNote(cookie, "Source", "see [[Target]]", "")

	env.do(http.MethodDelete, "/api/notes/"+itoa(target), nil, cookie).expect(http.StatusNoContent)
	if out := env.links(cookie, source); out.Outgoing[0].ID != nil {
		t.Errorf("link to a trashed note should be unresolved, got %+v", out.Outgoing[0])
	}

	env.do(http.MethodPost, "/api/notes/"+itoa(target)+"/restore", nil, cookie).expect(http.StatusNoContent)
	out := env.links(cookie, source)
	if out.Outgoing[0].ID == nil || *out.Outgoing[0].ID != target {
		t.Errorf("restoring the target should re-resolve the link, got %+v", out.Outgoing[0])
	}
}

func TestLinksDoNotCrossUsers(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("alice-links@example.com")
	_, bob := env.user("bob-links@example.com")

	env.createNote(alice, "Shared title", "alice's note", "")
	bobSource := env.createNote(bob, "Bob source", "see [[Shared title]]", "")

	if out := env.links(bob, bobSource); out.Outgoing[0].ID != nil {
		t.Errorf("link resolved to another user's note: %+v", out.Outgoing[0])
	}
}

func TestUpdatingContentReplacesLinks(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("replace@example.com")

	first := env.createNote(cookie, "First", "x", "")
	env.createNote(cookie, "Second", "x", "")
	source := env.createNote(cookie, "Source", "see [[First]]", "")

	env.do(http.MethodPut, "/api/notes/"+itoa(source),
		gin.H{"title": "Source", "content": "now see [[Second]]"}, cookie).expect(http.StatusOK)

	out := env.links(cookie, source)
	if len(out.Outgoing) != 1 || out.Outgoing[0].Title != "Second" {
		t.Fatalf("outgoing links = %+v, want only Second", out.Outgoing)
	}
	if back := env.links(cookie, first); len(back.Backlinks) != 0 {
		t.Errorf("removed link still shows as a backlink: %+v", back.Backlinks)
	}
}

func TestLinksBackfilledForExistingNotes(t *testing.T) {
	env := newTestEnv(t)
	userID, cookie := env.user("backfill-links@example.com")

	// A note written before link tracking existed.
	res, err := env.DB.Exec(
		`INSERT INTO notes(user_id, title, content, tags, is_pinned, created_at, updated_at)
		 VALUES(?,?,?,'',0,?,?)`,
		userID, "Legacy", "points at [[Target]]", nowRFC3339(), nowRFC3339())
	if err != nil {
		t.Fatal(err)
	}
	legacy, _ := res.LastInsertId()
	target := env.createNote(cookie, "Target", "x", "")

	if err := backfillLinks(env.DB); err != nil {
		t.Fatal(err)
	}

	out := env.links(cookie, legacy)
	if len(out.Outgoing) != 1 || out.Outgoing[0].ID == nil || *out.Outgoing[0].ID != target {
		t.Fatalf("backfilled links = %+v, want a resolved link to %d", out.Outgoing, target)
	}
}
