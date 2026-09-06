#!/usr/bin/env bash
# Builds the backend binary. GOOS/GOARCH are honoured for cross-compiles, but
# note the sqlite driver needs cgo: cross-compiling wants a matching toolchain.
source "$(dirname "$0")/common.sh"

need go

OUT="${1:-$ROOT/backend/greynote}"
TAGS="${GO_TAGS:-sqlite_fts5}"

step "building backend ${GOOS:+for $GOOS/$GOARCH }(tags: $TAGS)"
cd "$ROOT/backend"

CGO_ENABLED="${CGO_ENABLED:-1}" go build \
    -tags "$TAGS" \
    -trimpath \
    -ldflags "-s -w -X main.version=$VERSION" \
    -o "$OUT" .

ok "$OUT ($(du -h "$OUT" | cut -f1))"
