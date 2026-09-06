package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestSplitFrontMatter(t *testing.T) {
	header, body := splitFrontMatter("---\ntitle: Hello\n---\nbody text\n")
	if header != "title: Hello" {
		t.Errorf("header = %q", header)
	}
	if strings.TrimSpace(body) != "body text" {
		t.Errorf("body = %q", body)
	}

	if h, b := splitFrontMatter("no front matter"); h != "" || b != "no front matter" {
		t.Errorf("plain document mangled: %q / %q", h, b)
	}
	if h, _ := splitFrontMatter("---\nunterminated: true\n"); h != "" {
		t.Errorf("unterminated front matter should be treated as body, got %q", h)
	}
}

func TestParseImportedNote(t *testing.T) {
	t.Run("front matter wins", func(t *testing.T) {
		n, err := parseImportedNote("file.md",
			"---\ntitle: From front matter\ntags:\n  - Work\n  - ideas\npinned: true\ncreated: 2024-01-02\nupdated: 2024-03-04T05:06:07Z\n---\n# A heading\n\nbody\n")
		if err != nil {
			t.Fatal(err)
		}
		if n.Title != "From front matter" {
			t.Errorf("title = %q", n.Title)
		}
		if n.Tags != "work,ideas" {
			t.Errorf("tags = %q", n.Tags)
		}
		if !n.IsPinned {
			t.Error("pinned flag lost")
		}
		if n.CreatedAt != "2024-01-02T00:00:00.000Z" {
			t.Errorf("createdAt = %q", n.CreatedAt)
		}
		if n.UpdatedAt != "2024-03-04T05:06:07.000Z" {
			t.Errorf("updatedAt = %q", n.UpdatedAt)
		}
		if !strings.HasPrefix(n.Content, "# A heading") {
			t.Errorf("heading should stay in the body when a title was given: %q", n.Content)
		}
	})

	t.Run("inline tag string", func(t *testing.T) {
		n, _ := parseImportedNote("f.md", "---\ntags: work, Ideas\n---\nbody")
		if n.Tags != "work,ideas" {
			t.Errorf("tags = %q", n.Tags)
		}
	})

	t.Run("heading becomes the title", func(t *testing.T) {
		n, _ := parseImportedNote("some-file.md", "# Real title\n\nthe body\n")
		if n.Title != "Real title" {
			t.Errorf("title = %q", n.Title)
		}
		if n.Content != "the body" {
			t.Errorf("content = %q — the heading used as a title should be dropped", n.Content)
		}
	})

	t.Run("filename fallback", func(t *testing.T) {
		n, _ := parseImportedNote("notes/Shopping list.md", "milk\nbread")
		if n.Title != "Shopping list" {
			t.Errorf("title = %q", n.Title)
		}
		if n.Content != "milk\nbread" {
			t.Errorf("content = %q", n.Content)
		}
	})

	t.Run("invalid front matter", func(t *testing.T) {
		if _, err := parseImportedNote("f.md", "---\n\ttitle: [unclosed\n---\nbody"); err == nil {
			t.Error("expected an error for malformed YAML")
		}
	})
}

func zipArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

type importResult struct {
	Imported int          `json:"imported"`
	Skipped  []importSkip `json:"skipped"`
}

func TestImportSingleMarkdownFile(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("import@example.com")

	body := []byte("---\ntitle: Imported\ntags: work\n---\nhello world\n")
	var out importResult
	env.upload("/api/notes/import", "note.md", body, cookie).expect(http.StatusOK).decode(&out)

	if out.Imported != 1 {
		t.Fatalf("imported = %d (%+v)", out.Imported, out.Skipped)
	}

	notes := env.listNotes(cookie, "")
	if len(notes) != 1 || notes[0].Title != "Imported" || notes[0].Tags != "work" {
		t.Fatalf("imported note = %+v", notes)
	}
	if hits := env.search(cookie, "hello"); len(hits) != 1 {
		t.Errorf("imported note is not searchable: %+v", hits)
	}
}

func TestImportZipArchive(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("importzip@example.com")

	archive := zipArchive(t, map[string]string{
		"notes/First.md":  "# First\n\nalpha",
		"notes/Second.md": "---\ntitle: Second\ntags:\n  - beta\n---\nbeta body",
		"notes/photo.png": "not markdown",
		"__MACOSX/junk":   "junk",
	})

	var out importResult
	env.upload("/api/notes/import", "export.zip", archive, cookie).expect(http.StatusOK).decode(&out)

	if out.Imported != 2 {
		t.Fatalf("imported = %d, want 2 (%+v)", out.Imported, out.Skipped)
	}
	if len(out.Skipped) != 1 || out.Skipped[0].Name != "notes/photo.png" {
		t.Errorf("skipped = %+v, want only the png", out.Skipped)
	}
	if notes := env.listNotes(cookie, "?tag=beta"); len(notes) != 1 {
		t.Errorf("tags from the archive were not applied: %+v", notes)
	}
}

func TestImportIsIdempotent(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("idempotent@example.com")

	archive := zipArchive(t, map[string]string{"a.md": "# A\n\nbody"})

	var first, second importResult
	env.upload("/api/notes/import", "x.zip", archive, cookie).expect(http.StatusOK).decode(&first)
	env.upload("/api/notes/import", "x.zip", archive, cookie).expect(http.StatusOK).decode(&second)

	if first.Imported != 1 || second.Imported != 0 {
		t.Fatalf("imports = %d then %d, want 1 then 0", first.Imported, second.Imported)
	}
	if len(second.Skipped) != 1 || second.Skipped[0].Reason != "already imported" {
		t.Errorf("skipped = %+v", second.Skipped)
	}
	if notes := env.listNotes(cookie, ""); len(notes) != 1 {
		t.Errorf("re-import duplicated notes: %d", len(notes))
	}
}

func TestImportRejectsUnsupportedFile(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("badimport@example.com")

	env.upload("/api/notes/import", "photo.png", []byte("binary"), cookie).expect(http.StatusBadRequest)
}

func TestImportIndexesWikiLinks(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("importlinks@example.com")

	archive := zipArchive(t, map[string]string{
		"Source.md": "# Source\n\nsee [[Target]]",
		"Target.md": "# Target\n\nhere",
	})
	var out importResult
	env.upload("/api/notes/import", "vault.zip", archive, cookie).expect(http.StatusOK).decode(&out)
	if out.Imported != 2 {
		t.Fatalf("imported = %d", out.Imported)
	}

	notes := env.listNotes(cookie, "")
	var source, target int64
	for _, n := range notes {
		switch n.Title {
		case "Source":
			source = n.ID
		case "Target":
			target = n.ID
		}
	}

	links := env.links(cookie, source)
	if len(links.Outgoing) != 1 || links.Outgoing[0].ID == nil || *links.Outgoing[0].ID != target {
		t.Fatalf("imported links = %+v, want a resolved link to %d", links.Outgoing, target)
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("export@example.com")
	_, bob := env.user("importer@example.com")

	env.createNote(alice, "Round trip", "the body: with a colon", "work,ideas")

	res := env.do(http.MethodGet, "/api/notes/export", nil, alice).expect(http.StatusOK)

	var out importResult
	env.upload("/api/notes/import", "notes-export.zip", res.Body, bob).expect(http.StatusOK).decode(&out)
	if out.Imported != 1 {
		t.Fatalf("imported = %d (%+v)", out.Imported, out.Skipped)
	}

	notes := env.listNotes(bob, "")
	if len(notes) != 1 {
		t.Fatalf("notes = %+v", notes)
	}
	if notes[0].Title != "Round trip" {
		t.Errorf("title = %q", notes[0].Title)
	}
	if notes[0].Content != "the body: with a colon" {
		t.Errorf("content = %q", notes[0].Content)
	}
	if notes[0].Tags != "work,ideas" {
		t.Errorf("tags = %q", notes[0].Tags)
	}
}

func TestExportMarkdownQuotesAwkwardTitles(t *testing.T) {
	md := exportMarkdown(`Title: with "quotes"`, "body", "a,b", true,
		"2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z")

	note, err := parseImportedNote("x.md", md)
	if err != nil {
		t.Fatalf("exported note does not parse: %v\n%s", err, md)
	}
	if note.Title != `Title: with "quotes"` {
		t.Errorf("title = %q", note.Title)
	}
	if note.Tags != "a,b" || !note.IsPinned {
		t.Errorf("tags = %q pinned = %v", note.Tags, note.IsPinned)
	}
}

func TestImportRejectsOversizedArchiveContents(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("bigimport@example.com")

	// Highly compressible entries: small archive, large expansion.
	files := map[string]string{}
	for i := 0; i < 40; i++ {
		files[fmt.Sprintf("note-%02d.md", i)] = strings.Repeat("a", importMaxEntryBytes)
	}
	archive := zipArchive(t, files)
	if len(archive) > importMaxUploadBytes {
		t.Fatalf("test archive is %d bytes, larger than the upload limit", len(archive))
	}

	var out importResult
	env.upload("/api/notes/import", "big.zip", archive, cookie).expect(http.StatusOK).decode(&out)

	if out.Imported >= 40 {
		t.Errorf("imported %d entries, expected the total-size cap to stop it", out.Imported)
	}
	if len(out.Skipped) == 0 {
		t.Error("oversized archive should report skipped entries")
	}
}
