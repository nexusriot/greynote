# GreyNote

A self-hosted markdown notes app. Write, organise, link, and share notes with full markdown support, syntax-highlighted code blocks, tags, full-text search, version history, and image embeds — all running in two Docker containers with a single SQLite file for storage.

## Features

**Notes**
- Markdown editing with live preview (GFM + syntax highlighting via highlight.js)
- Tags with pill UI — add with Enter or comma, remove with Backspace
- Pin notes to the top of the list
- Ranked full-text search (SQLite FTS5) with highlighted snippets
- Tag filtering, applied server-side and reflected in the URL
- Word count displayed while editing

**Search**
- `GET /api/notes/search` returns bm25-ranked hits with highlighted excerpts
- Title, body and tags are all indexed; matches are prefix-aware (`deploy` finds `Deployment`)
- The index is maintained on every create, edit, trash, restore, purge and import
- If the binary was built without the `sqlite_fts5` tag the server automatically falls back to scanning, so search keeps working (unranked)

**Trash**
- Deleting a note moves it to the trash instead of destroying it
- Restore a note, delete one for good, or empty the whole trash
- Trashed notes disappear from lists, search, stats, exports and share links
- A sweeper purges notes that have been in the trash longer than `TRASH_RETENTION_DAYS` (default 30; `0` keeps them forever)

**Links between notes**
- `[[Another note]]` links one note to another; `[[Target|label]]` sets the link text
- Links resolve by title, case-insensitively, and only within your own notes
- A link to a note that does not exist yet is remembered and lights up the moment you create it — clicking one offers to create the note
- Every note shows what it links to and what links back to it
- Links inside code fences and inline code are ignored

**Concurrent editing**
- Saves carry the version the editor loaded (`If-Match`), so a save that would overwrite a newer one from another device is rejected with `409`
- The editor shows the other version and lets you overwrite it or discard your own changes
- Clients that send no version keep the old last-write-wins behaviour

**Organisation**
- Command palette (`Ctrl+K`) — fuzzy-search all notes by title and content, jump instantly
- Tag manager (`/tags`) — rename, merge and remove tags across every note at once
- Statistics page — total notes, total words, notes-per-month bar chart, tag usage

**Editing**
- Split edit/preview mode with `Ctrl+E` toggle
- Auto-save draft to `localStorage` (2 s debounce) — survives accidental tab closes
- Unsaved-changes guard (`beforeunload` prompt)
- Keyboard shortcuts: `Ctrl+S` save, `Ctrl+E` preview toggle
- Copy-code button on every code block

**Images**
- Paste an image from the clipboard directly into the editor — it uploads and inserts `![](url)` at the cursor
- File picker button for the same workflow without clipboard
- JPEG, PNG, GIF, and WebP supported (max 5 MB); SVG rejected
- Uploaded images are stored in the Docker volume and served publicly (so they appear in shared notes)

**Export and import**
- Download individual note as `.md` or rendered `.html`
- Download all notes as a `.zip` archive of `.md` files with YAML front matter (title, tags, pinned, created, updated)
- Import a single `.md` file or a `.zip` archive of them (20 MB upload, 2 MB per file, 64 MB / 5000 notes per archive); front matter is honoured, a leading `# heading` or the file name is used as a fallback title
- Import is idempotent: a note whose title and body already exist is skipped, so re-importing the same archive changes nothing
- Export → import round-trips titles, tags, timestamps and pin state

**Sharing**
- Create a public share link (`/share/:token`) — no login required to view
- Optional password protection (bcrypt-hashed)
- Optional expiry date — link returns 410 Gone after the chosen date
- Disable sharing at any time without losing the token (re-enable restores the same link)

**Version history**
- Every save snapshots the previous state
- Up to 50 versions per note; browse previews and restore any version

**Account & sessions**
- Change password (current password required)
- Delete account (password-confirmed; cascades all data)
- Session list with "revoke" per session and "revoke all others"

**Admin**
- User list at `/admin/users`
- Create users, toggle admin flag, delete users (with cascade)
- First admin bootstrapped from environment variables

**Theming**
- Light / dark mode toggle, persisted in `localStorage`

**Android client**
- Native Jetpack Compose app (`android/`) targeting the same backend
- Login, list/search notes, create/edit/delete, pin, and markdown rendering
- Sends `If-Match` on save and offers a conflict dialog when the note changed elsewhere
- Deleting moves the note to the trash (restore it from the web app)
- Configurable server URL (defaults to `http://10.0.2.2:38080`, the emulator's host loopback)
- Session cookie persisted across launches

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Go 1.22, Gin, go-sqlite3 (CGO, `sqlite_fts5` build tag) |
| Database | SQLite (single file, FTS5 search index, WAL via busy-timeout) |
| Frontend | React 19, Vite 7, React Router 7 |
| Markdown | react-markdown v10, remark-gfm, rehype-highlight |
| Auth | HttpOnly cookie sessions (bcrypt passwords) |
| Images | `archive/zip` (export), `http.DetectContentType` (upload) |
| Import | `archive/zip`, `gopkg.in/yaml.v3` (front matter) |
| Android | Kotlin, Jetpack Compose, Retrofit + OkHttp (minSdk 26, targetSdk 34) |
| Deployment | Docker Compose (two containers + named volume) |

## Run

```bash
docker compose up -d --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:35173 |
| Backend (health) | http://localhost:38080/health |

Data (SQLite DB + uploaded images) is persisted in `./data/` on the host.

### Stop and restart (keep data)

```bash
docker compose down
docker compose up -d
```

### Full reset (deletes all data)

```bash
docker compose down -v
rm -rf ./data
docker compose up -d --build
```

## Development

The backend needs the `sqlite_fts5` build tag for the search index; the `Makefile` applies it:

```bash
cd backend && make test    # go test -tags sqlite_fts5 ./...
```

```bash
cd backend && make build   # CGO_ENABLED=1 go build -tags sqlite_fts5 -o greynote .
```

Building without the tag still works — the server logs that FTS5 is unavailable and falls back to scanning.

Frontend:

```bash
cd frontend && npm install && npm test && npm run build
```

## Bootstrap the first admin

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (min 8 chars) in `docker-compose.yml` before the first start:

```yaml
environment:
  ADMIN_EMAIL: "admin@example.com"
  ADMIN_PASSWORD: "supersecret123"
```

On startup the backend creates the user if it doesn't exist, or promotes an existing user to admin. After first login you can remove or rotate these vars — they are only applied at startup.

Admin panel: `/admin/users`

## Environment variables

All backend configuration is done via environment variables (set in `docker-compose.yml`).

| Variable | Default | Description |
|---|---|---|
| `ADDR` | `:8080` | Listen address inside the container |
| `SQLITE_PATH` | `./notes.db` | Path to the SQLite database file |
| `IMAGES_DIR` | `<dir of SQLITE_PATH>/images` | Directory for uploaded images |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Allowed CORS origin (must match the browser URL of the frontend) |
| `COOKIE_NAME` | `notes_session` | Name of the session cookie |
| `COOKIE_SECURE` | `0` | Set to `1` to mark the session cookie as Secure (HTTPS only) |
| `SESSION_TTL_HOURS` | `168` | Session lifetime in hours (default 7 days) |
| `TRASH_RETENTION_DAYS` | `30` | Days a trashed note is kept before it is purged; `0` keeps trashed notes forever |
| `ADMIN_EMAIL` | _(empty)_ | Bootstrap admin email; both vars must be set or both empty |
| `ADMIN_PASSWORD` | _(empty)_ | Bootstrap admin password (min 8 chars) |

## Changing ports

Edit `docker-compose.yml`. If you change the frontend port, also update `FRONTEND_ORIGIN` on the backend:

```yaml
# frontend service
ports:
  - "5200:5173"

# backend service
environment:
  FRONTEND_ORIGIN: "http://localhost:5200"
```

## Vite allowedHosts (dev)

The Vite dev server inside the container uses `allowedHosts: true` to accept connections from any hostname. To restrict it, edit `frontend/vite.config.js`:

```js
server: { allowedHosts: ["localhost", "my.hostname"] }
```

## Project layout

```
greynote/
├── backend/
│   ├── main.go               # config, server setup, route table (buildRouter)
│   ├── db.go                 # schema creation, additive migrations, backfills, helpers
│   ├── middleware.go         # CORS, AuthRequired, getUserID
│   ├── admin_middleware.go   # AdminRequired
│   ├── admin_bootstrap.go    # ensureAdminUser (run at startup)
│   ├── auth_handlers.go      # login/logout/me/sessions/account
│   ├── notes_handlers.go     # CRUD, pin, versions, share, export, stats, search
│   ├── search.go             # FTS5 index maintenance + LIKE fallback
│   ├── tags.go               # tag join table + rename/merge/delete
│   ├── links.go              # [[wiki link]] parsing, resolution, backlinks
│   ├── trash.go              # soft delete, restore, purge, retention sweeper
│   ├── import_handlers.go    # .md / .zip import with YAML front matter
│   ├── images_handlers.go    # upload + serve
│   ├── *_test.go             # handler-level tests (run with `make test`)
│   ├── Makefile
│   ├── Dockerfile
│   └── go.mod
├── frontend/
    ├── src/
    │   ├── App.jsx            # shell, routing
    │   ├── auth.jsx           # AuthProvider, useAuth
    │   ├── theme.jsx / .css   # dark mode provider + CSS variables
    │   ├── api.js             # apiFetch helper
    │   ├── wikilinks.js       # [[link]] parsing / rewriting (shared by editor + preview)
    │   ├── components/
    │   │   ├── CommandPalette.jsx
    │   │   ├── Snippet.jsx     # renders highlighted search excerpts
    │   │   └── MarkdownRenderer.jsx
    │   └── pages/
    │       ├── Login.jsx
    │       ├── Notes.jsx       # list, search, tag filter, import, bulk export
    │       ├── NoteEdit.jsx    # editor, sharing, versions, links, conflicts
    │       ├── NewNote.jsx     # create-and-open (target of unresolved links)
    │       ├── Tags.jsx        # tag rename / merge / remove
    │       ├── Trash.jsx       # restore, delete forever, empty trash
    │       ├── ShareView.jsx   # public share viewer
    │       ├── Sessions.jsx    # session list + revoke
    │       ├── Settings.jsx    # change password, delete account
    │       ├── Stats.jsx       # statistics page
    │       └── AdminUsers.jsx
    ├── vite.config.js
    └── Dockerfile
└── android/                  # native Kotlin / Jetpack Compose client
    └── app/src/main/java/com/greynote/app/
        ├── MainActivity.kt
        ├── api/              # Retrofit ApiService, ApiClient (persistent cookie jar)
        ├── data/Prefs.kt     # server URL persistence
        ├── ui/               # NavGraph, screens, theme, MarkdownText
        └── vm/               # Auth / Notes / NoteEdit ViewModels
```

## Android client

The `android/` module is a standalone Jetpack Compose app that talks to the same REST backend.

- Open the `android/` directory in Android Studio and run on an emulator or device.
- The default server URL is `http://10.0.2.2:38080` (the Android emulator's alias for the host's `localhost`). Change it on the login screen to point at a real deployment.
- Cleartext HTTP is enabled (`usesCleartextTraffic="true"`) for local development; use HTTPS behind a reverse proxy in production.
