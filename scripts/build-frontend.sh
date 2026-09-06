#!/usr/bin/env bash
# Builds the web client into frontend/dist.
source "$(dirname "$0")/common.sh"

need npm

step "building web client"
cd "$ROOT/frontend"

[ -d node_modules ] || npm install --no-audit --no-fund
npm run build

ok "frontend/dist ($(du -sh dist | cut -f1))"
