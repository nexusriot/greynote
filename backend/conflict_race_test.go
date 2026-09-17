package main

import (
	"net/http"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

// Optimistic concurrency promises that of two clients holding the same base
// version, exactly one save is accepted. Checking the version with a SELECT and
// then writing with a separate UPDATE leaves a window where both pass the check
// and the second silently overwrites the first, so the guard has to live in the
// WHERE clause of the write.
func TestConcurrentSavesFromSameBaseVersionAcceptExactlyOne(t *testing.T) {
	const (
		rounds  = 30
		writers = 8
	)

	for round := 0; round < rounds; round++ {
		env := newTestEnv(t)
		_, cookie := env.user("race@example.com")
		id := env.createNote(cookie, "Note", "v1", "")
		base := env.getNote(cookie, id).UpdatedAt

		codes := make([]int, writers)
		bodies := make([]string, writers)
		start := make(chan struct{})

		var wg sync.WaitGroup
		for i := 0; i < writers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				res := env.do(http.MethodPut, "/api/notes/"+itoa(id),
					gin.H{"title": "Note", "content": bodies[i]}, cookie,
					[2]string{"If-Match", base})
				codes[i] = res.Code
			}(i)
		}
		for i := range bodies {
			bodies[i] = "writer " + itoa(int64(i))
		}
		close(start)
		wg.Wait()

		accepted := 0
		for _, code := range codes {
			switch code {
			case http.StatusOK:
				accepted++
			case http.StatusConflict:
			default:
				t.Fatalf("round %d: unexpected status %d (all: %v)", round, code, codes)
			}
		}
		if accepted != 1 {
			t.Fatalf("round %d: %d of %d concurrent saves from the same base version were accepted, want exactly 1 (%v)",
				round, accepted, writers, codes)
		}
	}
}

// A save that loses the race must leave no trace: the note keeps the winner's
// body, and the loser contributes no history entry.
func TestRejectedSaveWritesNoVersion(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("norace@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	stale := env.getNote(cookie, id).UpdatedAt

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "winner"}, cookie,
		[2]string{"If-Match", stale}).expect(http.StatusOK)

	var afterWinner []struct {
		ID int64 `json:"id"`
	}
	env.do(http.MethodGet, "/api/notes/"+itoa(id)+"/versions", nil, cookie).
		expect(http.StatusOK).decode(&afterWinner)

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "loser"}, cookie,
		[2]string{"If-Match", stale}).expect(http.StatusConflict)

	var afterLoser []struct {
		ID int64 `json:"id"`
	}
	env.do(http.MethodGet, "/api/notes/"+itoa(id)+"/versions", nil, cookie).
		expect(http.StatusOK).decode(&afterLoser)

	if len(afterLoser) != len(afterWinner) {
		t.Errorf("a rejected save added %d history entries, want 0", len(afterLoser)-len(afterWinner))
	}
	if got := env.getNote(cookie, id).Content; got != "winner" {
		t.Errorf("content = %q, want the accepted save to stand", got)
	}
}

// A note that really is gone still reads as 404, not as a conflict.
func TestUpdateWithIfMatchOnMissingNoteIsNotFound(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("missing@example.com")

	id := env.createNote(cookie, "Note", "v1", "")
	stamp := env.getNote(cookie, id).UpdatedAt
	env.do(http.MethodDelete, "/api/notes/"+itoa(id), nil, cookie).expect(http.StatusNoContent)

	env.do(http.MethodPut, "/api/notes/"+itoa(id),
		gin.H{"title": "Note", "content": "x"}, cookie,
		[2]string{"If-Match", stamp}).expect(http.StatusNotFound)
}

// Without a base version the old last-write-wins behaviour has to survive, so
// clients that cannot send one keep working.
func TestConcurrentSavesWithoutBaseVersionAllSucceed(t *testing.T) {
	env := newTestEnv(t)
	_, cookie := env.user("lww@example.com")
	id := env.createNote(cookie, "Note", "v1", "")

	const writers = 6
	codes := make([]int, writers)
	start := make(chan struct{})

	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			codes[i] = env.do(http.MethodPut, "/api/notes/"+itoa(id),
				gin.H{"title": "Note", "content": "anything"}, cookie).Code
		}(i)
	}
	close(start)
	wg.Wait()

	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("writer %d got %d, want 200 — a client that sends no version must not see conflicts", i, code)
		}
	}
}
