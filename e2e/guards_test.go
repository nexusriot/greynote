// The route inventory and the guards around it.
//
// routes below lists the server's whole HTTP surface. Two things hang off it:
// every authenticated route is probed without a session (and every admin route
// with a plain one), and TestMain fails the run if the suite finished without
// ever calling one of them. Adding an endpoint to the server therefore means
// adding it here, and covering it somewhere in the suite.
package e2e

import (
	"flag"
	"net/http"
	"sort"
	"strings"
	"sync"
	"testing"
)

type access int

const (
	// public routes answer without a session.
	public access = iota
	// session routes need a signed-in user.
	session
	// admin routes need a user with the admin flag.
	admin
)

type route struct {
	Method string
	// Path is the pattern as buildRouter registers it, with a concrete value
	// substituted for each parameter: the guards abort before any handler
	// looks at an id, so the values need not exist.
	Path   string
	Access access
}

var routes = []route{
	{http.MethodGet, "/health", public},
	{http.MethodGet, "/api/version", public},
	{http.MethodPost, "/api/login", public},
	{http.MethodPost, "/api/logout", public},
	{http.MethodGet, "/api/share/:token", public},
	{http.MethodGet, "/api/images/:filename", public},

	{http.MethodGet, "/api/admin/users", admin},
	{http.MethodPost, "/api/admin/users", admin},
	{http.MethodPut, "/api/admin/users/:id/admin", admin},
	{http.MethodDelete, "/api/admin/users/:id", admin},

	{http.MethodGet, "/api/me", session},
	{http.MethodPut, "/api/account/password", session},
	{http.MethodDelete, "/api/account", session},

	{http.MethodGet, "/api/notes", session},
	{http.MethodPost, "/api/notes", session},
	{http.MethodGet, "/api/notes/:id", session},
	{http.MethodPut, "/api/notes/:id", session},
	{http.MethodDelete, "/api/notes/:id", session},
	{http.MethodGet, "/api/notes/export", session},
	{http.MethodGet, "/api/notes/stats", session},
	{http.MethodGet, "/api/notes/search", session},
	{http.MethodPost, "/api/notes/import", session},
	{http.MethodGet, "/api/notes/daily", session},
	{http.MethodPost, "/api/notes/daily", session},
	{http.MethodGet, "/api/notes/daily/list", session},
	{http.MethodGet, "/api/notes/trash", session},
	{http.MethodDelete, "/api/notes/trash", session},
	{http.MethodPost, "/api/notes/:id/pin", session},
	{http.MethodPost, "/api/notes/:id/restore", session},
	{http.MethodDelete, "/api/notes/:id/purge", session},
	{http.MethodGet, "/api/notes/:id/links", session},
	{http.MethodGet, "/api/notes/:id/versions", session},
	{http.MethodGet, "/api/notes/:id/versions/:vid", session},
	{http.MethodPost, "/api/notes/:id/share", session},
	{http.MethodPost, "/api/notes/:id/share/disable", session},
	{http.MethodPut, "/api/notes/:id/share/password", session},
	{http.MethodPut, "/api/notes/:id/share/expiry", session},

	{http.MethodPost, "/api/images", session},

	{http.MethodGet, "/api/folders", session},
	{http.MethodPut, "/api/folders", session},
	{http.MethodDelete, "/api/folders", session},

	{http.MethodGet, "/api/templates", session},
	{http.MethodPost, "/api/templates", session},
	{http.MethodPut, "/api/templates/:id", session},
	{http.MethodDelete, "/api/templates/:id", session},
	{http.MethodPost, "/api/templates/:id/apply", session},

	{http.MethodGet, "/api/tags", session},
	{http.MethodPut, "/api/tags/:name", session},
	{http.MethodPost, "/api/tags/merge", session},
	{http.MethodDelete, "/api/tags/:name", session},

	{http.MethodGet, "/api/sessions", session},
	{http.MethodDelete, "/api/sessions/:id", session},
}

// ------------------------------------------------------- coverage tracking ---

var (
	calledMu sync.Mutex
	called   = map[string]bool{}
)

// recordRoute notes that the suite called an endpoint. Every request the
// harness makes goes through it.
func recordRoute(method, path string) {
	calledMu.Lock()
	defer calledMu.Unlock()
	called[method+" "+routePattern(path)] = true
}

// routePattern turns a request path back into the pattern the router
// registered: "/api/notes/12/versions/3?full=1" becomes
// "/api/notes/:id/versions/:vid".
func routePattern(rawPath string) string {
	path := rawPath
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}

	// The segment before a value says what it is, so a tag or a folder named
	// "2026" is not mistaken for an id.
	segments := strings.Split(strings.Trim(path, "/"), "/")
	for i, segment := range segments {
		if i == 0 {
			continue
		}
		switch segments[i-1] {
		case "versions":
			if isNumeric(segment) {
				segments[i] = ":vid"
			}
		case "notes", "templates", "sessions", "users":
			if isNumeric(segment) {
				segments[i] = ":id"
			}
		// Only the public routes have their parameter right after the noun:
		// "/api/notes/:id/share/disable" must not read as a token.
		case "share":
			if i == 2 {
				segments[i] = ":token"
			}
		case "images":
			if i == 2 {
				segments[i] = ":filename"
			}
		case "tags":
			if i == 2 && segment != "merge" {
				segments[i] = ":name"
			}
		}
	}
	return "/" + strings.Join(segments, "/")
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// uncoveredRoutes lists the inventoried routes the suite never called. A -run
// filter deliberately picks a subset, so the gate stands down for one.
func uncoveredRoutes() []route {
	if f := flag.Lookup("test.run"); f != nil && f.Value.String() != "" {
		return nil
	}

	calledMu.Lock()
	defer calledMu.Unlock()

	missing := []route{}
	for _, r := range routes {
		if !called[r.Method+" "+r.Path] {
			missing = append(missing, r)
		}
	}
	sort.Slice(missing, func(i, j int) bool {
		if missing[i].Path == missing[j].Path {
			return missing[i].Method < missing[j].Method
		}
		return missing[i].Path < missing[j].Path
	})
	return missing
}

// probePath fills a pattern's parameters in so the request can be sent. The
// values are arbitrary: a guard answers before the handler reads them.
func probePath(pattern string) string {
	replacer := strings.NewReplacer(
		":id", "1",
		":vid", "1",
		":name", "probe",
		":token", "probe-token",
		":filename", "probe.png",
	)
	return replacer.Replace(pattern)
}

// ------------------------------------------------------------------ tests ---

// TestRouteInventoryIsComplete is a tripwire: the counts change the moment a
// route is added to the server without being inventoried here.
func TestRouteInventoryIsComplete(t *testing.T) {
	counts := map[access]int{}
	seen := map[string]bool{}
	for _, r := range routes {
		key := r.Method + " " + r.Path
		if seen[key] {
			t.Errorf("%s is listed twice", key)
		}
		seen[key] = true
		counts[r.Access]++
	}

	for _, want := range []struct {
		kind  access
		label string
		count int
	}{
		{public, "public", 6},
		{session, "authenticated", 42},
		{admin, "admin-only", 4},
	} {
		if counts[want.kind] != want.count {
			t.Errorf("%s routes = %d, want %d — update the inventory and cover the new endpoint",
				want.label, counts[want.kind], want.count)
		}
	}
}

// TestRoutePatternNormalisesRequests guards the coverage gate itself: the
// rewriting is what decides whether a request counts as covering a route, and
// getting it wrong (reading "disable" as a share token, say) would either
// credit a route nothing called or fail a run that covered everything.
func TestRoutePatternNormalisesRequests(t *testing.T) {
	cases := map[string]string{
		"/api/notes":                       "/api/notes",
		"/api/notes?tag=work&limit=2":      "/api/notes",
		"/api/notes/12":                    "/api/notes/:id",
		"/api/notes/12/versions":           "/api/notes/:id/versions",
		"/api/notes/12/versions/3":         "/api/notes/:id/versions/:vid",
		"/api/notes/12/share":              "/api/notes/:id/share",
		"/api/notes/12/share/disable":      "/api/notes/:id/share/disable",
		"/api/notes/12/share/password":     "/api/notes/:id/share/password",
		"/api/notes/12/share/expiry":       "/api/notes/:id/share/expiry",
		"/api/notes/daily":                 "/api/notes/daily",
		"/api/notes/daily?date=2026-04-07": "/api/notes/daily",
		"/api/notes/daily/list":            "/api/notes/daily/list",
		"/api/notes/export":                "/api/notes/export",
		"/api/notes/trash":                 "/api/notes/trash",
		"/api/admin/users":                 "/api/admin/users",
		"/api/admin/users/3":               "/api/admin/users/:id",
		"/api/admin/users/3/admin":         "/api/admin/users/:id/admin",
		"/api/sessions/7":                  "/api/sessions/:id",
		"/api/templates/9/apply":           "/api/templates/:id/apply",
		"/api/tags/merge":                  "/api/tags/merge",
		"/api/tags/work":                   "/api/tags/:name",
		"/api/tags/project%2Falpha":        "/api/tags/:name",
		// A tag or folder named like a number is still a name.
		"/api/tags/2026":         "/api/tags/:name",
		"/api/folders?path=Work": "/api/folders",
		"/api/share/abc123":      "/api/share/:token",
		"/api/images/abc123.png": "/api/images/:filename",
		"/health":                "/health",
	}

	for request, want := range cases {
		if got := routePattern(request); got != want {
			t.Errorf("routePattern(%q) = %q, want %q", request, got, want)
		}
	}
}

func TestEveryGuardedRouteRefusesAnonymousCallers(t *testing.T) {
	anonymous := newClient(t).probing()

	for _, r := range routes {
		if r.Access == public {
			continue
		}
		// A body keeps the request well-formed for the routes that bind one;
		// the guard runs first either way.
		anonymous.do(r.Method, probePath(r.Path), map[string]any{}).expect(http.StatusUnauthorized)
	}
}

func TestAdminRoutesRefuseOrdinaryUsers(t *testing.T) {
	member := newAccount(t, "member")
	member.probing()

	for _, r := range routes {
		if r.Access != admin {
			continue
		}
		member.do(r.Method, probePath(r.Path), map[string]any{}).expect(http.StatusForbidden)
	}
}

// TestCORSAnswersTheConfiguredOriginOnly pins the browser contract: the web
// client is served from another origin and sends its session cookie, which the
// browser only allows when the server names that origin explicitly.
func TestCORSAnswersTheConfiguredOriginOnly(t *testing.T) {
	c := newClient(t)

	const allowed = "http://localhost:5173"
	res := c.do(http.MethodOptions, "/api/notes", nil, [2]string{"Origin", allowed})
	res.expect(http.StatusNoContent)
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != allowed {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, allowed)
	}
	if got := res.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
	}
	if got := res.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodDelete) {
		t.Errorf("Access-Control-Allow-Methods = %q, want the write verbs", got)
	}

	foreign := c.do(http.MethodOptions, "/api/notes", nil, [2]string{"Origin", "http://evil.example"})
	foreign.expect(http.StatusNoContent)
	if got := foreign.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("a foreign origin was allowed: %q", got)
	}
}
