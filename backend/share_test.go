package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func (e *testEnv) enableShare(cookie *http.Cookie, id int64, body any) string {
	e.t.Helper()

	var out struct {
		Token string `json:"token"`
	}
	e.do(http.MethodPost, "/api/notes/"+itoa(id)+"/share", body, cookie).
		expect(http.StatusOK).decode(&out)
	return out.Token
}

func TestShareLinkExpiryIsEnforced(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("share@example.com")

	id := env.createNote(cookie, "Shared", "body", "")
	token := env.enableShare(cookie, id, gin.H{"expiresAt": "2020-01-01T00:00:00Z"})

	env.do(http.MethodGet, "/api/share/"+token, nil, nil).expect(http.StatusGone)
}

// Turning sharing off and on again keeps the same token on purpose. It must
// keep the expiry too: an owner who parked a link is not asking to republish it
// past the date they chose.
func TestReEnablingShareKeepsTheExpiry(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("reenable@example.com")

	id := env.createNote(cookie, "Shared", "body", "")
	token := env.enableShare(cookie, id, gin.H{"expiresAt": "2020-01-01T00:00:00Z"})
	env.do(http.MethodGet, "/api/share/"+token, nil, nil).expect(http.StatusGone)

	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/share/disable", nil, cookie).
		expect(http.StatusNoContent)

	// The Android client sends no expiresAt at all when it re-enables a link.
	if again := env.enableShare(cookie, id, gin.H{}); again != token {
		t.Errorf("re-enabling handed out a new token %q, want the original %q", again, token)
	}
	env.do(http.MethodGet, "/api/share/"+token, nil, nil).expect(http.StatusGone)

	if got := env.getNote(cookie, id).ShareExpiresAt; got == "" {
		t.Error("the expiry was dropped when the link was re-enabled")
	}
}

// Clearing an expiry stays possible — it is just an explicit act, through the
// endpoint that exists for it.
func TestShareExpiryCanBeClearedExplicitly(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("clearexpiry@example.com")

	id := env.createNote(cookie, "Shared", "body", "")
	token := env.enableShare(cookie, id, gin.H{"expiresAt": "2020-01-01T00:00:00Z"})
	env.do(http.MethodGet, "/api/share/"+token, nil, nil).expect(http.StatusGone)

	env.do(http.MethodPut, "/api/notes/"+itoa(id)+"/share/expiry",
		gin.H{"expiresAt": ""}, cookie).expect(http.StatusNoContent)

	env.do(http.MethodGet, "/api/share/"+token, nil, nil).expect(http.StatusOK)
	if got := env.getNote(cookie, id).ShareExpiresAt; got != "" {
		t.Errorf("expiry = %q, want it cleared", got)
	}
}

// An expiresAt sent explicitly still overwrites the stored one, so a client
// that does pass a date is in charge.
func TestEnablingShareWithExpiryOverwritesTheStoredOne(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("overwrite@example.com")

	id := env.createNote(cookie, "Shared", "body", "")
	token := env.enableShare(cookie, id, gin.H{"expiresAt": "2020-01-01T00:00:00Z"})

	future := time.Now().UTC().Add(48 * time.Hour).Format(time.RFC3339)
	env.enableShare(cookie, id, gin.H{"expiresAt": future})

	env.do(http.MethodGet, "/api/share/"+token, nil, nil).expect(http.StatusOK)
}

func TestEnablingShareRejectsAnUnparsableExpiry(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("badexpiry@example.com")

	id := env.createNote(cookie, "Shared", "body", "")
	env.do(http.MethodPost, "/api/notes/"+itoa(id)+"/share",
		gin.H{"expiresAt": "next tuesday"}, cookie).expect(http.StatusBadRequest)
}
