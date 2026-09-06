package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestExpandTemplate(t *testing.T) {
	when := time.Date(2026, 3, 4, 9, 5, 0, 0, time.UTC)
	got := expandTemplate("# {{title}} ({{weekday}} {{date}} {{time}})\n{{month}} {{year}} {{datetime}}", when, "Standup")
	want := "# Standup (Wednesday 2026-03-04 09:05)\nMarch 2026 2026-03-04 09:05"
	if got != want {
		t.Errorf("expandTemplate =\n%q\nwant\n%q", got, want)
	}
	if got := expandTemplate("nothing to replace", when, "x"); got != "nothing to replace" {
		t.Errorf("plain text changed: %q", got)
	}
}

func TestParseClientDate(t *testing.T) {
	if got := parseClientDate("2026-03-04").Format(dailyDateLayout); got != "2026-03-04" {
		t.Errorf("parseClientDate = %q", got)
	}
	if got := parseClientDate("rubbish").Format(dailyDateLayout); got != time.Now().UTC().Format(dailyDateLayout) {
		t.Errorf("a bad date should fall back to today, got %q", got)
	}
}

func (e *testEnv) createTemplate(cookie *http.Cookie, body gin.H) int64 {
	e.t.Helper()

	var out struct {
		ID int64 `json:"id"`
	}
	e.do(http.MethodPost, "/api/templates", body, cookie).expect(http.StatusCreated).decode(&out)
	return out.ID
}

func TestTemplateCrud(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("templates@example.com")

	id := env.createTemplate(cookie, gin.H{
		"name": "Meeting", "title": "Meeting {{date}}", "content": "## Agenda\n", "tags": "Work, meeting", "folder": "/Work/",
	})

	var list []templateDTO
	env.do(http.MethodGet, "/api/templates", nil, cookie).expect(http.StatusOK).decode(&list)
	if len(list) != 1 || list[0].Name != "Meeting" {
		t.Fatalf("templates = %+v", list)
	}
	if list[0].Tags != "work,meeting" {
		t.Errorf("tags = %q, want normalised", list[0].Tags)
	}
	if list[0].Folder != "Work" {
		t.Errorf("folder = %q, want normalised", list[0].Folder)
	}

	env.do(http.MethodPost, "/api/templates", gin.H{"name": "Meeting"}, cookie).
		expect(http.StatusBadRequest)
	env.do(http.MethodPost, "/api/templates", gin.H{"name": "  "}, cookie).
		expect(http.StatusBadRequest)

	env.do(http.MethodPut, "/api/templates/"+itoa(id),
		gin.H{"name": "Standup", "content": "notes"}, cookie).expect(http.StatusNoContent)
	env.do(http.MethodDelete, "/api/templates/"+itoa(id), nil, cookie).expect(http.StatusNoContent)
	env.do(http.MethodDelete, "/api/templates/"+itoa(id), nil, cookie).expect(http.StatusNotFound)
}

func TestApplyTemplateCreatesNote(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("apply@example.com")

	id := env.createTemplate(cookie, gin.H{
		"name": "Meeting", "title": "Meeting {{date}}",
		"content": "# {{title}}\n\n## Agenda", "tags": "work", "folder": "Work",
	})

	var out struct {
		ID int64 `json:"id"`
	}
	env.do(http.MethodPost, "/api/templates/"+itoa(id)+"/apply", gin.H{"date": "2026-03-04"}, cookie).
		expect(http.StatusCreated).decode(&out)

	note := env.getNote(cookie, out.ID)
	if note.Title != "Meeting 2026-03-04" {
		t.Errorf("title = %q", note.Title)
	}
	if !strings.HasPrefix(note.Content, "# Meeting 2026-03-04") {
		t.Errorf("content = %q — {{title}} should expand to the note title", note.Content)
	}
	if note.Tags != "work" || note.Folder != "Work" {
		t.Errorf("tags/folder not carried over: %q / %q", note.Tags, note.Folder)
	}
	if hits := env.search(cookie, "agenda"); len(hits) != 1 {
		t.Errorf("a note created from a template should be searchable: %+v", hits)
	}
}

func TestApplyTemplateWithExplicitTitle(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("applytitle@example.com")

	id := env.createTemplate(cookie, gin.H{"name": "Blank", "title": "{{date}}", "content": "{{title}}"})

	var out struct {
		ID int64 `json:"id"`
	}
	env.do(http.MethodPost, "/api/templates/"+itoa(id)+"/apply", gin.H{"title": "Chosen"}, cookie).
		expect(http.StatusCreated).decode(&out)

	note := env.getNote(cookie, out.ID)
	if note.Title != "Chosen" || note.Content != "Chosen" {
		t.Errorf("note = %q / %q", note.Title, note.Content)
	}
}

func TestOnlyOneDailyTemplate(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("onedaily@example.com")

	first := env.createTemplate(cookie, gin.H{"name": "Journal", "isDaily": true})
	second := env.createTemplate(cookie, gin.H{"name": "Log", "isDaily": true})

	var list []templateDTO
	env.do(http.MethodGet, "/api/templates", nil, cookie).expect(http.StatusOK).decode(&list)

	daily := []int64{}
	for _, tpl := range list {
		if tpl.IsDaily {
			daily = append(daily, tpl.ID)
		}
	}
	if len(daily) != 1 || daily[0] != second {
		t.Errorf("daily templates = %v, want only %d", daily, second)
	}
	_ = first
}

func TestDailyNoteIsCreatedOncePerDay(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("daily@example.com")

	var first struct {
		ID      int64  `json:"id"`
		Created bool   `json:"created"`
		Date    string `json:"date"`
	}
	env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-04"}, cookie).
		expect(http.StatusCreated).decode(&first)
	if !first.Created || first.Date != "2026-03-04" {
		t.Fatalf("first open = %+v", first)
	}

	var second struct {
		ID      int64 `json:"id"`
		Created bool  `json:"created"`
	}
	env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-04"}, cookie).
		expect(http.StatusOK).decode(&second)
	if second.Created || second.ID != first.ID {
		t.Errorf("second open = %+v, want the same note", second)
	}

	if got := env.getNote(cookie, first.ID).DailyDate; got != "2026-03-04" {
		t.Errorf("dailyDate = %q", got)
	}
}

func TestDailyNoteUsesTheDailyTemplate(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("dailytpl@example.com")

	env.createTemplate(cookie, gin.H{
		"name": "Journal", "title": "Journal {{weekday}}", "content": "## {{date}}\n\n- ",
		"tags": "journal", "folder": "Journal", "isDaily": true,
	})

	var out struct {
		ID int64 `json:"id"`
	}
	env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-04"}, cookie).
		expect(http.StatusCreated).decode(&out)

	note := env.getNote(cookie, out.ID)
	if note.Title != "Journal Wednesday" {
		t.Errorf("title = %q", note.Title)
	}
	if !strings.Contains(note.Content, "## 2026-03-04") {
		t.Errorf("content = %q", note.Content)
	}
	if note.Tags != "journal" || note.Folder != "Journal" {
		t.Errorf("tags/folder = %q / %q", note.Tags, note.Folder)
	}
}

func TestGetAndListDailyNotes(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("dailylist@example.com")

	env.do(http.MethodGet, "/api/notes/daily?date=2026-03-04", nil, cookie).expect(http.StatusNotFound)
	env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-04"}, cookie).expect(http.StatusCreated)
	env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-05"}, cookie).expect(http.StatusCreated)

	var note noteDTO
	env.do(http.MethodGet, "/api/notes/daily?date=2026-03-04", nil, cookie).
		expect(http.StatusOK).decode(&note)
	if note.DailyDate != "2026-03-04" {
		t.Errorf("daily note = %+v", note)
	}

	var list []struct {
		Date string `json:"date"`
	}
	env.do(http.MethodGet, "/api/notes/daily/list", nil, cookie).expect(http.StatusOK).decode(&list)
	if len(list) != 2 || list[0].Date != "2026-03-05" {
		t.Errorf("daily list = %+v, want newest first", list)
	}
}

func TestTrashedDailyNoteCanBeRecreated(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("dailytrash@example.com")

	var first struct {
		ID int64 `json:"id"`
	}
	env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-04"}, cookie).
		expect(http.StatusCreated).decode(&first)
	env.do(http.MethodDelete, "/api/notes/"+itoa(first.ID), nil, cookie).expect(http.StatusNoContent)

	// The unique index covers trashed rows too, so this must not 500.
	res := env.do(http.MethodPost, "/api/notes/daily", gin.H{"date": "2026-03-04"}, cookie)
	if res.Code != http.StatusCreated && res.Code != http.StatusOK {
		t.Fatalf("reopening a trashed day returned %d: %s", res.Code, string(res.Body))
	}
}

func TestTemplatesAreScopedPerUser(t *testing.T) {
	env := newTestEnv(t)
	_, alice := env.user("alice-tpl@example.com")
	_, bob := env.user("bob-tpl@example.com")

	id := env.createTemplate(alice, gin.H{"name": "Private", "content": "secret"})

	var list []templateDTO
	env.do(http.MethodGet, "/api/templates", nil, bob).expect(http.StatusOK).decode(&list)
	if len(list) != 0 {
		t.Errorf("another user's templates leaked: %+v", list)
	}
	env.do(http.MethodPost, "/api/templates/"+itoa(id)+"/apply", nil, bob).expect(http.StatusNotFound)
	env.do(http.MethodDelete, "/api/templates/"+itoa(id), nil, bob).expect(http.StatusNotFound)
}
