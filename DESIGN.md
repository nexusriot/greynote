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
  folders.go           — folder path normalisation, tree, move/rename
  templates.go         — templates, placeholder expansion, daily notes
  images_gc.go         — reference scan + unreferenced-upload sweeper
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
  markdown.js          — task toggling, heading extraction, slugs
  editor.js            — toolbar transforms, list continuation, indentation
  diff.js              — line diff (LCS) for version history
  components/
    CommandPalette.jsx — Ctrl+K overlay: fuzzy search notes, keyboard nav
    MarkdownRenderer.jsx — ReactMarkdown with copy-code button, wiki links
    Snippet.jsx        — renders search excerpts with highlighted matches
    EditorToolbar.jsx  — markdown toolbar buttons
    Outline.jsx        — heading outline / jump list
    VersionDiff.jsx    — collapsed line diff between a version and the note
  pages/
    Login.jsx          — POST /api/login
    Notes.jsx          — Note list, server-side search, tag filter, import/export
    NoteEdit.jsx       — Full editor: tags, pin, preview, images, sharing,
                         versions, links/backlinks, conflict resolution
    NewNote.jsx        — Creates a note and opens it (unresolved-link target)
    Tags.jsx           — Tag rename / merge / remove
    Templates.jsx      — Template CRUD and "use"
    Daily.jsx          — Journal browser with date navigation
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
| `folder` | TEXT NOT NULL DEFAULT '' | Path like `Work/Projects`; empty = root (added migration) |
| `daily_date` | TEXT | `YYYY-MM-DD` when the note is a journal entry; unique per user (added migration) |
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

### `templates`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `user_id` | INTEGER NOT NULL | FK → users (CASCADE) |
| `name` | TEXT NOT NULL | UNIQUE per user |
| `title` / `content` / `tags` / `folder` | TEXT NOT NULL | may contain `{{placeholders}}` |
| `is_daily` | INTEGER NOT NULL DEFAULT 0 | at most one per user; setting it clears the others |
| `created_at` / `updated_at` | TEXT NOT NULL | RFC3339 UTC |

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
| GET | `/api/version` | — | `{version}` — stamped in at build time, `"dev"` for a plain `go build` |
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
| GET | `/api/notes` | ✓ | List live notes (pinned first, then by `updated_at DESC`). `?tag=a,b` filters by tag (AND), `?folder=` by folder (`&recursive=1` includes subfolders, `?folder=` alone means the root), `?limit=`/`?offset=` page, `?full=1` includes bodies. Bodies are replaced by a `snippet` unless `full=1`; the unpaged total comes back in `X-Total-Count` |
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
| GET | `/api/notes/daily` | ✓ | `?date=YYYY-MM-DD` — the journal entry for a day, 404 if there is none |
| POST | `/api/notes/daily` | ✓ | Open today's journal entry, creating it from the daily template if needed |
| GET | `/api/notes/daily/list` | ✓ | Days that already have an entry, newest first |
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

### Folders

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/folders` | ✓ | The folder tree with direct and nested note counts |
| PUT | `/api/folders` | ✓ | `{from, to}` — rename or move a folder and everything under it |
| DELETE | `/api/folders?path=` | ✓ | Remove a folder; its notes (and its subfolders' notes) move to the root |

### Templates

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/templates` | ✓ | List templates |
| POST | `/api/templates` | ✓ | Create one; a duplicate name is a 400 |
| PUT | `/api/templates/:id` | ✓ | Update |
| DELETE | `/api/templates/:id` | ✓ | Delete (notes made from it are untouched) |
| POST | `/api/templates/:id/apply` | ✓ | `{title?, date?}` — create a note from the template |

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

## Client parity

The web, desktop and Android clients are separate front ends over the same API,
and every endpoint the server exposes is reachable from each of them. The table
below is the audit: where a client reaches an endpoint, and how.

`/health` is the exception — it exists for orchestrators (the compose
healthcheck, a load balancer), not for people, so no client calls it.

| Endpoint | Web | Desktop | Android |
|---|---|---|---|
| `GET /api/version` | Settings → About | Settings → About | Settings → About |
| `POST /api/login` | Login | Login | Login |
| `POST /api/logout` | Menu | Settings | Menu |
| `GET /api/me` | On load | On load | On load |
| `PUT /api/account/password` | Settings | Settings | Settings |
| `DELETE /api/account` | Settings → Danger zone | Settings → Close account | Settings → Close account |
| `GET /api/sessions` | Sessions page | Sessions view | Settings → Signed-in devices |
| `DELETE /api/sessions/:id` | Sessions page | Sessions view | Settings → Signed-in devices |
| `GET /api/admin/users` | Admin page | Users view | Settings → Users |
| `POST /api/admin/users` | Admin page | Users view | Settings → Users |
| `PUT /api/admin/users/:id/admin` | Admin page | Users view | Settings → Users |
| `DELETE /api/admin/users/:id` | Admin page | Users view | Settings → Users |
| `GET /api/notes` | Note list | Note list | Sync (offline-first) |
| `POST /api/notes` | Editor | Editor | Sync (push) |
| `GET /api/notes/:id` | Editor | Editor | Sync (pull) |
| `PUT /api/notes/:id` | Editor | Editor | Sync (push, `If-Match`) |
| `DELETE /api/notes/:id` | Note list | Editor | Note list (via sync) |
| `POST /api/notes/:id/pin` | Note list | Editor | Note list and editor |
| `GET /api/notes/search` | Search box | Search box | Menu → Search the server |
| `GET /api/notes/stats` | Stats page | Statistics view | Statistics screen |
| `GET /api/notes/export` | Note list | Settings (save dialog) | Settings (document picker) |
| `POST /api/notes/import` | Note list | Settings (file dialog) | Settings (file picker) |
| `GET /api/notes/trash` | Trash page | Trash view | Trash screen |
| `POST /api/notes/:id/restore` | Trash page | Trash view | Trash screen |
| `DELETE /api/notes/:id/purge` | Trash page | Trash view | Trash screen |
| `DELETE /api/notes/trash` | Trash page | Trash view | Trash screen |
| `GET /api/notes/:id/links` | Editor | Editor | Note tools |
| `GET /api/notes/:id/versions` | Editor | Editor | Note tools |
| `GET /api/notes/:id/versions/:vid` | Editor | Editor | Note tools |
| `GET /api/notes/daily` | Journal page | Journal view | Journal screen |
| `POST /api/notes/daily` | Journal page | Journal view | Menu → Journal |
| `GET /api/notes/daily/list` | Journal page | Journal view | Journal screen |
| `GET /api/templates` | Templates page | Templates view | Templates screen |
| `POST /api/templates` | Templates page | Templates view | Templates screen |
| `PUT /api/templates/:id` | Templates page | Templates view | Templates screen |
| `DELETE /api/templates/:id` | Templates page | Templates view | Templates screen |
| `POST /api/templates/:id/apply` | Templates page | Templates view | Templates screen |
| `GET /api/tags` | Tags page | Tags view | Tags screen |
| `PUT /api/tags/:name` | Tags page | Tags view | Tags screen |
| `POST /api/tags/merge` | Tags page | Tags view | Tags screen |
| `DELETE /api/tags/:name` | Tags page | Tags view | Tags screen |
| `GET /api/folders` | Sidebar | Sidebar | Tags & folders screen |
| `PUT /api/folders` | Sidebar | Tags & folders view | Tags & folders screen |
| `DELETE /api/folders` | Sidebar | Tags & folders view | Tags & folders screen |
| `POST /api/notes/:id/share` | Editor | Editor | Note tools |
| `POST /api/notes/:id/share/disable` | Editor | Editor | Note tools |
| `PUT /api/notes/:id/share/password` | Editor | Editor | Note tools |
| `PUT /api/notes/:id/share/expiry` | Editor | Editor | Note tools (7/30 days, never) |
| `GET /api/share/:token` | Share page | Shared link view | Shared link screen |
| `POST /api/images` | Editor (paste) | Editor (file or clipboard) | Editor (picker) |
| `GET /api/images/:filename` | Markdown preview | Markdown preview | Markdown preview |

### Where the clients deliberately differ

- **Android searches locally first.** The note list filters the device's own
  Room copy so it works with no connection; `GET /api/notes/search` is a
  separate screen for when the server's ranking and match snippets are wanted.
- **Android writes through the local database.** Creating, editing, pinning and
  trashing a note touch Room first; `NotesRepository.sync()` is what reaches
  `POST/PUT /api/notes`. The endpoints are used, but a save is not an HTTP call.
- **The desktop client owns HTTP in the main process.** The renderer is
  sandboxed, so every endpoint above is reached through a preload channel
  (`window.greynote.*`) rather than `fetch`. File dialogs and the clipboard
  belong to the main process too, which is why the desktop uploads an image from
  a file or the clipboard rather than from a paste event.
- **Only the web client renders `/share/:token` as a page**, because a share
  link is a URL someone opens in a browser. The desktop and Android clients
  instead take a pasted link and read the note through the same endpoint.

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

### List payloads

`GET /api/notes` used to return every note's whole body, so opening the list
downloaded the entire corpus. It now sends a `snippet` (the first 200 characters,
flattened) and an empty `content`; `?full=1` restores the old behaviour and is
what the Android client uses to fill its offline cache. Paging is `?limit` and
`?offset` with the unpaged count in `X-Total-Count`, which keeps the response a
plain array — older clients that ignore both keep working.

### Folders

A folder is a path string on the note row rather than a table: moving a note is
one UPDATE, and the model matches how markdown vaults are organised.
`normalizeFolder` collapses separators, trims each segment, drops `.`/`..` and
caps depth and length, so a path can never escape into something surprising.

The tree in `GET /api/folders` is derived from the distinct paths in use, with
parents synthesised (`Work` exists as soon as `Work/Projects` does) and two
counts per folder: notes directly inside it, and everything nested below.
Renaming a folder rewrites the subtree in a single statement; deleting one moves
its notes to the root instead of leaving half-paths behind.

### Templates and the journal

A template holds a title, body, tags and folder, any of which may contain
`{{date}}`, `{{time}}`, `{{datetime}}`, `{{weekday}}`, `{{month}}`, `{{year}}` or
`{{title}}`. Expansion takes the date from the client, because the server runs in
UTC and "today" is a question only the user's device can answer.

`notes.daily_date` marks a journal entry, with a unique index per user, so
`POST /api/notes/daily` is get-or-create rather than create-another. Trashing a
journal entry clears `daily_date`: the day becomes free again, and restoring the
old note later cannot collide with the new one.

### Version retention

Every save still snapshots the previous state, but `pruneNoteVersions` then drops
everything beyond `MAX_NOTE_VERSIONS` (default 50, `0` for unlimited). Without
this a note kept a full copy of itself per save forever.

### Image garbage collection

`sweepOrphanImages` lists the uploads directory, scans every note, note version
and template body for `/api/images/<file>` references, and removes the files
nothing points at. Two rules keep it from eating live data: images referenced by
trashed notes or by history are kept, and a file younger than
`IMAGE_GC_GRACE_HOURS` (default 7 days) is never touched — an image is uploaded
before the note that embeds it is saved, and a draft may reference one for a
while. It runs at startup and every 12 hours.

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

### Editing

The editor stays a plain textarea over plain markdown; the additions are text
transforms rather than a rich-text layer, and they live in `editor.js` as pure
functions so they can be tested without a DOM:

- the toolbar wraps or unwraps the selection (`**bold**`), prefixes lines
  (headings, quotes, lists) or inserts a skeleton with the useful part selected;
- Enter inside a list repeats the marker, increments an ordered one, starts new
  task items unchecked, and clears the marker when the item was left empty;
- Tab and Shift+Tab indent and outdent the selected lines.

Task checkboxes in the preview are clickable. react-markdown gives the list item
its source position but not the checkbox inside it, so the item passes its line
number down through a context and a click rewrites exactly that line
(`toggleTaskAtLine`) and saves immediately — a checkbox that needs a separate
save does not feel like a checkbox.

The outline reads headings straight from the markdown (skipping code fences) and
jumps either the preview scroll position or the textarea caret.

Version history renders a line diff (LCS in `diff.js`) between the chosen version
and the note as it stands now, collapsing long unchanged runs, so "what would
restoring this actually change?" is answerable at a glance.

Math is `remark-math` + `rehype-katex`; mermaid diagrams render from
```` ```mermaid ```` fences and the library is imported dynamically, so the 700 kB
of mermaid only loads for a note that actually contains a diagram.

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

## Desktop client

The Electron app (`electron/`) is a desktop front end for the same REST API.

### Process split

```
renderer (sandboxed, no Node, strict CSP)
    │  window.greynote.*  — the preload bridge
    ▼
main process
    ├── ApiClient   — every HTTP call, plus the session cookie
    ├── Store       — settings.json and notes-cache.json in userData
    └── Menu / Tray / globalShortcut
```

Putting the network in the main process removes the two problems a desktop
client usually has with a cookie-session API: there is no page origin to satisfy,
and the session cookie is never reachable from page JavaScript. Bridge calls
resolve to `{ ok, data }` or `{ ok: false, error, status }` so the UI can tell a
`409` conflict from an unreachable server without unwrapping exceptions across
the boundary.

### Renderer

No framework: a 40-line `h()` helper builds elements and a small store re-renders
on change. The views are plain functions of state. Markdown goes through `marked`
and is always sanitised with DOMPurify — note bodies are user content, and the
page has no business executing anything found in one.

The rules that must match the web client — `[[wiki link]]` parsing, task toggling,
heading extraction, the version diff — are imported directly from
`frontend/src/`, not copied, so the two clients cannot drift.

### Offline

`notes:list` writes the unfiltered note list to `notes-cache.json`. When the
server cannot be reached, the app shows those notes with a retry banner instead
of bouncing a signed-in user to a login screen; editing still requires the
server, which is the honest boundary for a client with no local write log.

### Views

Notes with the editor, journal, templates, tags and folders, trash, statistics,
settings — and, for the rest of the API, a shared-link reader, the session list
and the admin user list. The sidebar hides *Users* unless `/api/me` says the
account is an admin; the server enforces that regardless, so the hiding is
courtesy rather than a control.

### Desktop affordances

Native menus and accelerators, a tray icon, a global quick-capture shortcut that
works while the window is hidden, and native dialogs for "save note as", "export
all notes", "import notes" and "insert image". Commands from all three sources
funnel into one `command` channel the renderer listens on.

Two upload paths exist because the renderer is sandboxed and has no file access:
a file dialog in the main process, and `clipboard.readImage()` for the
screenshot-then-paste case. Both post multipart bodies the main-process client
builds by hand — one small function rather than a dependency for two calls.

### Self-test

`npm run selftest` launches the real app with `--selftest`, which drives the
renderer through `window.__greynote_test__` against a running backend: sign in,
create, edit, save, preview, tick a checkbox, search, provoke a `409` and resolve
it, visit every screen, paste an image from the clipboard and check the server
serves the link the editor wrote, set and clear a share expiry, read its own
share link back through the shared-link view, list this computer's session,
refuse a password change with the wrong current password, refuse to close the
account without one, import a markdown file, create/promote/delete a user, then
trash and purge the note and clean up. It captures a screenshot per screen and
exits non-zero on the first failed step. `GREYNOTE_OFFLINE_CHECK=1` runs a
shorter variant that asserts the cached-notes fallback with the server stopped.

The clipboard step needs a real image: `nativeImage` silently yields an empty
image for malformed PNG bytes, and an empty clipboard image is indistinguishable
from a broken one, so the test inlines a valid 2×2 PNG and asserts the "there is
no image on the clipboard" path first.

## Android client

The Android app (`android/`) is offline-first: the UI never waits on the network,
and the network never decides whether the app is usable.

### Layers

```
Compose screens ── ViewModels ── NotesRepository ─┬─ Room (source of truth)
                                                  └─ Retrofit/OkHttp (sync)
```

`Graph` is a small service locator holding the repository and preferences — one
of each, so a DI framework would be more machinery than it earns.

### Local store

`NoteEntity` mirrors a note plus the bookkeeping sync needs:

- `updatedAt` is the server's version token (sent back as `If-Match`) and is
  never touched by a local edit;
- `localUpdatedAt` is when the user last changed the note here, and drives
  ordering so an offline edit still floats to the top;
- `dirty` marks work waiting to be pushed, `pendingDelete` a trashing that has
  not reached the server;
- `conflict` plus `serverTitle`/`serverContent`/`serverUpdatedAt` hold the losing
  side of a rejected push.

A note created offline gets a negative placeholder id; the first successful push
replaces the row with one keyed on the real id.

### Sync

`sync()` pushes then pulls:

1. **Deletes** — `DELETE /api/notes/:id` for each `pendingDelete` row. A 404 is
   success: the note is gone either way.
2. **Edits** — `PUT` with `If-Match: updatedAt`. `409` stores the server's copy
   alongside the local one and flags the conflict instead of picking a winner;
   `404` means the note was deleted elsewhere, so the local row goes.
3. **Creates** — `POST`, then the row is re-keyed to the returned id.
4. **Pull** — pages `GET /api/notes?full=1` and upserts, skipping any note that
   is dirty, conflicted or pending deletion, then deletes local rows the server
   no longer has (again skipping local work).

Conflicts surface as a badge in the list and a card in the editor with both
copies; "keep mine" re-pushes against the server's newer version token, "use
theirs" discards the local edits.

Gson happily leaves a non-null Kotlin field null when the JSON omits it, so the
API models are mapped into entities through one function that reads every string
defensively. An incomplete response degrades a field, it does not crash a sync.

### Screens

Notes list (with local search, tag and folder filters), editor (tags, folder,
preview, image upload, conflict resolution), history and sharing, trash, tags and
folders, templates, journal, statistics and settings. Anything that acts on
server-side state — trash retention, tag renames across every note, share links,
statistics — calls the API directly and says plainly when it needs a connection.

The rest of the API has a screen each: **journal** (any day, plus the days that
already have an entry), **search the server** (bm25 ranking and match snippets,
kept separate from the list's offline search so it is obvious which one needs a
connection), **signed-in devices**, **users** for admins, and a **shared link**
reader. Settings also carries import and export through the system file picker,
the password change, the About line with both versions, and account closure.

Two Android-specific notes. Closing an account or revoking this device's own
session clears the cookie jar and the Room database before navigating back to
the login screen, so nothing of the old account is left on the device. And the
server picks an importer from the *file name*, so the display name is read out
of the content URI (`OpenableColumns.DISPLAY_NAME`) and sent with the bytes;
a name the server has no importer for is refused locally, with the extensions
named, rather than coming back as an opaque 400.

### Beyond the app window

- **Share sheet**: an `ACTION_SEND` `text/plain` intent becomes a new note, with
  the subject (a browser sends the page title) as its first line.
- **Widget**: a RemoteViews home-screen widget with "new note" and "today's
  journal"; two buttons do not justify a second Compose runtime in the APK.
- **App lock**: an optional biometric-or-device-credential gate on launch, which
  degrades to no lock when the device has no screen lock configured rather than
  locking the user out of their own notes.

## Testing

`backend/*_test.go` drives the real router (`buildRouter`) against a temporary
SQLite file, with a helper that creates a user and a session cookie, so tests
exercise middleware, routing and SQL exactly as production does — 91 tests
covering search indexing across every write path and the LIKE fallback, the
trash lifecycle and retention sweep, version pruning, image garbage collection,
tag rename/merge/delete, folder trees and moves, templates and the one-per-day
journal rule, link resolution, the conflict matrix, list paging, and import
parsing plus the export→import round trip.

```bash
cd backend && make test     # go test -tags sqlite_fts5 ./...
```

Run `go test ./...` without the tag to exercise the no-FTS5 fallback path.

The frontend's pure logic — wiki links, search-snippet rendering, task toggling,
heading extraction, the toolbar transforms, the version diff and the About
version line — is covered by 55 Vitest tests:

```bash
cd frontend && npm test
```

The desktop client's API layer is tested against a real HTTP server (cookie
capture and replay, `If-Match`, the 409 body, query building, the plain-language
network errors, the multipart uploads byte for byte, the share-password header,
and the account/session/admin routes), alongside its settings/cache store, the
share-link parser and the pure renderer logic — 52 Vitest tests. Its UI is
covered by the driven self-test rather than a simulated DOM:

```bash
cd electron && npm test && npm run selftest
```

The Android sync engine is the part most able to lose data, so it is tested
against a real in-memory Room database and a real HTTP stack (MockWebServer):
offline creation, push with `If-Match`, conflict capture and both resolutions,
trashing local-only versus synced notes, pull deleting only what is safe to
delete, and a failed sync preserving pending work. 45 tests in total, with DAO
query coverage (search, tag, folder, ordering), share-intent parsing, the
account/session/admin/sharing calls against MockWebServer, and the small pure
helpers (share-token extraction, importable file names, expiry stamps, journal
date arithmetic, snippet splitting).

Retrofit validates its annotations when a call is made, not at compile time, so
`AccountApiTest` is what catches a malformed declaration: closing an account
needs a body on a `DELETE`, which Retrofit refuses on `@DELETE` and only allows
through `@HTTP(method = "DELETE", hasBody = true)`.

```bash
make test-android          # or: cd android && JAVA_HOME=… ./gradlew :app:testDebugUnitTest
```

Everything above runs from the root with `make test`; `make e2e` adds the
hermetic Docker run described below.

The Android client has also been exercised end to end on a physical tablet
(Android 16), with the device pointed at a host backend through
`adb reverse tcp:38080 tcp:38099`: sign-in, create on device, pull from server,
offline edit and offline create followed by upload on reconnect, a real 409
conflict resolved with "keep mine", trash and restore, the share sheet, both
widget shortcuts (cold and warm start), templates, tag rename, statistics,
settings and share-link creation.

## Building and packaging

`make` at the root is the only entry point anyone needs; `scripts/` holds the
implementations so each step is also runnable on its own, and CI needs no
knowledge beyond the target names.

The scripts share `scripts/common.sh`, which carries the two pieces of local
knowledge that otherwise bite:

- **JDK discovery** — this kind of machine often has no `java` on `PATH`, but does
  have Android Studio's bundled JBR.
- **Gradle discovery** — the wrapper jar is deliberately not committed, so the
  scripts fall back to a cached distribution. They pick the *lowest* cached
  stable release that satisfies `gradle-wrapper.properties` rather than the
  newest: reaching for the newest lands on a milestone build the Android plugin
  refuses.

Both `.deb` packages are assembled by hand with `dpkg-deb` under `fakeroot`,
which keeps the build free of a packaging framework:

- `greynote-server` — binary, systemd unit (hardened: `ProtectSystem=strict`, a
  dedicated user, only `/var/lib/greynote` writable), and a conffile. Purging
  leaves the database in place and says so.
- `greynote-desktop` — the Electron runtime plus the app in `resources/app`, a
  launcher, a desktop entry and a generated icon. `chrome-sandbox` is packaged
  `4755 root:root`, without which Electron refuses to start on a kernel that
  disallows unprivileged user namespaces.

## End-to-end testing

`make e2e` (`scripts/e2e.sh`) runs the backend suite hermetically:

```
docker compose -f e2e/docker-compose.yml
    backend  ← built from backend/Dockerfile, /data on tmpfs, healthchecked
    tests    ← golang:1.22-alpine running e2e/ against http://backend:8080
```

Nothing is installed on the host, no port is published, the database starts
empty every run, and the stack is torn down with its volumes whether the suite
passes or fails (`KEEP_STACK=1` keeps it up for poking at). On failure the script
prints the server's log before exiting non-zero.

The suite talks to the API and nothing else — no database access, no fixtures
written behind the server's back — so it tests the same surface a client uses,
against the same image that would be deployed. It also asserts that the image was
built with FTS5, which a plain `go build` would silently drop.

### The route inventory

`e2e/guards_test.go` holds the inventory: every route `buildRouter` registers,
with whether it is public, needs a session, or needs an admin. Three things hang
off it.

1. **Counts are a tripwire.** `TestRouteInventoryIsComplete` fails when the
   number of public, authenticated or admin routes changes, so adding an
   endpoint to the server means adding it here.
2. **Guards are checked route by route.** Every authenticated route is called
   with no cookie and must answer 401; every admin route is called with a plain
   session and must answer 403. No endpoint can quietly ship unguarded.
3. **Coverage is enforced after the run.** The harness records the route each
   request hit (`recordRoute`, normalising `/api/notes/12/versions/3` back to
   `/api/notes/:id/versions/:vid`). When the suite finishes, `TestMain` fails the
   run if any inventoried route was never called. Requests made by the guard
   tests are excluded — bouncing off a 401 is not coverage of an endpoint — and
   a `-run` filter stands the gate down, since that deliberately picks a subset.

The tests that keep it honest are grouped by the surface they cover:
`e2e_test.go` (health and auth, the note lifecycle, search and filters, tags,
folders and links, templates and the journal, sharing, images and
import/export, account isolation, statistics, the version stamp),
`accounts_test.go` (admin user management, password change, account closure,
sessions), `library_test.go` (the tag catalogue, folder deletion, template
editing, journal day lookup, emptying the trash, reading a version, disabling a
share link, paging) and `guards_test.go` (the inventory, the guard matrix,
CORS).

Destructive tests — revoking a session, changing a password, closing an account,
emptying the trash — work on a throwaway account created through the admin API
(`newAccount`), so they cannot disturb the shared admin login the rest of the
suite uses, and their counts are exact rather than "at least".

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
