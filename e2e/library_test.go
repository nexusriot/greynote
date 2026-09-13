// Coverage for the library surface: the tag catalogue, the folder tree,
// templates, the journal, emptying the trash, reading a version snapshot and
// paging the note list.
//
// These tests run on throwaway accounts so their counts are exact — a shared
// account would leave every assertion an "at least".
package e2e

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

type tagRow struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type folderRow struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
	Total int    `json:"total"`
}

type templateRow struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Tags      string `json:"tags"`
	Folder    string `json:"folder"`
	IsDaily   bool   `json:"isDaily"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (c *client) tagCounts() map[string]int {
	c.t.Helper()

	var rows []tagRow
	c.do(http.MethodGet, "/api/tags", nil).expect(http.StatusOK).decode(&rows)
	out := make(map[string]int, len(rows))
	for _, row := range rows {
		out[row.Name] = row.Count
	}
	return out
}

func (c *client) folderTree() map[string]folderRow {
	c.t.Helper()

	var rows []folderRow
	c.do(http.MethodGet, "/api/folders", nil).expect(http.StatusOK).decode(&rows)
	out := make(map[string]folderRow, len(rows))
	for _, row := range rows {
		out[row.Path] = row
	}
	return out
}

func (c *client) templateList() []templateRow {
	c.t.Helper()

	var rows []templateRow
	c.do(http.MethodGet, "/api/templates", nil).expect(http.StatusOK).decode(&rows)
	return rows
}

// TestTagCatalogue covers the tag list, the merge and the delete. A tag with a
// slash in it exercises the encoded-slash routing: "project/alpha" has to
// survive the trip through the URL as one path parameter.
func TestTagCatalogue(t *testing.T) {
	acct := newAccount(t, "tags")

	alpha := acct.createNote(map[string]any{"title": "Alpha", "content": "one", "tags": "Project/Alpha, urgent"})
	beta := acct.createNote(map[string]any{"title": "Beta", "content": "two", "tags": "project/beta,urgent"})
	notes := acct.createNote(map[string]any{"title": "Notes", "content": "three", "tags": "project/alpha"})

	counts := acct.tagCounts()
	for name, want := range map[string]int{"project/alpha": 2, "project/beta": 1, "urgent": 2} {
		if counts[name] != want {
			t.Errorf("tag %q counted %d notes, want %d (catalogue: %v)", name, counts[name], want, counts)
		}
	}

	// Deleting a tag strips it from every note that carries it, and drops it
	// from the catalogue once nothing references it.
	var deleted struct {
		NotesUpdated int `json:"notesUpdated"`
	}
	acct.do(http.MethodDelete, "/api/tags/project%2Falpha", nil).expect(http.StatusOK).decode(&deleted)
	if deleted.NotesUpdated != 2 {
		t.Errorf("deleting project/alpha touched %d notes, want 2", deleted.NotesUpdated)
	}
	if got := acct.getNote(alpha).Tags; got != "urgent" {
		t.Errorf("tags after the delete = %q, want the other tag kept", got)
	}
	if got := acct.getNote(notes).Tags; got != "" {
		t.Errorf("the note's only tag should be gone, got %q", got)
	}
	if _, ok := acct.tagCounts()["project/alpha"]; ok {
		t.Error("the deleted tag is still in the catalogue")
	}

	// Merging folds several tags into one, normalising the target.
	var merged struct {
		Name         string `json:"name"`
		NotesUpdated int    `json:"notesUpdated"`
	}
	acct.do(http.MethodPost, "/api/tags/merge",
		map[string]any{"from": []string{"project/beta", "urgent"}, "into": "Project"}).
		expect(http.StatusOK).decode(&merged)
	if merged.Name != "project" || merged.NotesUpdated != 2 {
		t.Errorf("merge = %+v, want project over two notes", merged)
	}
	if got := acct.getNote(beta).Tags; got != "project" {
		t.Errorf("beta tags after the merge = %q", got)
	}
	if got := acct.tagCounts(); got["project"] != 2 || len(got) != 1 {
		t.Errorf("catalogue after the merge = %v, want only project", got)
	}

	// A merge needs something to merge.
	acct.do(http.MethodPost, "/api/tags/merge",
		map[string]any{"from": []string{}, "into": "project"}).expect(http.StatusBadRequest)
	acct.do(http.MethodPost, "/api/tags/merge",
		map[string]any{"from": []string{"project"}, "into": "project"}).expect(http.StatusBadRequest)
}

func TestFolderDeleteEmptiesTheSubtree(t *testing.T) {
	acct := newAccount(t, "folders")

	top := acct.createNote(map[string]any{"title": "Top", "content": "x", "folder": "Work"})
	deep := acct.createNote(map[string]any{"title": "Deep", "content": "x", "folder": "Work/Q3/Plans"})
	keep := acct.createNote(map[string]any{"title": "Keep", "content": "x", "folder": "Personal"})

	tree := acct.folderTree()
	if tree["Work"].Total != 2 || tree["Work"].Count != 1 {
		t.Errorf("Work = %+v, want one note of its own and two below", tree["Work"])
	}
	if _, ok := tree["Work/Q3"]; !ok {
		t.Errorf("the tree should synthesise the intermediate folder: %v", tree)
	}

	acct.do(http.MethodDelete, "/api/folders", nil).expect(http.StatusBadRequest)

	var removed struct {
		NotesUpdated int `json:"notesUpdated"`
	}
	acct.do(http.MethodDelete, "/api/folders?path=Work", nil).expect(http.StatusOK).decode(&removed)
	if removed.NotesUpdated != 2 {
		t.Errorf("deleting Work moved %d notes, want 2", removed.NotesUpdated)
	}

	// Everything under the folder goes back to the root rather than keeping a
	// half-path like "Q3/Plans".
	if got := acct.getNote(top).Folder; got != "" {
		t.Errorf("the note in the deleted folder is in %q", got)
	}
	if got := acct.getNote(deep).Folder; got != "" {
		t.Errorf("the nested note kept a stray path: %q", got)
	}
	if got := acct.getNote(keep).Folder; got != "Personal" {
		t.Errorf("an unrelated folder was disturbed: %q", got)
	}
	for path := range acct.folderTree() {
		if strings.HasPrefix(path, "Work") {
			t.Errorf("the tree still lists %q", path)
		}
	}
}

func TestTemplatesAreListedAndEdited(t *testing.T) {
	acct := newAccount(t, "templates")

	var created struct {
		ID int64 `json:"id"`
	}
	acct.do(http.MethodPost, "/api/templates", map[string]any{
		"name": "Meeting", "title": "{{date}} meeting", "content": "## Agenda\n\n- ",
		"tags": "Meeting, Work", "folder": "/Work/Meetings/",
	}).expect(http.StatusCreated).decode(&created)

	acct.do(http.MethodPost, "/api/templates",
		map[string]any{"name": "Meeting", "content": "x"}).expect(http.StatusBadRequest)
	acct.do(http.MethodPost, "/api/templates",
		map[string]any{"name": "   ", "content": "x"}).expect(http.StatusBadRequest)

	listed := acct.templateList()
	if len(listed) != 1 {
		t.Fatalf("template list = %+v", listed)
	}
	if listed[0].Tags != "meeting,work" || listed[0].Folder != "Work/Meetings" {
		t.Errorf("stored template = %+v, want the tags and folder normalised", listed[0])
	}
	if listed[0].IsDaily {
		t.Error("a plain template should not be the daily one")
	}

	// Editing replaces every field, including the daily flag.
	acct.do(http.MethodPut, fmt.Sprintf("/api/templates/%d", created.ID), map[string]any{
		"name": "Meeting notes", "title": "{{weekday}} sync", "content": "## Notes\n\n- ",
		"tags": "sync", "folder": "Work/Sync", "isDaily": true,
	}).expect(http.StatusNoContent)
	acct.do(http.MethodPut, "/api/templates/9999999",
		map[string]any{"name": "Nowhere"}).expect(http.StatusNotFound)

	edited := acct.templateList()[0]
	if edited.Name != "Meeting notes" || edited.Content != "## Notes\n\n- " || !edited.IsDaily {
		t.Errorf("edited template = %+v", edited)
	}

	// Applying it uses the edited body, expands the placeholders and carries
	// the tags and folder onto the new note.
	var applied struct {
		ID int64 `json:"id"`
	}
	acct.do(http.MethodPost, fmt.Sprintf("/api/templates/%d/apply", created.ID),
		map[string]string{"date": "2026-05-06"}).expect(http.StatusCreated).decode(&applied)

	fromTemplate := acct.getNote(applied.ID)
	if fromTemplate.Title != "Wednesday sync" {
		t.Errorf("title = %q, want the placeholder expanded", fromTemplate.Title)
	}
	if !strings.HasPrefix(fromTemplate.Content, "## Notes") {
		t.Errorf("content = %q, want the edited body", fromTemplate.Content)
	}
	if fromTemplate.Tags != "sync" || fromTemplate.Folder != "Work/Sync" {
		t.Errorf("applied note = %+v, want the template's tags and folder", fromTemplate)
	}

	// Only one template can be the daily one.
	var second struct {
		ID int64 `json:"id"`
	}
	acct.do(http.MethodPost, "/api/templates",
		map[string]any{"name": "Journal", "content": "# {{date}}", "isDaily": true}).
		expect(http.StatusCreated).decode(&second)

	daily := []string{}
	for _, tpl := range acct.templateList() {
		if tpl.IsDaily {
			daily = append(daily, tpl.Name)
		}
	}
	if len(daily) != 1 || daily[0] != "Journal" {
		t.Errorf("daily templates = %v, want only the newest", daily)
	}

	// Templates belong to their owner.
	stranger := newAccount(t, "template-stranger")
	stranger.do(http.MethodPut, fmt.Sprintf("/api/templates/%d", created.ID),
		map[string]any{"name": "Hijacked"}).expect(http.StatusNotFound)
	stranger.do(http.MethodDelete, fmt.Sprintf("/api/templates/%d", created.ID), nil).expect(http.StatusNotFound)
	stranger.do(http.MethodPost, fmt.Sprintf("/api/templates/%d/apply", created.ID), nil).expect(http.StatusNotFound)
	if len(stranger.templateList()) != 0 {
		t.Error("another account's templates are visible")
	}

	acct.do(http.MethodDelete, fmt.Sprintf("/api/templates/%d", created.ID), nil).expect(http.StatusNoContent)
	acct.do(http.MethodDelete, fmt.Sprintf("/api/templates/%d", created.ID), nil).expect(http.StatusNotFound)
}

// TestJournalDayLookup covers reading a day's entry and the calendar list. It
// also pins the rule that a trashed entry frees its day: the unique index
// covers trashed rows, so the delete has to clear the date.
func TestJournalDayLookup(t *testing.T) {
	acct := newAccount(t, "journal")
	const day = "2026-04-07"

	acct.do(http.MethodGet, "/api/notes/daily?date="+day, nil).expect(http.StatusNotFound)

	var opened struct {
		ID      int64  `json:"id"`
		Created bool   `json:"created"`
		Date    string `json:"date"`
	}
	acct.do(http.MethodPost, "/api/notes/daily", map[string]string{"date": day}).
		expect(http.StatusCreated).decode(&opened)
	if !opened.Created || opened.Date != day {
		t.Fatalf("opening the day = %+v", opened)
	}

	var today note
	acct.do(http.MethodGet, "/api/notes/daily?date="+day, nil).expect(http.StatusOK).decode(&today)
	if today.ID != opened.ID || today.DailyDate != day {
		t.Errorf("the day's entry = %+v, want note %d", today, opened.ID)
	}

	var entries []struct {
		ID    int64  `json:"id"`
		Date  string `json:"date"`
		Title string `json:"title"`
	}
	acct.do(http.MethodGet, "/api/notes/daily/list", nil).expect(http.StatusOK).decode(&entries)
	if len(entries) != 1 || entries[0].Date != day || entries[0].ID != opened.ID {
		t.Errorf("the calendar = %+v, want the one day", entries)
	}

	// A day with no entry is a 404 rather than an empty note, and a missing
	// date means the server's today — which this account has not opened.
	acct.do(http.MethodGet, "/api/notes/daily?date=2026-04-08", nil).expect(http.StatusNotFound)
	acct.do(http.MethodGet, "/api/notes/daily", nil).expect(http.StatusNotFound)

	// Trashing the entry frees the day, and opening it again is a new note
	// rather than a 500 from the unique index.
	acct.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", opened.ID), nil).expect(http.StatusNoContent)
	acct.do(http.MethodGet, "/api/notes/daily?date="+day, nil).expect(http.StatusNotFound)

	var reopened struct {
		ID      int64 `json:"id"`
		Created bool  `json:"created"`
	}
	acct.do(http.MethodPost, "/api/notes/daily", map[string]string{"date": day}).
		expect(http.StatusCreated).decode(&reopened)
	if !reopened.Created || reopened.ID == opened.ID {
		t.Errorf("reopening the day = %+v, want a fresh note", reopened)
	}
}

func TestEmptyingTheTrashPurgesEverything(t *testing.T) {
	acct := newAccount(t, "trash")

	gone := acct.createNote(map[string]any{"title": "Discarded", "content": "unrepeatable phrase", "tags": "trash"})
	alsoGone := acct.createNote(map[string]any{"title": "Also discarded", "content": "unrepeatable phrase"})
	kept := acct.createNote(map[string]any{"title": "Kept", "content": "still here"})

	for _, id := range []int64{gone, alsoGone} {
		acct.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusNoContent)
	}

	var purged struct {
		Purged int `json:"purged"`
	}
	acct.do(http.MethodDelete, "/api/notes/trash", nil).expect(http.StatusOK).decode(&purged)
	if purged.Purged != 2 {
		t.Errorf("emptying the trash purged %d notes, want 2", purged.Purged)
	}

	var trash []note
	acct.do(http.MethodGet, "/api/notes/trash", nil).expect(http.StatusOK).decode(&trash)
	if len(trash) != 0 {
		t.Errorf("the trash still holds %d notes", len(trash))
	}
	for _, id := range []int64{gone, alsoGone} {
		acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/restore", id), nil).expect(http.StatusNotFound)
	}
	acct.do(http.MethodGet, fmt.Sprintf("/api/notes/%d", kept), nil).expect(http.StatusOK)

	// The purge takes the notes out of the search index too.
	var search struct {
		Results []note `json:"results"`
	}
	acct.do(http.MethodGet, "/api/notes/search?q=unrepeatable", nil).expect(http.StatusOK).decode(&search)
	if len(search.Results) != 0 {
		t.Errorf("purged notes are still indexed: %+v", search.Results)
	}

	// Emptying an empty trash is a no-op, not an error.
	acct.do(http.MethodDelete, "/api/notes/trash", nil).expect(http.StatusOK).decode(&purged)
	if purged.Purged != 0 {
		t.Errorf("a second empty purged %d notes", purged.Purged)
	}
	if counts := acct.tagCounts(); len(counts) != 0 {
		t.Errorf("the purged note's tags outlived it: %v", counts)
	}
}

// TestVersionSnapshotsCanBeRead covers reading one snapshot back. A version
// holds the state a save replaced, which is what a restore needs.
func TestVersionSnapshotsCanBeRead(t *testing.T) {
	acct := newAccount(t, "versions")

	id := acct.createNote(map[string]any{"title": "Draft", "content": "first", "tags": "v1"})
	for _, body := range []map[string]any{
		{"title": "Draft", "content": "second", "tags": "v2"},
		{"title": "Draft", "content": "third", "tags": "v3"},
	} {
		acct.do(http.MethodPut, fmt.Sprintf("/api/notes/%d", id), body).expect(http.StatusOK)
	}

	var listed []struct {
		ID      int64  `json:"id"`
		Title   string `json:"title"`
		SavedAt string `json:"savedAt"`
	}
	acct.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions", id), nil).expect(http.StatusOK).decode(&listed)
	if len(listed) != 2 {
		t.Fatalf("two saves should have left two versions, got %+v", listed)
	}

	// Newest first: the top entry is the state the last save replaced.
	var newest, oldest struct {
		ID      int64  `json:"id"`
		Title   string `json:"title"`
		Content string `json:"content"`
		Tags    string `json:"tags"`
		SavedAt string `json:"savedAt"`
	}
	acct.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions/%d", id, listed[0].ID), nil).
		expect(http.StatusOK).decode(&newest)
	acct.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions/%d", id, listed[1].ID), nil).
		expect(http.StatusOK).decode(&oldest)

	if newest.Content != "second" || newest.Tags != "v2" {
		t.Errorf("newest version = %+v, want the state before the last save", newest)
	}
	if oldest.Content != "first" || oldest.Tags != "v1" {
		t.Errorf("oldest version = %+v, want the original", oldest)
	}
	if newest.SavedAt == "" || oldest.SavedAt == "" {
		t.Error("a version should say when it was saved")
	}

	acct.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions/9999999", id), nil).expect(http.StatusNotFound)

	// History is private, whether or not the version id is guessed right.
	stranger := newAccount(t, "version-stranger")
	stranger.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions", id), nil).expect(http.StatusNotFound)
	stranger.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions/%d", id, listed[0].ID), nil).
		expect(http.StatusNotFound)
}

// TestShareLinksCanBeDisabled covers the disable route and what re-enabling
// keeps: the same token, and the password guard.
func TestShareLinksCanBeDisabled(t *testing.T) {
	acct := newAccount(t, "share")
	id := acct.createNote(map[string]any{"title": "Published", "content": "the body"})

	var share struct {
		Token    string `json:"token"`
		ShareURL string `json:"shareUrl"`
	}
	acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share", id), nil).
		expect(http.StatusOK).decode(&share)
	if share.Token == "" || !strings.HasSuffix(share.ShareURL, share.Token) {
		t.Fatalf("share = %+v", share)
	}

	anonymous := newClient(t)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusOK)

	acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share/disable", id), nil).expect(http.StatusNoContent)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusNotFound)

	// Re-enabling keeps the link people already have, and the password set
	// while it was live still guards it.
	acct.do(http.MethodPut, fmt.Sprintf("/api/notes/%d/share/password", id),
		map[string]string{"password": "letmein"}).expect(http.StatusNoContent)

	var again struct {
		Token string `json:"token"`
	}
	acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share", id), nil).
		expect(http.StatusOK).decode(&again)
	if again.Token != share.Token {
		t.Errorf("re-enabling minted a new token: %q then %q", share.Token, again.Token)
	}
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusUnauthorized)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil,
		[2]string{"X-Share-Password", "letmein"}).expect(http.StatusOK)

	// Clearing the password opens it again.
	acct.do(http.MethodPut, fmt.Sprintf("/api/notes/%d/share/password", id),
		map[string]string{"password": ""}).expect(http.StatusNoContent)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusOK)

	// Enabling with an expiry is the same call; a past one is already gone, and
	// a malformed one is refused.
	acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share", id),
		map[string]string{"expiresAt": "2020-01-01T00:00:00Z"}).expect(http.StatusOK)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusGone)
	acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share", id),
		map[string]string{"expiresAt": "next tuesday"}).expect(http.StatusBadRequest)

	// Sharing is per-owner and per-note.
	stranger := newAccount(t, "share-stranger")
	stranger.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share/disable", id), nil).expect(http.StatusNotFound)
	acct.do(http.MethodPost, "/api/notes/9999999/share/disable", nil).expect(http.StatusNotFound)
}

func TestNoteListPages(t *testing.T) {
	acct := newAccount(t, "paging")

	ids := map[int64]bool{}
	for i := 0; i < 5; i++ {
		ids[acct.createNote(map[string]any{
			"title": fmt.Sprintf("Page %d", i), "content": fmt.Sprintf("body %d", i),
		})] = true
	}

	page := func(query string) ([]note, int) {
		t.Helper()

		var notes []note
		res := acct.do(http.MethodGet, "/api/notes"+query, nil).expect(http.StatusOK)
		res.decode(&notes)
		total, err := strconv.Atoi(res.Header.Get("X-Total-Count"))
		if err != nil {
			t.Fatalf("X-Total-Count = %q: %v", res.Header.Get("X-Total-Count"), err)
		}
		return notes, total
	}

	// Every page reports the whole total, and the pages tile the list without
	// repeating a note.
	seen := map[int64]bool{}
	for offset := 0; offset < 6; offset += 2 {
		notes, total := page(fmt.Sprintf("?limit=2&offset=%d", offset))
		if total != 5 {
			t.Errorf("offset %d reported a total of %d, want 5", offset, total)
		}
		for _, n := range notes {
			if seen[n.ID] {
				t.Errorf("note %d came back on two pages", n.ID)
			}
			seen[n.ID] = true
		}
	}
	if len(seen) != 5 {
		t.Errorf("paging returned %d of the 5 notes", len(seen))
	}
	for id := range ids {
		if !seen[id] {
			t.Errorf("note %d never appeared in a page", id)
		}
	}

	if notes, _ := page("?limit=2&offset=99"); len(notes) != 0 {
		t.Errorf("a page past the end returned %d notes", len(notes))
	}

	// A pinned note sorts to the front whatever the page size.
	var pinned int64
	for id := range ids {
		pinned = id
		break
	}
	acct.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/pin", pinned), nil).expect(http.StatusOK)
	first, _ := page("?limit=1&full=1")
	if len(first) != 1 || first[0].ID != pinned {
		t.Errorf("the pinned note is not first: %+v", first)
	}
	if first[0].Content == "" {
		t.Error("full=1 should ship the body")
	}
}
