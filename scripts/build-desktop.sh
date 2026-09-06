#!/usr/bin/env bash
# Bundles the Electron renderer. Packaging into a .deb is package-deb.sh.
source "$(dirname "$0")/common.sh"

need npm

step "building desktop client bundle"
cd "$ROOT/electron"

[ -d node_modules ] || npm install --no-audit --no-fund
# npm can finish an install without running electron's postinstall, which leaves
# the runtime missing; fetch it (from the local cache when possible) if so.
if [ ! -x node_modules/electron/dist/electron ]; then
    warn "electron runtime missing — running its install step"
    node node_modules/electron/install.js
fi

npm run build

ok "electron/renderer/bundle.js ($(du -h renderer/bundle.js | cut -f1))"
