#!/usr/bin/env bash
# Checks that .gitignore ignores the runtime and build output — and nothing else.
#
# The failure this is really about: `data/` unanchored also matches the Android
# `data/` source package, and git ignores a file with no message at all, so the
# mistake shows up much later as a class that will not compile on a fresh clone.
# Everything here is pure git, so it needs no toolchain and runs in a second.
source "$(dirname "$0")/common.sh"

need git
cd "$ROOT"

failures=0

# 1. Nothing that is tracked may match an ignore rule. This is the check that
#    would have caught the Prefs.kt incident the moment it happened: the file
#    was still in the index, but a fresh checkout of it would be ignored.
step "tracked files that .gitignore would ignore"
swallowed="$(git ls-files -i -c --exclude-standard)"
if [ -n "$swallowed" ]; then
    warn "these tracked files match an ignore rule:"
    printf '    %s\n' $swallowed >&2
    failures=$((failures + 1))
else
    ok "none — every tracked file survives a fresh clone"
fi

# 2. Source trees must stay visible. `git check-ignore` answers for paths that
#    do not exist yet too, which is the point: adding a file here must work.
step "source paths stay visible"
must_not_ignore=(
    "android/app/src/main/java/com/greynote/app/data/Prefs.kt"
    "android/app/src/main/java/com/greynote/app/data/NotesRepository.kt"
    "android/app/src/main/java/com/greynote/app/data/db/NoteDao.kt"
    "android/app/src/test/java/com/greynote/app/data/NoteDaoTest.kt"
    "android/app/src/main/java/com/greynote/app/data/db/NewFile.kt"
    "android/gradle/wrapper/gradle-wrapper.properties"
    "backend/db.go"
    "backend/main_test.go"
    "e2e/e2e_test.go"
    "frontend/src/api.js"
    "frontend/src/pages/Notes.jsx"
    "electron/main/api.js"
    "electron/renderer/app.js"
    "electron/test/selftest.js"
    "scripts/e2e.sh"
    "Makefile"
    "VERSION"
)
for path in "${must_not_ignore[@]}"; do
    if rule="$(git check-ignore -v "$path" 2>/dev/null)"; then
        warn "$path is ignored by ${rule%%	*}"
        failures=$((failures + 1))
    fi
done
[ $failures -eq 0 ] && ok "${#must_not_ignore[@]} source paths are all visible"

# 3. Runtime and build output must stay ignored, so a build or a `docker compose
#    up` never leaves something to commit.
step "runtime and build output stay ignored"
must_ignore=(
    "data/notes.db"
    "data/images/abc.png"
    "notes.db"
    "backend/notes.db"
    "images/upload.png"
    "backend/images/upload.png"
    "backend/greynote"
    "dist/greynote-server_1.1.0_linux-amd64.tar.gz"
    "frontend/dist/index.html"
    "frontend/node_modules/react/index.js"
    "frontend/coverage/index.html"
    "electron/node_modules/electron/index.js"
    "electron/renderer/bundle.js"
    "electron/test/screenshots/01-notes.png"
    "android/app/build/outputs/apk/debug/app-debug.apk"
    "android/.gradle/file-system.probe"
    "android/local.properties"
    "release.keystore"
    ".env"
    "server.log"
)
missed=0
for path in "${must_ignore[@]}"; do
    if ! git check-ignore -q "$path" 2>/dev/null; then
        warn "$path is NOT ignored"
        missed=$((missed + 1))
    fi
done
if [ $missed -gt 0 ]; then
    failures=$((failures + missed))
else
    ok "${#must_ignore[@]} build and runtime paths are all ignored"
fi

# 4. Anything present in the working tree that is neither tracked nor ignored is
#    either a file someone forgot to add or one the ignore list should cover.
step "nothing unexplained in the working tree"
stray="$(git ls-files --others --exclude-standard)"
if [ -n "$stray" ]; then
    warn "untracked and not ignored (add them, or add a rule):"
    printf '    %s\n' $stray >&2
else
    ok "the working tree is either tracked or ignored"
fi

[ $failures -eq 0 ] || die "$failures .gitignore problem(s)"
ok ".gitignore is consistent with the tree"
