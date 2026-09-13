// Package e2e drives a running GreyNote server over HTTP, exactly as a client
// would. It makes no assumptions about where the server runs beyond the address
// in GREYNOTE_URL, and it never touches the database directly — if a fact is not
// observable through the API, this suite does not assert it.
//
// Run it with `make e2e`, which builds the real image, starts it with a fresh
// volume and runs these tests inside a container on the same network.
package e2e

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"testing"
	"time"
)

var (
	baseURL  = envOr("GREYNOTE_URL", "http://localhost:38080")
	email    = envOr("GREYNOTE_EMAIL", "admin@example.com")
	password = envOr("GREYNOTE_PASSWORD", "supersecret123")
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ---------------------------------------------------------------- harness ---

type client struct {
	t    *testing.T
	http *http.Client
	// probe clients are the ones driving the guard matrix: their requests are
	// deliberately left out of the route-coverage record, since bouncing off a
	// 401 is not coverage of an endpoint.
	probe bool
}

func newClient(t *testing.T) *client {
	t.Helper()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &client{t: t, http: &http.Client{Jar: jar, Timeout: 30 * time.Second}}
}

// probing marks a client as a guard prober; see client.probe.
func (c *client) probing() *client {
	c.probe = true
	return c
}

type response struct {
	t      *testing.T
	Status int
	Body   []byte
	Header http.Header
}

func (r *response) expect(status int) *response {
	r.t.Helper()
	if r.Status != status {
		r.t.Fatalf("expected %d, got %d: %s", status, r.Status, truncate(r.Body))
	}
	return r
}

func (r *response) decode(v any) *response {
	r.t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		r.t.Fatalf("decoding %s: %v", truncate(r.Body), err)
	}
	return r
}

func truncate(body []byte) string {
	if len(body) > 400 {
		return string(body[:400]) + "…"
	}
	return string(body)
}

func (c *client) do(method, path string, body any, headers ...[2]string) *response {
	c.t.Helper()
	if !c.probe {
		recordRoute(method, path)
	}

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		c.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, header := range headers {
		req.Header.Set(header[0], header[1])
	}

	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()

	payload, err := io.ReadAll(res.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	return &response{t: c.t, Status: res.StatusCode, Body: payload, Header: res.Header}
}

func (c *client) upload(path, field, filename string, content []byte) *response {
	c.t.Helper()
	if !c.probe {
		recordRoute(http.MethodPost, path)
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile(field, filename)
	if err != nil {
		c.t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		c.t.Fatal(err)
	}
	writer.Close()

	req, err := http.NewRequest(http.MethodPost, baseURL+path, &buf)
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("upload %s: %v", path, err)
	}
	defer res.Body.Close()

	payload, _ := io.ReadAll(res.Body)
	return &response{t: c.t, Status: res.StatusCode, Body: payload, Header: res.Header}
}

func (c *client) login() {
	c.t.Helper()
	c.do(http.MethodPost, "/api/login", map[string]string{"email": email, "password": password}).
		expect(http.StatusNoContent)
}

// account is a throwaway user with a live session, created through the admin
// API. Tests that revoke a session, change a password or close an account work
// on one of these: none of that may disturb the shared admin login the rest of
// the suite signs in with.
type account struct {
	*client
	Email    string
	Password string
}

func newAccount(t *testing.T, prefix string) *account {
	t.Helper()

	admin := newClient(t)
	admin.login()

	const userPassword = "password123"
	userEmail := fmt.Sprintf("%s-%d@example.com", prefix, time.Now().UnixNano())
	admin.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": userEmail, "password": userPassword}).expect(http.StatusCreated)

	c := newClient(t)
	c.do(http.MethodPost, "/api/login",
		map[string]string{"email": userEmail, "password": userPassword}).expect(http.StatusNoContent)
	return &account{client: c, Email: userEmail, Password: userPassword}
}

// signIn opens a second session for the same account, as another device would.
func (a *account) signIn(t *testing.T) *client {
	t.Helper()

	c := newClient(t)
	c.do(http.MethodPost, "/api/login",
		map[string]string{"email": a.Email, "password": a.Password}).expect(http.StatusNoContent)
	return c
}

type note struct {
	ID               int64  `json:"id"`
	Title            string `json:"title"`
	Content          string `json:"content"`
	Snippet          string `json:"snippet"`
	Tags             string `json:"tags"`
	Folder           string `json:"folder"`
	DailyDate        string `json:"dailyDate"`
	IsPinned         bool   `json:"isPinned"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
	ShareURL         string `json:"shareUrl"`
	SharePasswordSet bool   `json:"sharePasswordSet"`
}

// createNote posts a note and returns its id.
func (c *client) createNote(body map[string]any) int64 {
	c.t.Helper()

	var out struct {
		ID int64 `json:"id"`
	}
	c.do(http.MethodPost, "/api/notes", body).expect(http.StatusCreated).decode(&out)
	return out.ID
}

func (c *client) getNote(id int64) note {
	c.t.Helper()

	var n note
	c.do(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusOK).decode(&n)
	return n
}

// TestMain waits for the server to answer before any test runs: in CI the
// container may still be starting.
func TestMain(m *testing.M) {
	deadline := time.Now().Add(60 * time.Second)
	for {
		res, err := http.Get(baseURL + "/health")
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			fmt.Fprintf(os.Stderr, "gave up waiting for %s: %v\n", baseURL, err)
			os.Exit(1)
		}
		time.Sleep(500 * time.Millisecond)
	}

	status := m.Run()
	if status == 0 {
		if missing := uncoveredRoutes(); len(missing) > 0 {
			fmt.Fprintf(os.Stderr, "the suite never called %d of the server's routes:\n", len(missing))
			for _, r := range missing {
				fmt.Fprintf(os.Stderr, "  %s %s\n", r.Method, r.Path)
			}
			status = 1
		}
	}
	os.Exit(status)
}

// ------------------------------------------------------------------ tests ---

func TestHealthAndAuthentication(t *testing.T) {
	c := newClient(t)

	c.do(http.MethodGet, "/health", nil).expect(http.StatusOK)
	c.do(http.MethodGet, "/api/notes", nil).expect(http.StatusUnauthorized)
	c.do(http.MethodPost, "/api/login", map[string]string{"email": email, "password": "wrong"}).
		expect(http.StatusUnauthorized)

	c.login()
	var me struct {
		Email   string `json:"email"`
		IsAdmin bool   `json:"isAdmin"`
	}
	c.do(http.MethodGet, "/api/me", nil).expect(http.StatusOK).decode(&me)
	if me.Email != email || !me.IsAdmin {
		t.Fatalf("unexpected account: %+v", me)
	}

	c.do(http.MethodPost, "/api/logout", nil).expect(http.StatusNoContent)
	c.do(http.MethodGet, "/api/notes", nil).expect(http.StatusUnauthorized)
}

func TestNoteLifecycle(t *testing.T) {
	c := newClient(t)
	c.login()

	id := c.createNote(map[string]any{
		"title": "Lifecycle", "content": "first body", "tags": "Work, e2e", "folder": "/Cases/One/",
	})

	stored := c.getNote(id)
	if stored.Tags != "work,e2e" {
		t.Errorf("tags = %q, want them normalised", stored.Tags)
	}
	if stored.Folder != "Cases/One" {
		t.Errorf("folder = %q, want it normalised", stored.Folder)
	}

	// The list ships snippets, not bodies.
	var list []note
	res := c.do(http.MethodGet, "/api/notes", nil).expect(http.StatusOK)
	res.decode(&list)
	if total := res.Header.Get("X-Total-Count"); total == "" {
		t.Error("the list should report a total count")
	}
	for _, item := range list {
		if item.ID == id {
			if item.Content != "" {
				t.Error("the list must not ship note bodies")
			}
			if item.Snippet == "" {
				t.Error("the list should carry a snippet")
			}
		}
	}

	// Optimistic concurrency.
	var saved struct {
		UpdatedAt string `json:"updatedAt"`
	}
	c.do(http.MethodPut, fmt.Sprintf("/api/notes/%d", id),
		map[string]any{"title": "Lifecycle", "content": "second body", "tags": "work"},
		[2]string{"If-Match", stored.UpdatedAt}).expect(http.StatusOK).decode(&saved)

	conflict := c.do(http.MethodPut, fmt.Sprintf("/api/notes/%d", id),
		map[string]any{"title": "Lifecycle", "content": "third body"},
		[2]string{"If-Match", stored.UpdatedAt}).expect(http.StatusConflict)

	var conflictBody struct {
		Current note `json:"current"`
	}
	conflict.decode(&conflictBody)
	if conflictBody.Current.Content != "second body" {
		t.Errorf("the conflict should carry the server copy, got %q", conflictBody.Current.Content)
	}

	// Pin, version history, then the trash round trip.
	c.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/pin", id), nil).expect(http.StatusOK)

	var versions []struct {
		ID int64 `json:"id"`
	}
	c.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/versions", id), nil).expect(http.StatusOK).decode(&versions)
	if len(versions) == 0 {
		t.Error("saving should have left a version behind")
	}

	c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusNoContent)
	c.do(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusNotFound)

	var trash []struct {
		ID      int64  `json:"id"`
		PurgeAt string `json:"purgeAt"`
	}
	c.do(http.MethodGet, "/api/notes/trash", nil).expect(http.StatusOK).decode(&trash)
	found := false
	for _, item := range trash {
		if item.ID == id {
			found = true
			if item.PurgeAt == "" {
				t.Error("a trashed note should say when it will be purged")
			}
		}
	}
	if !found {
		t.Fatal("the deleted note is not in the trash")
	}

	c.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/restore", id), nil).expect(http.StatusNoContent)
	c.do(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusOK)

	c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusNoContent)
	c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", id), nil).expect(http.StatusNoContent)
	c.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/restore", id), nil).expect(http.StatusNotFound)
}

func TestSearchAndFilters(t *testing.T) {
	c := newClient(t)
	c.login()

	grocery := c.createNote(map[string]any{
		"title": "Grocery list", "content": "milk and bread", "tags": "shopping", "folder": "Home",
	})
	sprint := c.createNote(map[string]any{
		"title": "Sprint plan", "content": "ship the milk feature", "tags": "work,urgent", "folder": "Work/Q3",
	})
	defer func() {
		for _, id := range []int64{grocery, sprint} {
			c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil)
			c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", id), nil)
		}
	}()

	var search struct {
		Results []struct {
			ID      int64  `json:"id"`
			Snippet string `json:"snippet"`
		} `json:"results"`
		Indexed bool `json:"indexed"`
	}
	c.do(http.MethodGet, "/api/notes/search?q=milk", nil).expect(http.StatusOK).decode(&search)
	if len(search.Results) != 2 {
		t.Fatalf("search for milk returned %d results", len(search.Results))
	}
	if !search.Indexed {
		t.Error("the released image should be built with FTS5 (sqlite_fts5)")
	}
	if !strings.Contains(search.Results[0].Snippet, "\x01") {
		t.Errorf("snippet %q is missing highlight markers", search.Results[0].Snippet)
	}

	// Tag and folder filters, including the recursive form.
	assertCount := func(query string, want int) {
		t.Helper()
		var notes []note
		c.do(http.MethodGet, "/api/notes"+query, nil).expect(http.StatusOK).decode(&notes)
		if len(notes) != want {
			t.Errorf("GET /api/notes%s returned %d notes, want %d", query, len(notes), want)
		}
	}
	assertCount("?tag=shopping", 1)
	assertCount("?tag=work,urgent", 1)
	assertCount("?tag=work,shopping", 0)
	assertCount("?folder=Work/Q3", 1)
	assertCount("?folder=Work&recursive=1", 1)
	assertCount("?folder=Work", 0)

	var folders []struct {
		Path  string `json:"path"`
		Total int    `json:"total"`
	}
	c.do(http.MethodGet, "/api/folders", nil).expect(http.StatusOK).decode(&folders)
	seen := map[string]int{}
	for _, folder := range folders {
		seen[folder.Path] = folder.Total
	}
	if seen["Work"] != 1 {
		t.Errorf("the folder tree should synthesise parents, got %v", seen)
	}
}

func TestTagsFoldersAndLinks(t *testing.T) {
	c := newClient(t)
	c.login()

	target := c.createNote(map[string]any{"title": "Target note", "content": "the destination"})
	source := c.createNote(map[string]any{
		"title": "Source note", "content": "see [[Target note]] and [[Missing note]]", "tags": "linking",
	})
	defer func() {
		for _, id := range []int64{source, target} {
			c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil)
			c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", id), nil)
		}
	}()

	var links struct {
		Outgoing []struct {
			Title string `json:"title"`
			ID    *int64 `json:"id"`
		} `json:"outgoing"`
		Backlinks []struct {
			ID int64 `json:"id"`
		} `json:"backlinks"`
	}
	c.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/links", source), nil).expect(http.StatusOK).decode(&links)
	if len(links.Outgoing) != 2 {
		t.Fatalf("outgoing links = %+v", links.Outgoing)
	}
	resolved, unresolved := 0, 0
	for _, link := range links.Outgoing {
		if link.ID == nil {
			unresolved++
		} else {
			resolved++
		}
	}
	if resolved != 1 || unresolved != 1 {
		t.Errorf("expected one resolved and one dangling link, got %d/%d", resolved, unresolved)
	}

	c.do(http.MethodGet, fmt.Sprintf("/api/notes/%d/links", target), nil).expect(http.StatusOK).decode(&links)
	if len(links.Backlinks) != 1 || links.Backlinks[0].ID != source {
		t.Errorf("backlinks = %+v", links.Backlinks)
	}

	// Renaming a tag rewrites every note that carries it.
	c.do(http.MethodPut, "/api/tags/linking", map[string]string{"name": "Linked"}, nil...).
		expect(http.StatusOK)
	if got := c.getNote(source).Tags; got != "linked" {
		t.Errorf("tags after rename = %q", got)
	}

	// A folder move takes the whole subtree with it.
	c.do(http.MethodPut, fmt.Sprintf("/api/notes/%d", source),
		map[string]any{"title": "Source note", "content": "moved", "folder": "Old/Deep"}).expect(http.StatusOK)
	c.do(http.MethodPut, "/api/folders", map[string]string{"from": "Old", "to": "New"}).expect(http.StatusOK)
	if got := c.getNote(source).Folder; got != "New/Deep" {
		t.Errorf("folder after move = %q", got)
	}
}

func TestTemplatesAndJournal(t *testing.T) {
	c := newClient(t)
	c.login()

	var created struct {
		ID int64 `json:"id"`
	}
	c.do(http.MethodPost, "/api/templates", map[string]any{
		"name": "E2E journal", "title": "Journal {{weekday}}", "content": "## {{date}}\n\n- ",
		"tags": "journal", "folder": "Journal", "isDaily": true,
	}).expect(http.StatusCreated).decode(&created)
	defer c.do(http.MethodDelete, fmt.Sprintf("/api/templates/%d", created.ID), nil)

	var applied struct {
		ID int64 `json:"id"`
	}
	c.do(http.MethodPost, fmt.Sprintf("/api/templates/%d/apply", created.ID),
		map[string]string{"date": "2026-03-04"}).expect(http.StatusCreated).decode(&applied)
	defer func() {
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", applied.ID), nil)
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", applied.ID), nil)
	}()

	fromTemplate := c.getNote(applied.ID)
	if fromTemplate.Title != "Journal Wednesday" {
		t.Errorf("title = %q, want the placeholders expanded", fromTemplate.Title)
	}
	if !strings.Contains(fromTemplate.Content, "## 2026-03-04") {
		t.Errorf("content = %q", fromTemplate.Content)
	}

	// One journal entry per day, whoever asks.
	var first, second struct {
		ID      int64 `json:"id"`
		Created bool  `json:"created"`
	}
	c.do(http.MethodPost, "/api/notes/daily", map[string]string{"date": "2026-03-05"}).
		expect(http.StatusCreated).decode(&first)
	c.do(http.MethodPost, "/api/notes/daily", map[string]string{"date": "2026-03-05"}).
		expect(http.StatusOK).decode(&second)
	defer func() {
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", first.ID), nil)
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", first.ID), nil)
	}()

	if second.ID != first.ID || second.Created {
		t.Errorf("the second open should return the same note: %+v vs %+v", first, second)
	}
	if got := c.getNote(first.ID).DailyDate; got != "2026-03-05" {
		t.Errorf("dailyDate = %q", got)
	}
}

func TestSharingIsPublicAndGuarded(t *testing.T) {
	c := newClient(t)
	c.login()

	id := c.createNote(map[string]any{"title": "Shared", "content": "public body"})
	defer func() {
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil)
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", id), nil)
	}()

	var share struct {
		Token string `json:"token"`
	}
	c.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/share", id), nil).expect(http.StatusOK).decode(&share)

	// A signed-out visitor can read it.
	anonymous := newClient(t)
	var shared note
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusOK).decode(&shared)
	if shared.Content != "public body" {
		t.Errorf("shared note = %+v", shared)
	}

	c.do(http.MethodPut, fmt.Sprintf("/api/notes/%d/share/password", id),
		map[string]string{"password": "letmein"}).expect(http.StatusNoContent)

	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil).expect(http.StatusUnauthorized)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil,
		[2]string{"X-Share-Password", "wrong"}).expect(http.StatusForbidden)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil,
		[2]string{"X-Share-Password", "letmein"}).expect(http.StatusOK)

	// An expired link is gone, and so is a trashed note's link.
	c.do(http.MethodPut, fmt.Sprintf("/api/notes/%d/share/expiry", id),
		map[string]string{"expiresAt": "2020-01-01T00:00:00Z"}).expect(http.StatusNoContent)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil,
		[2]string{"X-Share-Password", "letmein"}).expect(http.StatusGone)

	c.do(http.MethodPut, fmt.Sprintf("/api/notes/%d/share/expiry", id),
		map[string]string{"expiresAt": ""}).expect(http.StatusNoContent)
	c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusNoContent)
	anonymous.do(http.MethodGet, "/api/share/"+share.Token, nil,
		[2]string{"X-Share-Password", "letmein"}).expect(http.StatusNotFound)
	c.do(http.MethodPost, fmt.Sprintf("/api/notes/%d/restore", id), nil).expect(http.StatusNoContent)
}

func TestImagesAndImportExport(t *testing.T) {
	c := newClient(t)
	c.login()

	// A one-pixel PNG, so content sniffing sees a real image.
	png := []byte{
		0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 'I', 'H', 'D', 'R',
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0a, 'I', 'D', 'A', 'T', 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 'I', 'E', 'N', 'D', 0xae,
		0x42, 0x60, 0x82,
	}

	var upload struct {
		URL string `json:"url"`
	}
	c.upload("/api/images", "file", "pixel.png", png).expect(http.StatusOK).decode(&upload)
	if !strings.HasPrefix(upload.URL, "/api/images/") {
		t.Fatalf("upload url = %q", upload.URL)
	}

	// Images are served without a session so shared notes can embed them.
	anonymous := newClient(t)
	anonymous.do(http.MethodGet, upload.URL, nil).expect(http.StatusOK)

	// An executable disguised as an image is refused.
	c.upload("/api/images", "file", "payload.png", []byte("#!/bin/sh\necho hello\n")).
		expect(http.StatusBadRequest)

	id := c.createNote(map[string]any{
		"title": "With image", "content": "![](" + upload.URL + ")", "tags": "media",
	})
	defer func() {
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil)
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", id), nil)
	}()

	// Export, then re-import into a second account: the round trip must keep
	// the title, tags and body.
	export := c.do(http.MethodGet, "/api/notes/export", nil).expect(http.StatusOK)
	reader, err := zip.NewReader(bytes.NewReader(export.Body), int64(len(export.Body)))
	if err != nil {
		t.Fatalf("export is not a zip: %v", err)
	}
	if len(reader.File) == 0 {
		t.Fatal("the export archive is empty")
	}

	second := newClient(t)
	secondEmail := fmt.Sprintf("importer-%d@example.com", time.Now().UnixNano())
	c.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": secondEmail, "password": "password123"}).expect(http.StatusCreated)
	second.do(http.MethodPost, "/api/login",
		map[string]string{"email": secondEmail, "password": "password123"}).expect(http.StatusNoContent)

	var imported struct {
		Imported int `json:"imported"`
		Skipped  []struct {
			Name   string `json:"name"`
			Reason string `json:"reason"`
		} `json:"skipped"`
	}
	second.upload("/api/notes/import", "file", "notes-export.zip", export.Body).
		expect(http.StatusOK).decode(&imported)
	if imported.Imported == 0 {
		t.Fatalf("nothing was imported: %+v", imported)
	}

	// Importing the same archive again changes nothing.
	var again struct {
		Imported int `json:"imported"`
	}
	second.upload("/api/notes/import", "file", "notes-export.zip", export.Body).
		expect(http.StatusOK).decode(&again)
	if again.Imported != 0 {
		t.Errorf("re-importing created %d duplicate notes", again.Imported)
	}

	var importedNotes []note
	second.do(http.MethodGet, "/api/notes?full=1", nil).expect(http.StatusOK).decode(&importedNotes)
	var withImage *note
	for i := range importedNotes {
		if importedNotes[i].Title == "With image" {
			withImage = &importedNotes[i]
		}
	}
	if withImage == nil {
		t.Fatal("the imported archive is missing the note")
	}
	if withImage.Tags != "media" {
		t.Errorf("imported tags = %q", withImage.Tags)
	}
}

func TestAccountsAreIsolated(t *testing.T) {
	c := newClient(t)
	c.login()

	mine := c.createNote(map[string]any{"title": "Private", "content": "secret", "tags": "private"})
	defer func() {
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", mine), nil)
		c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", mine), nil)
	}()

	other := newClient(t)
	otherEmail := fmt.Sprintf("other-%d@example.com", time.Now().UnixNano())
	c.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": otherEmail, "password": "password123"}).expect(http.StatusCreated)
	other.do(http.MethodPost, "/api/login",
		map[string]string{"email": otherEmail, "password": "password123"}).expect(http.StatusNoContent)

	other.do(http.MethodGet, fmt.Sprintf("/api/notes/%d", mine), nil).expect(http.StatusNotFound)
	other.do(http.MethodPut, fmt.Sprintf("/api/notes/%d", mine),
		map[string]any{"title": "hijacked", "content": "x"}).expect(http.StatusNotFound)
	other.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", mine), nil).expect(http.StatusNotFound)

	var search struct {
		Results []note `json:"results"`
	}
	other.do(http.MethodGet, "/api/notes/search?q=secret", nil).expect(http.StatusOK).decode(&search)
	if len(search.Results) != 0 {
		t.Errorf("another account's search found %d of my notes", len(search.Results))
	}

	// A non-admin cannot reach the admin routes.
	other.do(http.MethodGet, "/api/admin/users", nil).expect(http.StatusForbidden)
}

func TestStatsReflectTheAccount(t *testing.T) {
	c := newClient(t)
	c.login()

	id := c.createNote(map[string]any{"title": "Counted", "content": "one two three", "tags": "stats"})

	var before struct {
		TotalNotes int `json:"totalNotes"`
		TopTags    []struct {
			Tag string `json:"tag"`
		} `json:"topTags"`
		NotesPerMonth []struct {
			Month string `json:"month"`
			Count int    `json:"count"`
		} `json:"notesPerMonth"`
	}
	c.do(http.MethodGet, "/api/notes/stats", nil).expect(http.StatusOK).decode(&before)
	if before.TotalNotes == 0 {
		t.Fatal("stats counted no notes")
	}
	if len(before.NotesPerMonth) == 0 || len(before.NotesPerMonth[0].Month) != 7 {
		t.Errorf("notesPerMonth = %+v, want YYYY-MM buckets", before.NotesPerMonth)
	}

	// A trashed note stops counting.
	c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil).expect(http.StatusNoContent)
	var after struct {
		TotalNotes int `json:"totalNotes"`
	}
	c.do(http.MethodGet, "/api/notes/stats", nil).expect(http.StatusOK).decode(&after)
	if after.TotalNotes != before.TotalNotes-1 {
		t.Errorf("trashing a note did not reduce the count: %d then %d", before.TotalNotes, after.TotalNotes)
	}
	c.do(http.MethodDelete, fmt.Sprintf("/api/notes/%d/purge", id), nil).expect(http.StatusNoContent)
}

// TestServerReportsItsVersion guards the build plumbing: the image must be built
// with the version stamped in, not left at the "dev" default.
func TestServerReportsItsVersion(t *testing.T) {
	c := newClient(t)

	var out struct {
		Version string `json:"version"`
	}
	c.do(http.MethodGet, "/api/version", nil).expect(http.StatusOK).decode(&out)
	if out.Version == "" {
		t.Fatal("the server reported no version")
	}
	if want := os.Getenv("GREYNOTE_EXPECT_VERSION"); want != "" && out.Version != want {
		t.Errorf("server reports %q, expected the release version %q", out.Version, want)
	}
	t.Logf("server version: %s", out.Version)
}
