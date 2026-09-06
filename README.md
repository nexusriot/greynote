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

**Lists**
- `GET /api/notes` returns snippets rather than whole note bodies (`?full=1` opts back in), takes `?limit=`/`?offset=`, and reports the unpaged total in `X-Total-Count`
- The web list pages 50 notes at a time with a "load more" control

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
- Folders — a path on each note (`Work/Projects`), filtered server-side, with a folder tree, rename/move of a whole subtree, and remove-without-deleting
- Templates (`/templates`) — named note skeletons with `{{date}}`, `{{weekday}}`, `{{title}}` and friends; one of them can be marked as the daily template
- Journal (`/daily`) — one entry per day, created from the daily template, with date navigation and a list of recent entries
- Command palette (`Ctrl+K`) — ranked server-side search, jump instantly
- Tag manager (`/tags`) — rename, merge and remove tags across every note at once
- Statistics page — total notes, total words, notes-per-month bar chart, tag usage

**Editor**
- Markdown toolbar: bold, italic, strikethrough, heading, link, inline code, code block, quote, bullet and task list — all editing the markdown you can still see
- Enter continues a list (numbering ordered ones, unchecking new task items) and clears the marker on an empty item; Tab / Shift+Tab indent
- Task checkboxes are clickable in the preview: ticking one rewrites the markdown and saves
- Outline panel — jump to any heading, from the preview or the editor
- Math with KaTeX (`$inline$` and `$$block$$`) and diagrams from mermaid code fences (loaded on demand)
- Version history shows a line diff against the note as it stands now, not just a preview

**Editing**
- Split edit/preview mode with `Ctrl+E` toggle
- Auto-save draft to `localStorage` (2 s debounce) — survives accidental tab closes
- Unsaved-changes guard (`beforeunload` prompt)
- Keyboard shortcuts: `Ctrl+S` save, `Ctrl+E` preview toggle
- Copy-code button on every code block

**Images**
- Uploads no note references any more are reclaimed by a sweeper (`IMAGE_GC_GRACE_HOURS`, default 7 days); images referenced by a trashed note or by version history are kept
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
- History is capped (`MAX_NOTE_VERSIONS`, default 50) and pruned as you save, so it cannot grow without bound
- Browse the diff or a preview of any version and restore it

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

**Desktop client (Electron)**
- Three-pane desktop app (`electron/`): folders and tags in the sidebar, note list, editor
- All HTTP happens in the main process — the renderer is sandboxed, has no Node and never sees the session cookie
- Editor with live preview, split view, clickable task checkboxes, outline, wiki links, backlinks, version diff and share-link management
- The same conflict handling as the other clients: a stale save gets a `409` and a choice, never a silent overwrite
- Native menus and shortcuts (`Ctrl+N` new, `Ctrl+D` journal, `Ctrl+S` save, `Ctrl+F` search, `Ctrl+E` preview, `Ctrl+1…6` views)
- Tray icon and a global quick-capture hotkey (`Ctrl+Shift+N` by default) that works while the window is hidden
- "Save note as…" and "Export all notes…" write straight to disk through native dialogs
- The last note list is cached on disk: with the server unreachable a signed-in user still sees their notes, with a "try again" banner rather than a login screen

**Android client**
- Native Jetpack Compose app (`android/`) targeting the same backend
- **Offline-first**: every screen reads from a local Room database, so the app opens and edits with no network at all
- Edits queue locally and sync when they can; the list shows how many changes are waiting
- Conflicts are kept, not resolved silently — a rejected push stores both copies and the editor offers "keep mine" or "use theirs"
- Search, tag and folder filters all run against the local store, so they work offline too
- Trash, tags and folders, templates, journal, statistics, version history, share links, image upload and password change — parity with the web app for everything that has meaning on a phone
- Share sheet target: send text from any app straight into a new note
- Home-screen widget with one-tap "new note" and "today's journal"
- Optional app lock using biometrics or the device PIN
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
| Desktop | Electron 31, esbuild, marked + DOMPurify (no renderer framework) |
| Android | Kotlin, Jetpack Compose, Room (offline store), Retrofit + OkHttp, androidx.biometric (minSdk 26, targetSdk 34) |
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

## Build and package

One `make` from the repository root covers every piece; `make` on its own lists
the targets.

| Target | What it does |
|---|---|
| `make build` | Backend binary (with FTS5), web bundle, desktop bundle |
| `make build-android` | Debug APK |
| `make test` | Every unit suite that needs no device (Go ×2 build modes, web, desktop) |
| `make test-android` | Android unit tests (Robolectric, no emulator) |
| `make e2e` | Hermetic backend end-to-end run in Docker |
| `make e2e-desktop` | Drives the real desktop app against a running server |
| `make deb` | `greynote-server` and `greynote-desktop` Debian packages |
| `make dist` | Everything above into `dist/`: tarballs and both `.deb`s |
| `make dist-android` | Copies the APK into `dist/` |
| `make docker` | Builds the server container image |
| `make clean` | Removes build output |

The work happens in `scripts/`, and each script runs on its own:

```bash
scripts/build-backend.sh /tmp/greynote     # honours GOOS/GOARCH and GO_TAGS
scripts/package-deb.sh server              # or desktop, or all
scripts/e2e.sh                             # KEEP_STACK=1 leaves it up to poke at
```

`VERSION` at the root names the release. Every artifact is stamped with it —
the file names, both `.deb` control files, the Android `versionName`, the two
`package.json` files, and the server binary itself, which reports it at startup
and on `GET /api/version`. Bumping a release means editing `VERSION` (and
`versionCode` in `android/app/build.gradle.kts`, which only ever goes up).

### Packages

`greynote-server_<version>_amd64.deb` installs the binary at `/usr/bin/greynote`,
a hardened systemd unit, and `/etc/greynote/greynote.env` as a conffile. It
creates a system user, keeps the database in `/var/lib/greynote`, and leaves your
notes alone on purge.

`greynote-desktop_<version>_amd64.deb` installs the Electron client under
`/opt/greynote-desktop` with a launcher, a desktop entry and an icon.

### End-to-end

`make e2e` builds the real server image, starts it on a private Docker network
with a throwaway in-memory data volume, and runs the Go suite in `e2e/` from a
second container. Nothing is installed on the host, no port is published, and
the stack is torn down (volumes included) pass or fail. The suite drives only the
public API — health and auth, the note lifecycle including optimistic
concurrency and the trash, ranked search, tag/folder filters and moves, wiki
links and backlinks, templates and the one-per-day journal rule, public share
links with passwords and expiry, image upload and serving, the export→import
round trip, account isolation, and statistics.

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

Desktop client:

```bash
cd electron && npm install && npm start
```

```bash
cd electron && npm test && npm run selftest
```

`npm test` runs the unit tests; `npm run selftest` launches the real app against
a running backend, drives it through every screen and writes screenshots to
`electron/test/screenshots/`.

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
| `MAX_NOTE_VERSIONS` | `50` | Versions kept per note; `0` keeps every version |
| `IMAGE_GC_GRACE_HOURS` | `168` | How long an unreferenced upload survives before the sweeper removes it; `0` disables the sweep |
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
├── Makefile                  # build, test, e2e and packaging entry point
├── VERSION                   # stamped into every artifact
├── scripts/                  # what the Makefile actually runs
├── e2e/                      # hermetic end-to-end suite (Docker)
├── backend/
│   ├── main.go               # config, server setup, route table (buildRouter)
│   ├── db.go                 # schema creation, additive migrations, backfills, helpers
│   ├── middleware.go         # CORS, AuthRequired, getUserID
│   ├── admin_middleware.go   # AdminRequired
│   ├── admin_bootstrap.go    # ensureAdminUser (run at startup)
│   ├── auth_handlers.go      # login/logout/me/sessions/account
│   ├── notes_handlers.go     # CRUD, pin, versions, share, export, stats, search
│   ├── search.go             # FTS5 index maintenance + LIKE fallback
│   ├── folders.go            # folder paths, tree, move/rename
│   ├── templates.go          # templates, placeholders, daily notes
│   ├── images_gc.go          # unreferenced-upload sweeper
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
    │   ├── markdown.js        # task toggling, heading extraction, slugs
    │   ├── editor.js          # toolbar transforms, list continuation, indent
    │   ├── diff.js            # line diff for version history
    │   ├── components/
    │   │   ├── CommandPalette.jsx
    │   │   ├── Snippet.jsx     # renders highlighted search excerpts
    │   │   ├── EditorToolbar.jsx
    │   │   ├── Outline.jsx
    │   │   ├── VersionDiff.jsx
    │   │   └── MarkdownRenderer.jsx
    │   └── pages/
    │       ├── Login.jsx
    │       ├── Notes.jsx       # list, search, tag filter, import, bulk export
    │       ├── NoteEdit.jsx    # editor, sharing, versions, links, conflicts
    │       ├── NewNote.jsx     # create-and-open (target of unresolved links)
    │       ├── Tags.jsx        # tag rename / merge / remove
    │       ├── Templates.jsx   # template CRUD and "use"
    │       ├── Daily.jsx       # journal browser
    │       ├── Trash.jsx       # restore, delete forever, empty trash
    │       ├── ShareView.jsx   # public share viewer
    │       ├── Sessions.jsx    # session list + revoke
    │       ├── Settings.jsx    # change password, delete account
    │       ├── Stats.jsx       # statistics page
    │       └── AdminUsers.jsx
    ├── vite.config.js
    └── Dockerfile
├── electron/                 # desktop client
│   ├── main/                 # window, menus, tray, HTTP client, settings + cache
│   │   ├── api.js            # every call to the backend
│   │   ├── ipc.js            # the channels the renderer may use
│   │   ├── store.js          # settings and the offline note cache
│   │   └── main.js           # app lifecycle, menu, tray, quick-capture hotkey
│   ├── preload.js            # the only surface the renderer gets
│   ├── renderer/             # sandboxed UI (no framework, bundled by esbuild)
│   ├── build.js              # esbuild bundle step
│   └── test/                 # unit tests + the driven self-test
└── android/                  # native Kotlin / Jetpack Compose client
    └── app/src/main/java/com/greynote/app/
        ├── MainActivity.kt
        ├── api/              # Retrofit ApiService, ApiClient (persistent cookie jar)
        ├── Graph.kt          # service locator (repository, prefs)
        ├── data/
        │   ├── db/           # Room entity, DAO, database
        │   ├── NotesRepository.kt  # offline store + sync engine
        │   └── Prefs.kt      # server URL, app lock, sync settings
        ├── security/AppLock.kt     # biometric / device-credential gate
        ├── widget/           # home-screen quick capture
        ├── ui/               # NavGraph, screens, theme, MarkdownText
        └── vm/               # Auth / Notes / NoteEdit / library view models
```

## Desktop client

The `electron/` module is a desktop client for the same backend.

```bash
cd electron
npm install
npm start
```

Sign in with the server URL, email and password; the session is kept in the
app's own settings file so it survives a restart.

- **Architecture** — the main process owns the HTTP client, the settings file and
  the note cache; the renderer runs sandboxed with `contextIsolation`, no Node
  integration and a strict CSP, and reaches the backend only through the
  `preload.js` bridge. Every bridge call answers `{ ok, data }` or
  `{ ok: false, error, status }`, which is how the UI can tell a `409` conflict
  from an unreachable server.
- **Shared logic** — wiki links, task toggling, heading extraction and the
  version diff are imported from `frontend/src/`, so the web and desktop clients
  cannot drift apart on those rules.
- **Offline** — the note list is cached to `notes-cache.json` in the app's data
  directory. With the server down, a signed-in user gets their cached notes and a
  retry banner rather than a login screen. Editing still needs the server.
- **Self-test** — `npm run selftest` boots the real app, signs in, creates and
  edits a note, ticks a checkbox in the preview, searches, provokes and resolves
  a save conflict, walks every screen, trashes and purges the note, and cleans up
  after itself — writing a screenshot per screen.

## Android client

The `android/` module is an offline-first Jetpack Compose app over the same REST backend.

- Open the `android/` directory in Android Studio and run on an emulator or device.
- The default server URL is `http://10.0.2.2:38080` (the Android emulator's alias for the host's `localhost`). Change it on the login screen or in Settings to point at a real deployment.
- Notes live in a local Room database. Reads never touch the network; writes are marked dirty and pushed on the next sync (app start, pull-to-sync from the toolbar, or Settings → Sync now).
- A push the server rejects with `409` is kept as a conflict rather than being dropped: the note shows a warning badge and the editor offers "keep mine" (re-push, overwriting) or "use theirs".
- Cleartext HTTP is enabled (`usesCleartextTraffic="true"`) for local development; use HTTPS behind a reverse proxy in production.

Build and test without Android Studio:

```bash
JAVA_HOME=/path/to/jdk ./gradlew :app:testDebugUnitTest :app:assembleDebug
```
