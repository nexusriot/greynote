// Coverage for the account surface: the admin user routes, self-service
// password change and account closure, and the session list.
package e2e

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

type adminUser struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	IsAdmin   bool   `json:"isAdmin"`
	CreatedAt string `json:"createdAt"`
}

type sessionRow struct {
	ID        int64  `json:"id"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
	IsCurrent bool   `json:"isCurrent"`
}

// users returns the admin user list keyed by email.
func (c *client) users() map[string]adminUser {
	c.t.Helper()

	var rows []adminUser
	c.do(http.MethodGet, "/api/admin/users", nil).expect(http.StatusOK).decode(&rows)
	out := make(map[string]adminUser, len(rows))
	for _, row := range rows {
		out[row.Email] = row
	}
	return out
}

func (c *client) sessions() []sessionRow {
	c.t.Helper()

	var rows []sessionRow
	c.do(http.MethodGet, "/api/sessions", nil).expect(http.StatusOK).decode(&rows)
	return rows
}

func TestAdminManagesUsers(t *testing.T) {
	c := newClient(t)
	c.login()

	created := fmt.Sprintf("managed-%d@example.com", time.Now().UnixNano())
	c.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": created, "password": "tiny"}).expect(http.StatusBadRequest)
	c.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": created, "password": "password123"}).expect(http.StatusCreated)
	c.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": created, "password": "password123"}).expect(http.StatusBadRequest)

	listed := c.users()
	member, ok := listed[created]
	if !ok {
		t.Fatalf("the new user is missing from the list of %d", len(listed))
	}
	if member.IsAdmin || member.CreatedAt == "" {
		t.Errorf("new user = %+v, want a plain user with a creation stamp", member)
	}
	if me := listed[email]; !me.IsAdmin {
		t.Errorf("the calling admin should be listed as one, got %+v", me)
	}

	// The admin flag is what opens the admin routes, and it can be taken back.
	their := newClient(t)
	their.do(http.MethodPost, "/api/login",
		map[string]string{"email": created, "password": "password123"}).expect(http.StatusNoContent)
	their.do(http.MethodGet, "/api/admin/users", nil).expect(http.StatusForbidden)

	c.do(http.MethodPut, fmt.Sprintf("/api/admin/users/%d/admin", member.ID),
		map[string]any{"isAdmin": true}).expect(http.StatusNoContent)
	their.do(http.MethodGet, "/api/admin/users", nil).expect(http.StatusOK)

	c.do(http.MethodPut, fmt.Sprintf("/api/admin/users/%d/admin", member.ID),
		map[string]any{"isAdmin": false}).expect(http.StatusNoContent)
	their.do(http.MethodGet, "/api/admin/users", nil).expect(http.StatusForbidden)

	// An admin cannot lock themselves out, and unknown users are 404.
	var me struct {
		UserID int64 `json:"userId"`
	}
	c.do(http.MethodGet, "/api/me", nil).expect(http.StatusOK).decode(&me)
	c.do(http.MethodPut, fmt.Sprintf("/api/admin/users/%d/admin", me.UserID),
		map[string]any{"isAdmin": false}).expect(http.StatusBadRequest)
	c.do(http.MethodDelete, fmt.Sprintf("/api/admin/users/%d", me.UserID), nil).expect(http.StatusBadRequest)
	c.do(http.MethodPut, "/api/admin/users/9999999/admin",
		map[string]any{"isAdmin": true}).expect(http.StatusNotFound)
	c.do(http.MethodDelete, "/api/admin/users/9999999", nil).expect(http.StatusNotFound)

	// Deleting a user takes their notes and their session with them.
	their.createNote(map[string]any{"title": "Member note", "content": "goes with the account"})
	c.do(http.MethodDelete, fmt.Sprintf("/api/admin/users/%d", member.ID), nil).expect(http.StatusNoContent)
	their.do(http.MethodGet, "/api/notes", nil).expect(http.StatusUnauthorized)
	if _, ok := c.users()[created]; ok {
		t.Error("the deleted user is still listed")
	}
	newClient(t).do(http.MethodPost, "/api/login",
		map[string]string{"email": created, "password": "password123"}).expect(http.StatusUnauthorized)
}

func TestAccountPasswordCanBeChanged(t *testing.T) {
	acct := newAccount(t, "password")
	const next = "another-password"

	acct.do(http.MethodPut, "/api/account/password",
		map[string]string{"currentPassword": acct.Password, "newPassword": "tiny"}).
		expect(http.StatusBadRequest)
	acct.do(http.MethodPut, "/api/account/password",
		map[string]string{"currentPassword": "not my password", "newPassword": next}).
		expect(http.StatusUnauthorized)
	acct.do(http.MethodPut, "/api/account/password",
		map[string]string{"currentPassword": acct.Password, "newPassword": next}).
		expect(http.StatusNoContent)

	fresh := newClient(t)
	fresh.do(http.MethodPost, "/api/login",
		map[string]string{"email": acct.Email, "password": acct.Password}).expect(http.StatusUnauthorized)
	fresh.do(http.MethodPost, "/api/login",
		map[string]string{"email": acct.Email, "password": next}).expect(http.StatusNoContent)

	// The session that made the change stays signed in.
	acct.do(http.MethodGet, "/api/me", nil).expect(http.StatusOK)
}

func TestAccountCanBeClosed(t *testing.T) {
	acct := newAccount(t, "closing")
	acct.createNote(map[string]any{"title": "Going away", "content": "closed with the account"})

	acct.do(http.MethodDelete, "/api/account", map[string]string{"password": "not my password"}).
		expect(http.StatusUnauthorized)
	acct.do(http.MethodDelete, "/api/account", map[string]string{"password": acct.Password}).
		expect(http.StatusNoContent)

	acct.do(http.MethodGet, "/api/me", nil).expect(http.StatusUnauthorized)
	newClient(t).do(http.MethodPost, "/api/login",
		map[string]string{"email": acct.Email, "password": acct.Password}).expect(http.StatusUnauthorized)

	admin := newClient(t)
	admin.login()
	if _, ok := admin.users()[acct.Email]; ok {
		t.Error("the closed account is still listed")
	}

	// The address is free again, and the notes went with the account: a new
	// user on the same email starts empty.
	admin.do(http.MethodPost, "/api/admin/users",
		map[string]any{"email": acct.Email, "password": acct.Password}).expect(http.StatusCreated)
	reborn := newClient(t)
	reborn.do(http.MethodPost, "/api/login",
		map[string]string{"email": acct.Email, "password": acct.Password}).expect(http.StatusNoContent)

	var notes []note
	reborn.do(http.MethodGet, "/api/notes", nil).expect(http.StatusOK).decode(&notes)
	if len(notes) != 0 {
		t.Errorf("the new account inherited %d notes", len(notes))
	}
}

func TestSessionsAreListedAndRevocable(t *testing.T) {
	acct := newAccount(t, "sessions")
	elsewhere := acct.signIn(t)

	listed := acct.sessions()
	if len(listed) != 2 {
		t.Fatalf("expected two sessions, got %+v", listed)
	}
	current, otherID := 0, int64(0)
	for _, s := range listed {
		if s.IsCurrent {
			current++
		} else {
			otherID = s.ID
		}
		if s.CreatedAt == "" || s.ExpiresAt == "" {
			t.Errorf("session %+v is missing its timestamps", s)
		}
	}
	if current != 1 {
		t.Fatalf("exactly one session should be flagged current, got %d of %+v", current, listed)
	}

	// Revoking the other device signs it out, and the id is then gone.
	acct.do(http.MethodDelete, fmt.Sprintf("/api/sessions/%d", otherID), nil).expect(http.StatusNoContent)
	elsewhere.do(http.MethodGet, "/api/notes", nil).expect(http.StatusUnauthorized)
	acct.do(http.MethodDelete, fmt.Sprintf("/api/sessions/%d", otherID), nil).expect(http.StatusNotFound)

	mine := acct.sessions()
	if len(mine) != 1 || !mine[0].IsCurrent {
		t.Fatalf("one current session should be left, got %+v", mine)
	}

	// Another account cannot revoke it.
	stranger := newAccount(t, "stranger")
	stranger.do(http.MethodDelete, fmt.Sprintf("/api/sessions/%d", mine[0].ID), nil).expect(http.StatusNotFound)
	acct.do(http.MethodGet, "/api/me", nil).expect(http.StatusOK)

	// Revoking your own current session is a sign-out.
	acct.do(http.MethodDelete, fmt.Sprintf("/api/sessions/%d", mine[0].ID), nil).expect(http.StatusNoContent)
	acct.do(http.MethodGet, "/api/me", nil).expect(http.StatusUnauthorized)
}
