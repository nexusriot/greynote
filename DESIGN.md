# GreyNote — Design Document

## Overview

GreyNote is a self-hosted note-taking app built for simplicity and self-containment. The entire system is two Docker containers: a Go HTTP server and a Vite dev server. All persistent state lives in a single SQLite file. No external services, no message queues, no caches.

---

## Architecture

```
Browser
  │
  ├── GET /share/:token ──────────────────────────────► Go backend
  │                                                       (public, no auth)
  │
  └── All other requests
        │
        ▼
   Vite dev server (port 5173)
        │
        ├── Static assets (HTML/JS/CSS) → served by Vite
        │
        └── /api/* requests ──── proxied ──────────────► Go backend (port 8080)
                                                          │
                                                          └── SQLite file (/data/notes.db)
                                                              Images dir (/data/images/)
```

The Vite server proxies `/api` and `/health` to the backend via Docker's internal network (`http://backend:8080`). The browser only ever sees one origin (`:5173`), so cookies and CORS are straightforward.

### Why a dev server in production?

Vite is used as the production server for simplicity — no separate build step, no nginx. The trade-off is a larger frontend container image and slightly slower initial module resolution; acceptable for a self-hosted single-user or small-team app.

---

## Project structure

```
backend/
  main.go              — Config, main, buildRouter (complete route table)
  db.go                — Schema DDL, additive migrations, backfills, time helpers
  middleware.go        — CORSMiddleware, AuthRequired, getUserID
  admin_middleware.go  — AdminRequired
  admin_bootstrap.go   — ensureAdminUser (idempotent, runs on every startup)
  auth_handlers.go     — Login, Logout, Me, ChangePassword, DeleteAccount,
                         ListSessions, RevokeSession, admin user CRUD
  notes_handlers.go    — List, Create, Get, Update, Delete, TogglePin, Search,
                         ListVersions, GetVersion, CreateOrEnableShare,
                         DisableShare, SetSharePassword, SetShareExpiry,
                         ExportZip, Stats, GetShared
  search.go            — FTS5 index maintenance, query building, LIKE fallback
  tags.go              — setNoteTags (join table), tag list/rename/merge/delete
  links.go             — [[wiki link]] parsing, resolution, Links handler
  trash.go             — ListTrash, RestoreNote, PurgeNote, EmptyTrash, sweeper
  import_handlers.go   — Import (.md / .zip, YAML front matter)
  images_handlers.go   — Upload, Serve
  *_test.go            — handler-level tests against a temporary database
  Makefile             — build/test/vet with the sqlite_fts5 tag

frontend/src/
  App.jsx              — BrowserRouter, Shell (header, command palette), routes
  auth.jsx             — AuthContext: me, loading, logout
  theme.jsx/.css       — ThemeContext: dark/light toggle; CSS custom properties
  api.js               — apiFetch: thin fetch wrapper (JSON, cookie credentials)
  wikilinks.js         — [[link]] parsing and rewriting (code-aware)
  components/
    CommandPalette.jsx — Ctrl+K overlay: fuzzy search notes, keyboard nav
    MarkdownRenderer.jsx — ReactMarkdown with copy-code button, wiki links
    Snippet.jsx        — renders search excerpts with highlighted matches
  pages/
    Login.jsx          — POST /api/login
    Notes.jsx          — Note list, server-side search, tag filter, import/export
    NoteEdit.jsx       — Full editor: tags, pin, preview, images, sharing,
                         versions, links/backlinks, conflict resolution
    NewNote.jsx        — Creates a note and opens it (unresolved-link target)
    Tags.jsx           — Tag rename / merge / remove
    Trash.jsx          — Restore, delete forever, empty trash
    ShareView.jsx      — Public share viewer (no auth required)
    Sessions.jsx       — Active sessions list with per-session revoke
    Settings.jsx       — Change password, delete account
    Stats.jsx          — Aggregate stats + SVG bar chart + tag usage chart
    AdminUsers.jsx     — Admin user management
    Register.jsx       — (Admin-only user creation flow)

android/app/src/main/java/com/greynote/app/
  MainActivity.kt      — Compose entry point, sets up NavGraph
  api/
    ApiService.kt      — Retrofit interface (login, logout, me, notes CRUD, pin)
    ApiClient.kt       — OkHttp + Retrofit factory, PersistentCookieJar
    model/             — Auth.kt, Note.kt request/response DTOs
  data/Prefs.kt        — SharedPreferences: server URL persistence
  ui/
    NavGraph.kt        — login → notes → note-edit routes
    screen/            — LoginScreen, NotesScreen, NoteEditScreen
    component/         — MarkdownText (Compose markdown rendering)
    theme/             — Color, Theme, Type
  vm/                  — AuthViewModel, NotesViewModel, NoteEditViewModel
```

---

## Database schema

All tables are created with `CREATE TABLE IF NOT EXISTS`. Column additions to existing tables use an `addColumnIfMissing` helper (reads `PRAGMA table_info` then `ALTER TABLE ADD COLUMN`) because SQLite does not support `ADD COLUMN IF NOT EXISTS`. Indexes are created the same way (`CREATE INDEX IF NOT EXISTS`) and cover the hot paths: notes by user, session tokens, share tokens, versions by note, and both ends of the link graph.

Two backfills run at startup and are safe to re-run because each skips rows that already have derived data: `backfillTags` populates `tags`/`note_tags` from the legacy `notes.tags` string, and `backfillLinks` indexes `[[wiki links]]` in notes written before link tracking existed.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `email` | TEXT UNIQUE NOT NULL | lowercased and trimmed on write |
| `password_hash` | TEXT NOT NULL | bcrypt, default cost |
| `is_admin` | INTEGER NOT NULL DEFAULT 0 | 1 = admin |
| `created_at` | TEXT NOT NULL | RFC3339 UTC |

### `sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER NOT NULL | FK → users (CASCADE) |
| `token` | TEXT UNIQUE NOT NULL | 32 random bytes, base64url |
| `expires_at` | TEXT NOT NULL | RFC3339 UTC; default TTL 7 days |
| `created_at` | TEXT NOT NULL | RFC3339 UTC |

Sessions are validated on every authenticated request: token looked up, expiry checked, expired sessions deleted on the spot.

### `notes`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER NOT NULL | FK → users (CASCADE) |
| `title` | TEXT NOT NULL | |
| `content` | TEXT NOT NULL | Raw markdown |
| `tags` | TEXT NOT NULL DEFAULT '' | Denormalised cache of `note_tags` (added migration) |
| `is_pinned` | INTEGER NOT NULL DEFAULT 0 | 1 = pinned (added migration) |
| `deleted_at` | TEXT | RFC3339 UTC; NULL = live, non-NULL = in the trash (added migration) |
| `created_at` | TEXT NOT NULL | RFC3339 UTC, millisecond precision |
| `updated_at` | TEXT NOT NULL | RFC3339 UTC, millisecond precision; doubles as the note's version identifier |

Every query that lists, reads, searches, exports or shares a note filters on
`deleted_at IS NULL`.

### `tags` and `note_tags`

Tags are a real join table. `notes.tags` is kept in sync as a denormalised
comma-separated cache so API responses and clients need no changes.

| `tags` column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER NOT NULL | FK → users (CASCADE); tags are per-user |
| `name` | TEXT NOT NULL | lowercased, trimmed; UNIQUE per user |
| `created_at` | TEXT NOT NULL | RFC3339 UTC |

| `note_tags` column | Type | Notes |
|---|---|---|
| `note_id` | INTEGER NOT NULL | FK → notes (CASCADE) |
| `tag_id` | INTEGER NOT NULL | FK → tags (CASCADE) |
| `position` | INTEGER NOT NULL | preserves the order the user typed |

`setNoteTags` is the only writer: it rewrites the join rows, refreshes the
cache column, drops tags no note references any more, and reindexes the note
for search. Tag rename/merge/delete run every affected note back through it,
so there is one code path and no drift.

### `note_links`

One row per outgoing `[[wiki link]]`. Targets are stored by title and resolved
to ids separately, so a link to a note that does not exist yet survives until
that note appears.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `source_id` | INTEGER NOT NULL | FK → notes (CASCADE) |
| `target_id` | INTEGER | FK → notes (SET NULL); NULL = unresolved |
| `target_title` | TEXT NOT NULL | as written in the note; UNIQUE per source |
| `position` | INTEGER NOT NULL | order of appearance |

### `notes_fts`

An FTS5 virtual table (`title`, `content`, `tags`) whose `rowid` is the note id.
Maintained explicitly by `reindexNote` / `deindexNote` rather than by triggers,
because the tag cache and the trash flag both have to settle first.

### `note_versions`

Snapshot of a note's state taken just before each `UPDATE`. Used for version history.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `note_id` | INTEGER NOT NULL | FK → notes (CASCADE) |
| `title` | TEXT NOT NULL | |
| `content` | TEXT NOT NULL | |
| `tags` | TEXT NOT NULL DEFAULT '' | |
| `saved_at` | TEXT NOT NULL | Copied from `notes.updated_at` at snapshot time |

At most 50 versions are returned per note (newest first). Older versions are not automatically pruned — the LIMIT is on read, not on write.

### `share_links`

One row per note (UNIQUE on `note_id`). The token is generated once and never rotated; disabling sets `is_enabled=0` and re-enabling sets it back to 1.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `note_id` | INTEGER UNIQUE NOT NULL | FK → notes (CASCADE) |
| `token` | TEXT UNIQUE NOT NULL | 24 random bytes, base64url |
| `is_enabled` | INTEGER NOT NULL DEFAULT 1 | 0 = disabled |
| `created_at` | TEXT NOT NULL | RFC3339 UTC |
| `password_hash` | TEXT | bcrypt; NULL = no password (added migration) |
| `expires_at` | TEXT | RFC3339 UTC; NULL = never expires (added migration) |

---

## API reference

All routes under `/api`. Authenticated routes require a valid session cookie; unauthenticated requests get 401. Admin routes additionally require `is_admin = 1`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/login` | — | Email + password → set session cookie |
| POST | `/api/logout` | — | Delete session, clear cookie |
| GET | `/api/me` | ✓ | Returns `{userId, email, isAdmin}` |

### Account self-service

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/api/account/password` | ✓ | Change password (requires current password) |
| DELETE | `/api/account` | ✓ | Delete account (password-confirmed, cascade) |

### Sessions

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/sessions` | ✓ | List all sessions; flags current one |
| DELETE | `/api/sessions/:id` | ✓ | Revoke session by id (own sessions only) |

### Notes

Route registration order matters: static segments (`/notes/export`, `/notes/stats`, `/notes/search`, `/notes/trash`, `/notes/import`) are registered before the `:id` wildcard so Gin's radix tree doesn't shadow them.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/notes` | ✓ | List live notes (pinned first, then by `updated_at DESC`); `?tag=a,b` filters by tag (AND) |
| POST | `/api/notes` | ✓ | Create note; returns `{id}` |
| GET | `/api/notes/export` | ✓ | Download all notes as `notes-export.zip` (front-matter markdown) |
| GET | `/api/notes/search` | ✓ | `?q=` ranked full-text search; `?limit=` (default 50, max 200). Returns `{results, indexed}` |
| GET | `/api/notes/stats` | ✓ | Aggregate stats (counts, words, tags, monthly) |
| GET | `/api/notes/trash` | ✓ | List trashed notes with `deletedAt` and `purgeAt` |
| DELETE | `/api/notes/trash` | ✓ | Empty the trash; returns `{purged}` |
| POST | `/api/notes/import` | ✓ | Import a `.md` file or `.zip` archive; returns `{imported, skipped}` |
| GET | `/api/notes/:id` | ✓ | Get note (includes share info) |
| PUT | `/api/notes/:id` | ✓ | Update note. Honours `If-Match` (or `baseUpdatedAt` in the body): `409` if the note changed since. Snapshots the old state to `note_versions`, then returns `{updatedAt}` |
| DELETE | `/api/notes/:id` | ✓ | Move note to the trash (soft delete) |
| POST | `/api/notes/:id/restore` | ✓ | Restore a trashed note |
| DELETE | `/api/notes/:id/purge` | ✓ | Permanently delete a trashed note |
| GET | `/api/notes/:id/links` | ✓ | `{outgoing, backlinks}` for the note |
| POST | `/api/notes/:id/pin` | ✓ | Toggle `is_pinned` |
| GET | `/api/notes/:id/versions` | ✓ | List versions (newest first, max 50) |
| GET | `/api/notes/:id/versions/:vid` | ✓ | Get a specific version (full content) |
| POST | `/api/notes/:id/share` | ✓ | Enable share link (creates if new); optional `{expiresAt}` body |
| POST | `/api/notes/:id/share/disable` | ✓ | Disable share link (token preserved) |
| PUT | `/api/notes/:id/share/password` | ✓ | Set/clear share link password |
| PUT | `/api/notes/:id/share/expiry` | ✓ | Set/clear share link expiry date |

### Tags

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/tags` | ✓ | All of the user's tags with live-note counts |
| PUT | `/api/tags/:name` | ✓ | Rename a tag (`{name}`); merges if the target already exists |
| POST | `/api/tags/merge` | ✓ | `{from: [...], into}` — fold several tags into one |
| DELETE | `/api/tags/:name` | ✓ | Strip a tag from every note that carries it |

All three mutations return `{notesUpdated}`.

### Sharing (public)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/share/:token` | — | Fetch shared note. Returns 401 `{requiresPassword: true}` if password needed; 403 if wrong password (via `X-Share-Password` header); 410 if expired; 404 if disabled/missing |

### Images

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/images` | ✓ | Upload image (multipart `file` field); returns `{url}` |
| GET | `/api/images/:filename` | — | Serve stored image (public, so shared notes can embed them) |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | ✓ admin | List all users |
| POST | `/api/admin/users` | ✓ admin | Create user |
| PUT | `/api/admin/users/:id/admin` | ✓ admin | Set/clear admin flag |
| DELETE | `/api/admin/users/:id` | ✓ admin | Delete user (cascade) |

---

## Authentication

### Login flow

1. Client POSTs `{email, password}` to `/api/login`
2. Server verifies bcrypt hash
3. Server generates a 32-byte random token (base64url), inserts a `sessions` row with `expires_at = now + SESSION_TTL_HOURS`
4. Server sets an `HttpOnly, SameSite=Lax` cookie (`Secure` if `COOKIE_SECURE=1`)
5. All subsequent requests carry the cookie automatically

### Per-request validation (`AuthRequired` middleware)

1. Read token from cookie — 401 if missing
2. Query `sessions` by token — 401 if not found
3. Compare `expires_at` to `time.Now().UTC()` — 401 and delete row if expired
4. Set `userID` in Gin context; handler calls `getUserID(c)`

### Password storage

bcrypt at default cost (10 rounds). No plaintext passwords are ever stored or logged.

### Admin bootstrap

`ensureAdminUser` runs synchronously before the HTTP server starts. If `ADMIN_EMAIL` / `ADMIN_PASSWORD` are both set:
- If the email already exists → promotes to admin (`UPDATE users SET is_admin=1`)
- If the email doesn't exist → creates user with `is_admin=1`
- If only one var is set → fatal error at startup

---

## Notes feature design

### Versioning

Every `PUT /api/notes/:id` first reads the current `{title, content, tags, updated_at}` and inserts a row into `note_versions` using the old `updated_at` as `saved_at`. Only then does it overwrite the note. This means:

- The version history shows what the note looked like **before** each save
- The first version is created on the second save (nothing to snapshot on creation)
- Version content is never compacted or deleted automatically

### Tags

Tags live in a `tags` + `note_tags` join table, scoped per user. `notes.tags`
remains as a denormalised comma-separated cache so every existing client (web,
Android, share view) keeps working unchanged, and so a note's tags come back in
one row without a join.

Normalisation happens in one place (`normalizeTags`): trim, strip a leading
`#`, lowercase, de-duplicate, preserve the order the user typed. Rename, merge
and delete are expressed as a mapping over each affected note's tag list, then
written back through `setNoteTags` — the same path a normal save takes.

Filtering by tag is a server-side `EXISTS` per tag, so `?tag=work,urgent` means
"has both".

### Pinning

`is_pinned` is a single integer column. The list query orders by `is_pinned DESC, updated_at DESC`, so pinned notes always appear first without any client-side sorting.

### Full-text search

`notes_fts` is an FTS5 table over title, content and tags. A query is split on
anything that is not a letter or digit (so punctuation can never be read as FTS
syntax), lowercased, and rendered as a prefix AND query: `foo bar` becomes
`"foo"* "bar"*`. Ranking is `bm25` with the title weighted 10× and tags 5×.
Excerpts come from `snippet()`.

Matches are wrapped in `\x01`/`\x02` control characters rather than HTML, so a
snippet can never inject markup; the frontend's `Snippet` component turns them
into `<mark>` elements.

The `sqlite_fts5` build tag is required for FTS5 in go-sqlite3. If the virtual
table cannot be created, `ftsEnabled` stays false and search falls back to a
LIKE scan with an equivalent hand-built snippet — same JSON, same highlighting,
no ranking. Every write path (`create`, `update`, `setNoteTags`, trash,
restore, purge, import) calls `reindexNote`/`deindexNote`, so the index never
drifts from the table.

### Trash

`DELETE /api/notes/:id` sets `deleted_at` instead of deleting the row, and
removes the note from the search index. Restoring clears the flag and reindexes;
purging deletes the row for real (cascading `note_tags`, `note_links`,
`note_versions` and `share_links`) and then prunes orphan tags and re-resolves
the link graph.

`startTrashSweeper` purges notes older than `TRASH_RETENTION_DAYS` at startup
and every six hours after that. A retention of `0` disables purging entirely.

### Links and backlinks

`[[Target]]` and `[[Target|label]]` are parsed out of the note body — with code
fences and inline code stripped first, so documentation about the syntax does
not create phantom links — and stored as `note_links` rows keyed by title.

Resolution is a single UPDATE that re-points every link owned by the user at the
note whose title it names (case-insensitive, own notes only). It runs after any
create, update, trash, restore or purge, which is what makes a link light up the
moment its target is created and go dark when the target is renamed or trashed.

The same parsing rules are implemented on the frontend (`wikilinks.js`) to
rewrite `[[...]]` into markdown links before rendering: resolved links point at
`/notes/:id`, unresolved ones at `/new?title=...`, which creates the note.

### Optimistic concurrency

`notes.updated_at` doubles as the note's version. A client sends the version it
loaded as `If-Match` (or `baseUpdatedAt` in the body, for clients that cannot
set headers); if it no longer matches, the server answers `409` with the current
note in `current` and writes nothing — not even a version snapshot. A request
with no version information keeps the old last-write-wins behaviour, so older
clients are not locked out.

Timestamps are RFC3339 with millisecond precision, and `nextVersionStamp`
guarantees a save's new stamp differs from the previous one, so two saves in the
same millisecond can still be told apart.

### Import

`POST /api/notes/import` accepts one `.md`/`.markdown`/`.txt` file or a `.zip`
of them (20 MB per upload, 2 MB per entry, and 64 MB / 5000 notes per archive
once decompressed — a small archive can otherwise expand into an enormous one). Each file is parsed as optional YAML
front matter (`title`, `tags` as a list or comma string, `pinned`, `created`
/`created_at`, `updated`/`updated_at`) plus a body. The title falls back to a
leading `# heading` — which is then dropped from the body — and then to the file
name.

The whole import runs in one transaction. A note whose title and body already
exist is skipped rather than duplicated, so re-importing an archive is a no-op.
Tags and links are indexed as the notes are inserted, and the link graph is
resolved once at the end.

Export writes the matching format: YAML front matter followed by the body, so
export → import round-trips titles, tags, pin state and timestamps.

### Auto-save draft

The editor debounces writes to `localStorage` at 2 seconds after any change. Key: `greynote-draft-{noteId}`. On load, if a draft exists with a newer `updatedAt` than the server version, the user is prompted to restore it. Drafts are cleared on successful save or explicit discard.

### Bulk export (ZIP)

`ExportZip` streams the response directly — it creates a `zip.Writer` wrapping `gin.Context.Writer` and writes notes one by one without buffering the full ZIP in memory. Filenames are sanitised (path-separator characters replaced with `_`, max 100 chars) and de-duplicated with `(N)` suffixes. Each file carries YAML front matter; `yamlScalar` quotes values that plain YAML would misread.

---

## Sharing system

### Token lifecycle

```
Note created
    │
    ▼
POST /share     → new token generated (24 bytes, base64url)
                  share_link row inserted (is_enabled=1)
    │
    ├── POST /share/disable  → is_enabled=0  (token preserved)
    │
    └── POST /share          → is_enabled=1  (same token reused)
```

The token is generated once and never rotated. Disabling and re-enabling a share link restores the original URL, which is intentional — callers who bookmarked the link can use it again.

### Password protection

Password is bcrypt-hashed and stored in `share_links.password_hash`. The `GetShared` handler checks the `X-Share-Password` request header. The frontend sends this header on password-protected share views after the user submits the password form.

Response codes from `GET /api/share/:token`:
- `200` — success
- `401 {requiresPassword: true}` — password required but not provided
- `403` — wrong password
- `410` — link has an `expires_at` in the past
- `404` — link disabled, token invalid, or note deleted

### Expiry

`expires_at` is stored as RFC3339 UTC. The frontend date picker works in local dates (`YYYY-MM-DD`) and appends `T23:59:59Z` when sending to the backend, so the link remains valid through the end of the chosen calendar day in UTC. Clearing the field sends `""`, which stores NULL (no expiry).

---

## Image handling

### Upload (`POST /api/images`)

1. Read `file` from multipart form
2. Reject if `header.Size > 5 MB`
3. Read first 512 bytes and call `http.DetectContentType` (sniffs magic bytes, not the client-supplied `Content-Type` header)
4. Reject if not `image/*` or if detected as `image/svg+xml` (XSS risk)
5. Seek back to start (`file.Seek(0, io.SeekStart)`)
6. Generate 16-byte random filename + extension from MIME type
7. Write to `IMAGES_DIR`
8. Return `{url: "/api/images/<filename>"}`

### Serving (`GET /api/images/:filename`)

- Public (no auth) so images embedded in shared notes load without a session
- `filepath.Base(c.Param("filename"))` strips any directory components before joining with `IMAGES_DIR` — prevents path traversal attacks like `/api/images/../../etc/passwd`
- `c.File()` sets appropriate `Content-Type` and handles range requests

### Storage location

`IMAGES_DIR` defaults to `<dir of SQLITE_PATH>/images`, placing uploaded images in the same Docker volume as the database. No docker-compose changes are needed — the volume already covers both.

---

## Frontend architecture

### State management

No external state library. Each page fetches its own data on mount. Cross-cutting auth state lives in `AuthContext` (provided by `AuthProvider` in `App.jsx`); dark mode lives in `ThemeContext`. Everything else is local `useState`.

### API calls

`apiFetch(path, {method, body})` in `api.js`:
- Always passes `credentials: "include"` (required for cookie sessions cross-origin in dev)
- Sets `Content-Type: application/json` only when a body is provided
- Throws on non-2xx responses; the caller handles errors

Image uploads use raw `fetch` directly with `FormData` (not `apiFetch`) because `apiFetch` is JSON-only.

### Routing

React Router v7 with `BrowserRouter`. All `/share/:token` routes render `ShareView` outside the `RequireAuth` wrapper. All other app routes are behind `RequireAuth`, which redirects to `/login` while `loading=false && me=null`.

### Theming

CSS custom properties defined in `theme.css`:
```css
:root { --color-bg: #fff; --color-text: #111; ... }
[data-theme="dark"] { --color-bg: #111; ... }
```

`ThemeProvider` toggles `document.documentElement.dataset.theme` between `""` and `"dark"`, persisting the choice in `localStorage`. All component styles use `var(--color-*)` properties — no hardcoded colour values in JSX.

### Markdown rendering

`MarkdownRenderer` wraps `ReactMarkdown` with:
- `remarkGfm` for tables, strikethrough, task lists
- `rehypeHighlight` for syntax highlighting (highlight.js `github` theme)
- A custom `pre` component (`CopyablePre`) that overlays an absolute-positioned "Copy" button

The copy button uses `preRef.current.innerText` rather than traversing the React element tree, because `rehype-highlight` wraps tokens in `<span>` elements that would produce broken output if concatenated naively.

### Command palette

`CommandPalette` fetches all notes on mount and filters client-side. Matching is case-insensitive substring on title and content. Results show:
- Title with matched characters highlighted (`<mark>`)
- Tag chips
- A content snippet around the first match

Keyboard: `↑`/`↓` to move selection, `Enter` to open, `Escape` to close. Click outside to close.

---

## Android client

A native Kotlin / Jetpack Compose app (`android/`) is a thin client over the same REST API — it adds no server-side concepts of its own.

- **Networking** — Retrofit over OkHttp. `ApiClient` wires a `PersistentCookieJar` backed by `SharedPreferences`, so the session cookie issued by `POST /api/login` survives process death and is replayed on every request (the same cookie-session model as the web client, no token handling in app code).
- **Server URL** — stored in `Prefs` (`SharedPreferences`), defaulting to `http://10.0.2.2:38080` — the Android emulator's alias for the host machine's loopback. Editable on the login screen so one build can point at any deployment.
- **Architecture** — MVVM: `vm/` ViewModels hold UI state and call `ApiService`; `ui/` Compose screens are driven by `NavGraph` (`login → notes → note-edit`). Markdown is rendered by a custom `MarkdownText` composable.
- **Scope** — login/logout, list + search notes, create/edit/delete, and pin. Sharing, versions, images, stats, tag management, trash browsing and admin remain web-only.
- **Concurrency** — the editor keeps the `updatedAt` it loaded and sends it as `If-Match`; a `409` opens a dialog offering "keep mine" (re-saves without the header) or "load theirs". Deleting moves the note to the trash, which only the web app can browse.
- **Config** — `minSdk 26`, `targetSdk 34`. `usesCleartextTraffic="true"` is enabled for plain-HTTP local development; production deployments should be reached over HTTPS.

## Testing

`backend/*_test.go` drives the real router (`buildRouter`) against a temporary
SQLite file, with a helper that creates a user and a session cookie, so tests
exercise middleware, routing and SQL exactly as production does. Coverage
focuses on the behaviour that is easy to get wrong: search indexing across every
write path and the LIKE fallback, the trash lifecycle and retention sweep, tag
rename/merge/delete rewrites, link resolution as notes are created, renamed,
trashed and restored, the conflict matrix, and import parsing plus the
export→import round trip.

```bash
cd backend && make test     # go test -tags sqlite_fts5 ./...
```

Run `go test ./...` without the tag to exercise the no-FTS5 fallback path.

The frontend's pure helpers (`wikilinks.js`, `Snippet.jsx`) are covered by
Vitest:

```bash
cd frontend && npm test
```

## Security considerations

| Concern | Approach |
|---|---|
| Password storage | bcrypt default cost (10 rounds) |
| Session tokens | 32 bytes of `crypto/rand`, base64url — 256 bits of entropy |
| Share link tokens | 24 bytes of `crypto/rand` — 192 bits of entropy |
| Cookie flags | `HttpOnly` (no JS access), `SameSite=Lax` (CSRF mitigation), `Secure` configurable |
| CORS | Strict allowlist (`FRONTEND_ORIGIN`); credentials only to the exact origin |
| Image upload MIME | `http.DetectContentType` (magic bytes), not client `Content-Type`; SVG rejected |
| Path traversal | `filepath.Base()` strips directory components before serving images |
| Account deletion | Password re-confirmation required; all data cascade-deleted in a transaction |
| Admin gate | `AdminRequired` middleware checks `is_admin` on every admin request (not just at login) |
| SQL injection | All queries use `?` placeholders via `database/sql` |
| Search injection | Query terms are reduced to letters and digits before being handed to FTS5 |
| Snippet injection | Search matches are marked with control characters, never HTML |
| Cross-user data | Tag, link, search and trash operations are all scoped by `user_id`; link resolution never crosses users |

### Known limitations

- No rate limiting on login (brute-force possible on exposed instances)
- Images belonging to a purged note are not deleted from disk
- Uploaded images are served without auth — anyone with the direct URL can access them (intentional for shared-note embedding, but means images are not truly private)
- No HTTPS termination in the container — run behind a reverse proxy (nginx, Caddy) for production exposure
- Session expiry is checked on request, not proactively; expired rows accumulate until a matching login clears them
