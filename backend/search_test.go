package main

import (
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

func TestSearchTermsStripSyntax(t *testing.T) {
	got := searchTerms(`  Hello, "world"! (foo-bar) * `)
	want := []string{"hello", "world", "foo", "bar"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("searchTerms = %v, want %v", got, want)
	}
	if len(searchTerms("   !!! ")) != 0 {
		t.Error("a query of only punctuation should produce no terms")
	}
}

func TestFTSQuery(t *testing.T) {
	if got := ftsQuery([]string{"foo", "bar"}); got != `"foo"* "bar"*` {
		t.Errorf("ftsQuery = %q", got)
	}
}

func TestLikeSnippetHighlightsMatch(t *testing.T) {
	got := likeSnippet("the quick brown fox jumps", []string{"brown"})
	if !strings.Contains(got, HighlightStart+"brown"+HighlightEnd) {
		t.Errorf("snippet %q does not highlight the match", got)
	}
	if strings.Contains(likeSnippet("nothing here", []string{"zzz"}), HighlightStart) {
		t.Error("snippet should not highlight when nothing matched")
	}
}

func (e *testEnv) search(cookie *http.Cookie, query string) []searchHit {
	e.t.Helper()

	var out struct {
		Results []searchHit `json:"results"`
	}
	e.do(http.MethodGet, "/api/notes/search?q="+query, nil, cookie).expect(http.StatusOK).decode(&out)
	return out.Results
}

func TestSearchFindsTitleContentAndTags(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("search@example.com")

	env.createNote(cookie, "Grocery list", "milk and bread", "shopping")
	env.createNote(cookie, "Sprint plan", "ship the milk feature", "work")
	env.createNote(cookie, "Unrelated", "nothing to see", "")

	if hits := env.search(cookie, "grocery"); len(hits) != 1 || hits[0].Title != "Grocery list" {
		t.Errorf("title search = %+v", hits)
	}
	if hits := env.search(cookie, "milk"); len(hits) != 2 {
		t.Errorf("content search returned %d hits, want 2", len(hits))
	}
	if hits := env.search(cookie, "shopping"); len(hits) != 1 {
		t.Errorf("tag search returned %d hits, want 1", len(hits))
	}
	if hits := env.search(cookie, "zzzz"); len(hits) != 0 {
		t.Errorf("unmatched query returned %+v", hits)
	}
}

func TestSearchTermsAreAnded(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("anded@example.com")

	env.createNote(cookie, "Both", "alpha and beta together", "")
	env.createNote(cookie, "One", "alpha only", "")

	hits := env.search(cookie, "alpha+beta")
	if len(hits) != 1 || hits[0].Title != "Both" {
		t.Errorf("multi-term search = %+v, want only the note containing both", hits)
	}
}

func TestSearchReturnsHighlightedSnippet(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("snippet@example.com")

	env.createNote(cookie, "Note", "some text mentioning kubernetes in the middle", "")

	hits := env.search(cookie, "kubernetes")
	if len(hits) != 1 {
		t.Fatalf("expected one hit, got %+v", hits)
	}
	if !strings.Contains(hits[0].Snippet, HighlightStart) || !strings.Contains(hits[0].Snippet, HighlightEnd) {
		t.Errorf("snippet %q is missing highlight markers", hits[0].Snippet)
	}
}

func TestSearchIsScopedToTheUser(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("alice-search@example.com")
	_, bob := env.user("bob-search@example.com")

	env.createNote(alice, "Alice secret", "confidential", "")

	if hits := env.search(bob, "confidential"); len(hits) != 0 {
		t.Errorf("search leaked another user's note: %+v", hits)
	}
}

func TestSearchIndexFollowsEdits(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("edits@example.com")

	id := env.createNote(cookie, "Draft", "original wording", "")
	if len(env.search(cookie, "original")) != 1 {
		t.Fatal("new note was not indexed")
	}

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Draft", "content": "replacement wording"}, cookie).expect(http.StatusOK)

	if hits := env.search(cookie, "original"); len(hits) != 0 {
		t.Errorf("stale index entry after edit: %+v", hits)
	}
	if hits := env.search(cookie, "replacement"); len(hits) != 1 {
		t.Errorf("edited content not searchable: %+v", hits)
	}
}

func TestSearchPrefixMatching(t *testing.T) {
	if !ftsEnabled {
		t.Skip("prefix matching requires FTS5 (build with -tags sqlite_fts5)")
	}
	env := newTestEnv(t)
	_, cookie := env.user("prefix@example.com")

	env.createNote(cookie, "Deployment", "how we deploy", "")
	if hits := env.search(cookie, "deploy"); len(hits) != 1 {
		t.Errorf("prefix query returned %d hits, want 1", len(hits))
	}
}

// TestSearchFallbackWithoutFTS exercises the LIKE path used when the driver was
// built without FTS5.
func TestSearchFallbackWithoutFTS(t *testing.T) {
	original := ftsEnabled
	ftsEnabled = false
	defer func() { ftsEnabled = original }()

	env := newTestEnv(t)
	_, cookie := env.user("fallback@example.com")

	env.createNote(cookie, "Fallback note", "scan me for keywords", "")
	env.createNote(cookie, "Other", "nothing", "")

	hits := env.search(cookie, "keywords")
	if len(hits) != 1 || hits[0].Title != "Fallback note" {
		t.Fatalf("fallback search = %+v", hits)
	}
	if !strings.Contains(hits[0].Snippet, HighlightStart+"keywords"+HighlightEnd) {
		t.Errorf("fallback snippet %q is missing highlights", hits[0].Snippet)
	}
}

func TestSearchEmptyQuery(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("emptyq@example.com")

	env.createNote(cookie, "Something", "content", "")
	if hits := env.search(cookie, ""); len(hits) != 0 {
		t.Errorf("empty query should return nothing, got %+v", hits)
	}
}

func TestLikeSnippetKeepsMultibyteCharactersIntact(t *testing.T) {
	content := strings.Repeat("日", 120) + " needle " + strings.Repeat("本", 120)
	got := likeSnippet(content, []string{"needle"})

	if !utf8.ValidString(got) {
		t.Errorf("snippet is not valid UTF-8: %q", got)
	}
	if !strings.Contains(got, HighlightStart+"needle"+HighlightEnd) {
		t.Errorf("snippet %q lost its highlight", got)
	}
}

func TestSnippetOfCountsRunes(t *testing.T) {
	got := snippetOf(strings.Repeat("é", 50), 10)
	if !utf8.ValidString(got) {
		t.Errorf("snippet is not valid UTF-8: %q", got)
	}
	if want := strings.Repeat("é", 10) + "…"; got != want {
		t.Errorf("snippetOf = %q, want %q", got, want)
	}
}

func TestIndexFoldKeepsOffsetsValid(t *testing.T) {
	// Ⱥ lowercases to a longer string, which used to shift every offset.
	haystack := strings.Repeat("Ⱥ", 200) + " needle tail"
	idx := indexFold(haystack, "needle")
	if idx < 0 || haystack[idx:idx+len("needle")] != "needle" {
		t.Fatalf("indexFold = %d, does not point at the match", idx)
	}
	if indexFold("Grocery LIST", "list") < 0 {
		t.Error("indexFold should be case-insensitive")
	}
	if indexFold("abc", "zzz") != -1 {
		t.Error("indexFold should report -1 when there is no match")
	}
}

// A lowercase form longer than the original used to slice the note text out of
// bounds and panic the search handler.
func TestLikeSnippetSurvivesCaseLengtheningRunes(t *testing.T) {
	content := strings.Repeat("Ⱥ", 200) + " needle tail"
	got := likeSnippet(content, []string{"needle"})

	if !utf8.ValidString(got) {
		t.Errorf("snippet is not valid UTF-8: %q", got)
	}
	if !strings.Contains(got, HighlightStart+"needle"+HighlightEnd) {
		t.Errorf("snippet %q lost its highlight", got)
	}
}

func TestSearchFallbackHandlesAwkwardUnicode(t *testing.T) {
	original := ftsEnabled
	ftsEnabled = false
	defer func() { ftsEnabled = original }()

	env := newTestEnv(t)
	_, cookie := env.user("unicode-fallback@example.com")
	env.createNote(cookie, "Odd", strings.Repeat("Ⱥ", 200)+" needle tail", "")

	if hits := env.search(cookie, "needle"); len(hits) != 1 {
		t.Fatalf("search returned %d hits, want 1", len(hits))
	}
}

func TestStartupSweepsOrphanIndexRows(t *testing.T) {
	if !ftsEnabled {
		t.Skip("needs fts5")
	}
	env := newTestEnv(t)
	_, cookie := env.user("orphan@example.com")
	id := env.createNote(cookie, "Note", "orphaned content", "")

	// Simulate an index row left behind by an older build.
	if _, err := env.DB.Exec(`DELETE FROM notes WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if err := initSearch(env.DB); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := env.DB.QueryRow(`SELECT COUNT(*) FROM notes_fts`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("orphan index rows survived startup: %d", n)
	}
}
