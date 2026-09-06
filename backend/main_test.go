package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	gin.DefaultWriter = io.Discard
	gin.DefaultErrorWriter = io.Discard
	os.Exit(m.Run())
}

// testEnv is a full server (router + database) backed by a temporary file, so
// tests exercise the same routes and middleware production uses.
type testEnv struct {
	t      *testing.T
	DB     *sql.DB
	Router *gin.Engine
	Cfg    Config
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	return newTestEnvWithConfig(t, func(cfg *Config) {})
}

func newTestEnvWithRetention(t *testing.T, retention time.Duration) *testEnv {
	t.Helper()
	return newTestEnvWithConfig(t, func(cfg *Config) { cfg.TrashRetention = retention })
}

func newTestEnvWithVersions(t *testing.T, maxVersions int) *testEnv {
	t.Helper()
	return newTestEnvWithConfig(t, func(cfg *Config) { cfg.MaxNoteVersions = maxVersions })
}

func newTestEnvWithConfig(t *testing.T, customise func(*Config)) *testEnv {
	t.Helper()

	dir := t.TempDir()
	cfg := Config{
		SQLitePath:      filepath.Join(dir, "test.db"),
		ImagesDir:       filepath.Join(dir, "images"),
		CookieName:      "notes_session",
		SessionTTL:      time.Hour,
		TrashRetention:  30 * 24 * time.Hour,
		MaxNoteVersions: 50,
		ImageGCGrace:    7 * 24 * time.Hour,
	}
	customise(&cfg)
	if err := os.MkdirAll(cfg.ImagesDir, 0755); err != nil {
		t.Fatal(err)
	}

	db, err := openDB(cfg.SQLitePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	if err := initSearch(db); err != nil {
		t.Fatal(err)
	}

	return &testEnv{t: t, DB: db, Router: buildRouter(db, cfg), Cfg: cfg}
}

// request runs a call and hands back the raw recorder, for tests that care
// about headers rather than the body.
func (e *testEnv) request(method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	e.t.Helper()

	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	e.Router.ServeHTTP(rec, req)
	return rec
}

// user creates an account and returns its id together with a session cookie.
func (e *testEnv) user(email string) (int64, *http.Cookie) {
	e.t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	if err != nil {
		e.t.Fatal(err)
	}
	res, err := e.DB.Exec(
		`INSERT INTO users(email, password_hash, is_admin, created_at) VALUES(?,?,0,?)`,
		email, string(hash), nowRFC3339())
	if err != nil {
		e.t.Fatal(err)
	}
	userID, _ := res.LastInsertId()

	token, err := randomTokenURLSafe(32)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.DB.Exec(
		`INSERT INTO sessions(user_id, token, expires_at, created_at) VALUES(?,?,?,?)`,
		userID, token, time.Now().UTC().Add(time.Hour).Format(time.RFC3339), nowRFC3339(),
	); err != nil {
		e.t.Fatal(err)
	}
	return userID, &http.Cookie{Name: e.Cfg.CookieName, Value: token}
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

type response struct {
	t    *testing.T
	Code int
	Body []byte
}

func (r *response) decode(v any) {
	r.t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		r.t.Fatalf("decoding %q: %v", string(r.Body), err)
	}
}

func (r *response) expect(code int) *response {
	r.t.Helper()
	if r.Code != code {
		r.t.Fatalf("expected status %d, got %d (body: %s)", code, r.Code, string(r.Body))
	}
	return r
}

func (e *testEnv) do(method, path string, body any, cookie *http.Cookie, headers ...[2]string) *response {
	e.t.Helper()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	for _, h := range headers {
		req.Header.Set(h[0], h[1])
	}

	rec := httptest.NewRecorder()
	e.Router.ServeHTTP(rec, req)
	return &response{t: e.t, Code: rec.Code, Body: rec.Body.Bytes()}
}

// upload posts a single multipart file to path under the field name "file".
func (e *testEnv) upload(path, filename string, content []byte, cookie *http.Cookie) *response {
	e.t.Helper()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		e.t.Fatal(err)
	}
	w.Close()

	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if cookie != nil {
		req.AddCookie(cookie)
	}

	rec := httptest.NewRecorder()
	e.Router.ServeHTTP(rec, req)
	return &response{t: e.t, Code: rec.Code, Body: rec.Body.Bytes()}
}

// createNote posts a note and returns its id.
func (e *testEnv) createNote(cookie *http.Cookie, title, content, tags string) int64 {
	e.t.Helper()

	res := e.do(http.MethodPost, "/api/notes", gin.H{
		"title": title, "content": content, "tags": tags,
	}, cookie).expect(http.StatusCreated)

	var out struct {
		ID int64 `json:"id"`
	}
	res.decode(&out)
	return out.ID
}

func (e *testEnv) getNote(cookie *http.Cookie, id int64) noteDTO {
	e.t.Helper()

	var n noteDTO
	e.do(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil, cookie).expect(http.StatusOK).decode(&n)
	return n
}

func (e *testEnv) listNotes(cookie *http.Cookie, query string) []noteDTO {
	e.t.Helper()

	var notes []noteDTO
	e.do(http.MethodGet, "/api/notes"+query, nil, cookie).expect(http.StatusOK).decode(&notes)
	return notes
}
