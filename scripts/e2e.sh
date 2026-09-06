#!/usr/bin/env bash
# Hermetic end-to-end run for the backend.
#
# Builds the real server image, starts it with an empty in-memory data volume on
# a private network, and runs the Go e2e suite from a second container. Nothing
# is installed on the host, no port is published, and the whole stack is torn
# down (volumes included) whether the tests pass or fail.
source "$(dirname "$0")/common.sh"

need docker "install Docker to run the end-to-end suite"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"

COMPOSE=(docker compose -f "$ROOT/e2e/docker-compose.yml")
KEEP="${KEEP_STACK:-0}"

cleanup() {
    if [ "$KEEP" = "1" ]; then
        warn "leaving the stack up (KEEP_STACK=1); tear it down with:"
        warn "  docker compose -f e2e/docker-compose.yml down -v"
        return
    fi
    step "tearing the stack down"
    "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

step "building the server image"
"${COMPOSE[@]}" build backend

step "starting the server"
"${COMPOSE[@]}" up -d --wait backend

step "running the end-to-end suite"
set +e
"${COMPOSE[@]}" run --rm --no-deps tests
status=$?
set -e

if [ $status -ne 0 ]; then
    warn "the suite failed — server log follows"
    "${COMPOSE[@]}" logs --no-color --tail 80 backend >&2 || true
    die "end-to-end tests failed"
fi

ok "end-to-end tests passed"
