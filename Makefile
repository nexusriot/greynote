# GreyNote — one entry point for building, testing and packaging every piece.
#
#   make            list the targets
#   make build      backend binary, web bundle, desktop bundle
#   make test       every unit suite
#   make e2e        hermetic backend end-to-end run in Docker
#   make dist       release artifacts in dist/
#
# The scripts under scripts/ do the actual work and can be run on their own.

SHELL := /bin/bash
.DEFAULT_GOAL := help

VERSION := $(shell cat VERSION 2>/dev/null || echo 0.0.0)
DIST := $(CURDIR)/dist
GRADLE_APK := android/app/build/outputs/apk/debug/app-debug.apk

export VERSION

.PHONY: help
help: ## Show this help
	@echo "GreyNote $(VERSION)"
	@echo
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-18s\033[0m %s\n", $$1, $$2}'

# ------------------------------------------------------------------ build ---

.PHONY: build
build: build-backend build-frontend build-desktop ## Build the backend, web and desktop bundles

.PHONY: build-backend
build-backend: ## Build the backend binary (with FTS5)
	@scripts/build-backend.sh

.PHONY: build-frontend
build-frontend: ## Build the web client into frontend/dist
	@scripts/build-frontend.sh

.PHONY: build-desktop
build-desktop: ## Bundle the Electron renderer
	@scripts/build-desktop.sh

.PHONY: build-android
build-android: ## Build the debug APK
	@scripts/build-android.sh debug

.PHONY: build-android-release
build-android-release: ## Build the release APK (needs signing config to install)
	@scripts/build-android.sh release

.PHONY: docker
docker: ## Build the server container image
	@docker build --build-arg VERSION=$(VERSION) \
		-t greynote-backend:$(VERSION) -t greynote-backend:latest backend

# ------------------------------------------------------------------- test ---

.PHONY: test
test: check-ignore test-backend test-frontend test-desktop ## Run every unit suite that needs no device
	@echo "all unit suites passed"

.PHONY: check-ignore
check-ignore: ## Check .gitignore covers the build output and nothing else
	@scripts/check-gitignore.sh

.PHONY: test-backend
test-backend: ## Go tests, with and without the FTS5 build tag
	@$(MAKE) -C backend test
	@echo "== without sqlite_fts5 (the scanning fallback)"
	@cd backend && go test ./...

.PHONY: test-frontend
test-frontend: ## Web client unit tests
	@cd frontend && [ -d node_modules ] || npm install --no-audit --no-fund
	@cd frontend && npm test

.PHONY: test-desktop
test-desktop: ## Desktop client unit tests
	@cd electron && [ -d node_modules ] || npm install --no-audit --no-fund
	@cd electron && npm test

.PHONY: test-android
test-android: ## Android unit tests (Robolectric)
	@scripts/test-android.sh

.PHONY: test-all
test-all: test test-android ## Every unit suite, Android included

# -------------------------------------------------------------------- e2e ---

.PHONY: e2e
e2e: ## Hermetic backend end-to-end run (Docker: real image, throwaway data)
	@scripts/e2e.sh

.PHONY: e2e-desktop
e2e-desktop: ## Drive the real desktop app against a running server (needs a display)
	@cd electron && npm run selftest

# ------------------------------------------------------------------- dist ---

.PHONY: dist
dist: clean-dist build deb ## Build every release artifact into dist/
	@mkdir -p $(DIST)
	@tar -C backend -czf $(DIST)/greynote-server_$(VERSION)_linux-amd64.tar.gz greynote
	@tar -C frontend -czf $(DIST)/greynote-web_$(VERSION).tar.gz dist
	@ls -lh $(DIST)/*.tar.gz $(DIST)/*.deb 2>/dev/null || true

.PHONY: dist-android
dist-android: build-android ## Copy the APK into dist/
	@mkdir -p $(DIST)
	@cp $(GRADLE_APK) $(DIST)/greynote_$(VERSION).apk
	@ls -lh $(DIST)/greynote_$(VERSION).apk

.PHONY: deb
deb: ## Build both .deb packages
	@scripts/package-deb.sh all

.PHONY: deb-server
deb-server: ## Build the server .deb
	@scripts/package-deb.sh server

.PHONY: deb-desktop
deb-desktop: ## Build the desktop .deb
	@scripts/package-deb.sh desktop

# ------------------------------------------------------------------- misc ---

.PHONY: run
run: ## Run the backend from source (SQLITE_PATH=./data/notes.db)
	@cd backend && SQLITE_PATH=$${SQLITE_PATH:-../data/notes.db} $(MAKE) run

.PHONY: fmt
fmt: ## Format the Go code
	@cd backend && gofmt -w .

.PHONY: vet
vet: ## Vet the Go code
	@cd backend && go vet -tags sqlite_fts5 ./...

.PHONY: clean-dist
clean-dist:
	@rm -rf $(DIST)

.PHONY: clean
clean: clean-dist ## Remove build output (keeps node_modules and the SQLite data)
	@rm -f backend/greynote
	@rm -rf frontend/dist electron/renderer/bundle.js electron/renderer/bundle.js.map
	@rm -rf electron/test/screenshots
	@rm -rf android/app/build
	@echo "cleaned"
